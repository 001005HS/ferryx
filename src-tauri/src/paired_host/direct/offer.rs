use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::SocketAddrV4;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum IdentityVerificationError {
    #[error("Signature does not match trusted machine identity")]
    InvalidSignature,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectRole {
    Initiator,
    Responder,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectConnectionOffer {
    pub session_id: String,
    pub public_endpoint: SocketAddrV4,
    pub cert_der: Vec<u8>,
    #[serde(with = "base64_bytes_32")]
    pub punch_nonce: [u8; 32],
    pub role: DirectRole,
    pub issued_at_ms: u64,
    #[serde(with = "base64_bytes_64")]
    pub signature: [u8; 64],
}

impl DirectConnectionOffer {
    pub fn new(
        session_id: String,
        public_endpoint: SocketAddrV4,
        cert_der: Vec<u8>,
        punch_nonce: [u8; 32],
        role: DirectRole,
        signing_key: &SigningKey,
    ) -> Self {
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let now_ms = d.as_secs().saturating_mul(1000).saturating_add(u64::from(d.subsec_millis()));
        Self::new_at(session_id, public_endpoint, cert_der, punch_nonce, role, now_ms, signing_key)
    }

    pub fn new_at(
        session_id: String,
        public_endpoint: SocketAddrV4,
        cert_der: Vec<u8>,
        punch_nonce: [u8; 32],
        role: DirectRole,
        issued_at_ms: u64,
        signing_key: &SigningKey,
    ) -> Self {
        let transcript = compute_offer_transcript(&session_id, public_endpoint, &cert_der, &punch_nonce, role, issued_at_ms);
        let sig = signing_key.sign(&transcript);
        Self { session_id, public_endpoint, cert_der, punch_nonce, role, issued_at_ms, signature: sig.to_bytes() }
    }

    pub fn verify(&self, trusted_verifying_key: &VerifyingKey) -> Result<(), IdentityVerificationError> {
        let transcript = compute_offer_transcript(&self.session_id, self.public_endpoint, &self.cert_der, &self.punch_nonce, self.role, self.issued_at_ms);
        let sig = Signature::from_bytes(&self.signature);
        trusted_verifying_key.verify_strict(&transcript, &sig).map_err(|_| IdentityVerificationError::InvalidSignature)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectConnectionAnswer {
    pub session_id: String,
    pub public_endpoint: SocketAddrV4,
    pub cert_der: Vec<u8>,
    #[serde(with = "base64_bytes_32")]
    pub punch_nonce: [u8; 32],
    #[serde(with = "base64_bytes_64")]
    pub signature: [u8; 64],
}

impl DirectConnectionAnswer {
    pub fn new(
        session_id: String,
        public_endpoint: SocketAddrV4,
        cert_der: Vec<u8>,
        punch_nonce: [u8; 32],
        signing_key: &SigningKey,
    ) -> Self {
        let transcript = compute_answer_transcript(&session_id, public_endpoint, &cert_der, &punch_nonce);
        let sig = signing_key.sign(&transcript);
        Self { session_id, public_endpoint, cert_der, punch_nonce, signature: sig.to_bytes() }
    }

    pub fn verify(&self, trusted_verifying_key: &VerifyingKey) -> Result<(), IdentityVerificationError> {
        let transcript = compute_answer_transcript(&self.session_id, self.public_endpoint, &self.cert_der, &self.punch_nonce);
        let sig = Signature::from_bytes(&self.signature);
        trusted_verifying_key.verify_strict(&transcript, &sig).map_err(|_| IdentityVerificationError::InvalidSignature)
    }
}

pub fn compute_offer_transcript(
    session_id: &str,
    public_endpoint: SocketAddrV4,
    cert_der: &[u8],
    punch_nonce: &[u8; 32],
    role: DirectRole,
    issued_at_ms: u64,
) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(cert_der);
    let cert_fingerprint = hasher.finalize();

    let mut buf = Vec::with_capacity(136);
    buf.extend_from_slice(b"FERRYX_DIRECT_OFFER_V1\n");
    buf.extend_from_slice(session_id.as_bytes());
    buf.push(b'\n');
    buf.extend_from_slice(&public_endpoint.ip().octets());
    buf.extend_from_slice(&public_endpoint.port().to_be_bytes());
    buf.extend_from_slice(&cert_fingerprint);
    buf.extend_from_slice(punch_nonce);
    match role {
        DirectRole::Initiator => buf.push(1),
        DirectRole::Responder => buf.push(2),
    }
    buf.extend_from_slice(&issued_at_ms.to_be_bytes());
    buf
}

pub fn compute_answer_transcript(
    session_id: &str,
    public_endpoint: SocketAddrV4,
    cert_der: &[u8],
    punch_nonce: &[u8; 32],
) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(cert_der);
    let cert_fingerprint = hasher.finalize();

    let mut buf = Vec::with_capacity(128);
    buf.extend_from_slice(b"FERRYX_DIRECT_ANSWER_V1\n");
    buf.extend_from_slice(session_id.as_bytes());
    buf.push(b'\n');
    buf.extend_from_slice(&public_endpoint.ip().octets());
    buf.extend_from_slice(&public_endpoint.port().to_be_bytes());
    buf.extend_from_slice(&cert_fingerprint);
    buf.extend_from_slice(punch_nonce);
    buf
}

pub fn sign_offer(session_id: String, public_endpoint: SocketAddrV4, cert_der: Vec<u8>, punch_nonce: [u8; 32], role: DirectRole, signing_key: &SigningKey) -> DirectConnectionOffer {
    DirectConnectionOffer::new(session_id, public_endpoint, cert_der, punch_nonce, role, signing_key)
}

pub fn verify_offer(offer: &DirectConnectionOffer, key: &VerifyingKey) -> Result<(), IdentityVerificationError> {
    offer.verify(key)
}

pub fn sign_answer(session_id: String, public_endpoint: SocketAddrV4, cert_der: Vec<u8>, punch_nonce: [u8; 32], signing_key: &SigningKey) -> DirectConnectionAnswer {
    DirectConnectionAnswer::new(session_id, public_endpoint, cert_der, punch_nonce, signing_key)
}

pub fn verify_answer(answer: &DirectConnectionAnswer, key: &VerifyingKey) -> Result<(), IdentityVerificationError> {
    answer.verify(key)
}

mod base64_bytes_32 {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 32], D::Error> where D: Deserializer<'de> {
        let s = String::deserialize(deserializer)?;
        let vec = STANDARD.decode(s.as_bytes()).map_err(D::Error::custom)?;
        vec.try_into().map_err(|_| D::Error::custom("expected 32 decoded bytes"))
    }
}

mod base64_bytes_64 {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8; 64], serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 64], D::Error> where D: Deserializer<'de> {
        let s = String::deserialize(deserializer)?;
        let vec = STANDARD.decode(s.as_bytes()).map_err(D::Error::custom)?;
        vec.try_into().map_err(|_| D::Error::custom("expected 64 decoded bytes"))
    }
}
