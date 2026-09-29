//! Independently provisioned peer keys for the direct (P2P) path.
//!
//! The relay is UNTRUSTED: a peer key is never learned from an offer or an answer.
//! The only writers are [`DirectTrustStore::provision`] and [`DirectTrustStore::revoke`],
//! driven by an explicit user action on each side:
//! - the host provisions the client machine's `identity.json` public key, and
//! - the client provisions the host machine's `identity.json` public key.
//!
//! A machine without a provisioned key stays on the relay. All methods here do
//! synchronous disk IO; async callers go through [`trusted_key`] / [`provision`],
//! which run on `crate::ipc::run_blocking`.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const TRUST_FILE: &str = "direct-trust.json";
const MAX_MACHINE_ID: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TrustError {
    #[error("invalid machine id")]
    InvalidMachineId,
    #[error("invalid ed25519 public key")]
    InvalidKey,
    #[error("direct trust store unavailable: {0}")]
    Io(String),
    #[error("direct trust store is corrupt")]
    Corrupt,
    #[error("a different key is already pinned for this machine; pass --replace")]
    PinConflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Disk {
    version: u32,
    /// machine id -> standard base64 32-byte ed25519 verifying key.
    peers: BTreeMap<String, String>,
}

impl Default for Disk {
    fn default() -> Self {
        Self {
            version: 1,
            peers: BTreeMap::new(),
        }
    }
}

/// Serializes read-modify-write cycles inside this process.
static WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectTrustStore {
    path: PathBuf,
}

impl DirectTrustStore {
    pub fn at(dir: &Path) -> Self {
        Self {
            path: dir.join(TRUST_FILE),
        }
    }

    /// `<data>/remote/direct-trust.json`, beside `identity.json`.
    pub fn canonical() -> Result<Self, TrustError> {
        crate::remote::auth::canonical_remote_dir()
            .map(|dir| Self::at(&dir))
            .ok_or_else(|| TrustError::Io("cannot resolve remote data dir".into()))
    }

    fn read(&self) -> Result<Disk, TrustError> {
        match std::fs::read(&self.path) {
            Ok(bytes) => match serde_json::from_slice::<Disk>(&bytes) {
                Ok(disk) if disk.version == 1 => Ok(disk),
                _ => Err(TrustError::Corrupt),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Disk::default()),
            Err(error) => Err(TrustError::Io(error.to_string())),
        }
    }

    fn write(&self, disk: &Disk) -> Result<(), TrustError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| TrustError::Io(e.to_string()))?;
        }
        crate::remote::auth::write_private_json(&self.path, disk)
            .map_err(|e| TrustError::Io(e.to_string()))
    }

    /// Explicitly trust `machine_id`. An existing different pin is only
    /// overwritten when `replace` is set (the user re-keyed that machine).
    pub fn provision(&self, machine_id: &str, public_key_b64: &str, replace: bool) -> Result<(), TrustError> {
        validate_machine_id(machine_id)?;
        let key = STANDARD.encode(parse_verifying_key(public_key_b64)?.to_bytes());
        let _guard = WRITE_LOCK.lock();
        let mut disk = self.read()?;
        match disk.peers.get(machine_id) {
            Some(existing) if *existing == key => return Ok(()),
            Some(_) if !replace => return Err(TrustError::PinConflict),
            _ => {}
        }
        disk.peers.insert(machine_id.to_owned(), key);
        self.write(&disk)
    }

    pub fn list(&self) -> Result<Vec<(String, String)>, TrustError> {
        Ok(self.read()?.peers.into_iter().collect())
    }

    /// Removes trust; returns whether a key was present.
    pub fn revoke(&self, machine_id: &str) -> Result<bool, TrustError> {
        validate_machine_id(machine_id)?;
        let _guard = WRITE_LOCK.lock();
        let mut disk = self.read()?;
        let removed = disk.peers.remove(machine_id).is_some();
        if removed {
            self.write(&disk)?;
        }
        Ok(removed)
    }

    /// `Ok(None)` means "not trusted": the caller must stay on the relay.
    pub fn trusted_key(&self, machine_id: &str) -> Result<Option<VerifyingKey>, TrustError> {
        validate_machine_id(machine_id)?;
        match self.read()?.peers.get(machine_id) {
            Some(encoded) => parse_verifying_key(encoded).map(Some),
            None => Ok(None),
        }
    }
}

pub fn validate_machine_id(machine_id: &str) -> Result<(), TrustError> {
    let ok = !machine_id.is_empty()
        && machine_id.len() <= MAX_MACHINE_ID
        && machine_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'));
    ok.then_some(()).ok_or(TrustError::InvalidMachineId)
}

pub fn parse_verifying_key(public_key_b64: &str) -> Result<VerifyingKey, TrustError> {
    let bytes: [u8; 32] = STANDARD
        .decode(public_key_b64.trim())
        .map_err(|_| TrustError::InvalidKey)?
        .try_into()
        .map_err(|_| TrustError::InvalidKey)?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| TrustError::InvalidKey)
}

/// Async lookup on a blocking worker. Any failure (corrupt store, IO) is reported
/// as "not trusted" to the route layer, which keeps the relay; the error is logged.
pub async fn trusted_key(store: DirectTrustStore, machine_id: String) -> Option<VerifyingKey> {
    let result = crate::ipc::run_blocking(move || {
        store
            .trusted_key(&machine_id)
            .map_err(|e| crate::ipc::IpcError::internal(e.to_string()))
    })
    .await;
    match result {
        Ok(key) => key,
        Err(error) => {
            tracing::warn!("direct trust lookup failed; staying on relay: {error:?}");
            None
        }
    }
}

/// Async explicit provisioning entry point (IPC callers).
pub async fn provision(
    store: DirectTrustStore,
    machine_id: String,
    public_key_b64: String,
    replace: bool,
) -> Result<(), crate::ipc::IpcError> {
    crate::ipc::run_blocking(move || {
        store
            .provision(&machine_id, &public_key_b64, replace)
            .map_err(|e| crate::ipc::IpcError::internal(e.to_string()))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key_b64(seed: u8) -> String {
        let key = ed25519_dalek::SigningKey::from_bytes(&[seed; 32]);
        STANDARD.encode(key.verifying_key().to_bytes())
    }

    #[test]
    fn absent_store_trusts_nobody() {
        let dir = tempfile::tempdir().unwrap();
        let store = DirectTrustStore::at(dir.path());
        assert_eq!(store.trusted_key("host-a").unwrap(), None);
    }

    #[test]
    fn provision_then_revoke_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let store = DirectTrustStore::at(dir.path());
        store.provision("host-a", &key_b64(3), false).unwrap();
        let expected = parse_verifying_key(&key_b64(3)).unwrap();
        assert_eq!(store.trusted_key("host-a").unwrap(), Some(expected));
        assert_eq!(store.trusted_key("host-b").unwrap(), None);
        assert!(store.revoke("host-a").unwrap());
        assert_eq!(store.trusted_key("host-a").unwrap(), None);
    }

    #[test]
    fn malformed_inputs_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = DirectTrustStore::at(dir.path());
        assert_eq!(store.provision("", &key_b64(1), false), Err(TrustError::InvalidMachineId));
        assert_eq!(store.provision("a/b", &key_b64(1), false), Err(TrustError::InvalidMachineId));
        assert_eq!(store.provision("host", "not-base64!", false), Err(TrustError::InvalidKey));
        assert_eq!(
            store.provision("host", &STANDARD.encode([1u8; 31]), false),
            Err(TrustError::InvalidKey)
        );
    }

    #[test]
    fn a_different_pin_needs_explicit_replace() {
        let dir = tempfile::tempdir().unwrap();
        let store = DirectTrustStore::at(dir.path());
        store.provision("host", &key_b64(1), false).unwrap();
        store.provision("host", &key_b64(1), false).unwrap();
        assert_eq!(store.provision("host", &key_b64(2), false), Err(TrustError::PinConflict));
        store.provision("host", &key_b64(2), true).unwrap();
        assert_eq!(
            store.trusted_key("host").unwrap(),
            Some(parse_verifying_key(&key_b64(2)).unwrap())
        );
    }

    #[test]
    fn unknown_version_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(TRUST_FILE), br#"{"version":2,"peers":{}}"#).unwrap();
        assert_eq!(DirectTrustStore::at(dir.path()).trusted_key("h"), Err(TrustError::Corrupt));
    }

    #[test]
    fn corrupt_store_is_an_error_not_trust() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(TRUST_FILE), b"{not json").unwrap();
        let store = DirectTrustStore::at(dir.path());
        assert_eq!(store.trusted_key("host-a"), Err(TrustError::Corrupt));
    }
}
