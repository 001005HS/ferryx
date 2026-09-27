use crate::browser::{validate_url, BrowserError};
use futures_util::StreamExt;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::broadcast;
use uuid::Uuid;

pub const BROWSER_DOWNLOAD_UPDATED_EVENT: &str = "browser_download_updated";
const BROADCAST_CHANNEL_CAPACITY: usize = 256;
const PROGRESS_BYTE_THRESHOLD: u64 = 1024 * 1024; // 1 MiB
const PROGRESS_TIME_THRESHOLD: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub file_path: String,
    pub status: DownloadStatus,
    pub total_bytes: Option<u64>,
    pub received_bytes: u64,
    pub error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProgressEmissionState {
    last_emitted_bytes: u64,
    last_emitted_percent: Option<u64>,
    last_emitted_at: Instant,
}

pub struct DownloadRegistry {
    records: RwLock<HashMap<String, DownloadRecord>>,
    cancellations: RwLock<HashMap<String, Arc<AtomicBool>>>,
    progress_states: RwLock<HashMap<String, ProgressEmissionState>>,
    broadcaster: broadcast::Sender<DownloadRecord>,
}

impl DownloadRegistry {
    pub fn new() -> Self {
        let (broadcaster, _) = broadcast::channel(BROADCAST_CHANNEL_CAPACITY);
        Self {
            records: RwLock::new(HashMap::new()),
            cancellations: RwLock::new(HashMap::new()),
            progress_states: RwLock::new(HashMap::new()),
            broadcaster,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DownloadRecord> {
        self.broadcaster.subscribe()
    }

    fn notify(&self, record: DownloadRecord) {
        // If there are no active receivers, SendError is returned; dropping it is correct
        // because subscribers can come and go (e.g. before the Tauri listener forwards,
        // or when no window/frontend client is actively listening).
        let _ = self.broadcaster.send(record);
    }

    pub fn register(&self, id: String, url: String, file_path: String) -> Arc<AtomicBool> {
        let now = current_time_ms();
        let cancel_flag = Arc::new(AtomicBool::new(false));
        self.cancellations
            .write()
            .insert(id.clone(), Arc::clone(&cancel_flag));
        let record = DownloadRecord {
            id: id.clone(),
            url,
            file_path,
            status: DownloadStatus::Pending,
            total_bytes: None,
            received_bytes: 0,
            error: None,
            created_at_ms: now,
            updated_at_ms: now,
        };
        self.records.write().insert(id.clone(), record.clone());
        self.progress_states.write().insert(
            id,
            ProgressEmissionState {
                last_emitted_bytes: 0,
                last_emitted_percent: None,
                last_emitted_at: Instant::now(),
            },
        );
        self.notify(record);
        cancel_flag
    }

    pub fn set_started(&self, id: &str, total_bytes: Option<u64>) {
        let updated_record = {
            let mut records = self.records.write();
            if let Some(record) = records.get_mut(id) {
                record.status = DownloadStatus::InProgress;
                record.total_bytes = total_bytes;
                record.updated_at_ms = current_time_ms();
                Some(record.clone())
            } else {
                None
            }
        };

        if let Some(record) = updated_record {
            {
                let mut pstates = self.progress_states.write();
                if let Some(pstate) = pstates.get_mut(id) {
                    pstate.last_emitted_bytes = record.received_bytes;
                    pstate.last_emitted_percent = record
                        .total_bytes
                        .filter(|&total| total > 0)
                        .map(|total| (record.received_bytes * 100) / total);
                    pstate.last_emitted_at = Instant::now();
                }
            }
            self.notify(record);
        }
    }

    pub fn update_progress(&self, id: &str, received_bytes: u64) {
        let maybe_to_notify = {
            let mut records = self.records.write();
            let mut pstates = self.progress_states.write();

            if let (Some(record), Some(pstate)) = (records.get_mut(id), pstates.get_mut(id)) {
                record.received_bytes = received_bytes;
                record.updated_at_ms = current_time_ms();

                let now = Instant::now();
                let byte_delta = received_bytes.saturating_sub(pstate.last_emitted_bytes);
                let time_elapsed = now.duration_since(pstate.last_emitted_at);

                let current_percent = record
                    .total_bytes
                    .filter(|&total| total > 0)
                    .map(|total| (received_bytes * 100) / total);

                let percent_changed = match (pstate.last_emitted_percent, current_percent) {
                    (Some(last_p), Some(curr_p)) => curr_p > last_p,
                    (None, Some(_)) => true,
                    _ => false,
                };

                // Bounded emission: integer percentage change, >= 1 MiB boundary, OR >= 250ms elapsed
                let should_emit = percent_changed
                    || byte_delta >= PROGRESS_BYTE_THRESHOLD
                    || time_elapsed >= PROGRESS_TIME_THRESHOLD;

                if should_emit {
                    pstate.last_emitted_bytes = received_bytes;
                    pstate.last_emitted_percent = current_percent;
                    pstate.last_emitted_at = now;
                    Some(record.clone())
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(record) = maybe_to_notify {
            self.notify(record);
        }
    }

    pub fn set_completed(&self, id: &str) {
        self.cancellations.write().remove(id);
        self.progress_states.write().remove(id);
        let updated_record = {
            let mut records = self.records.write();
            if let Some(record) = records.get_mut(id) {
                record.status = DownloadStatus::Completed;
                record.updated_at_ms = current_time_ms();
                Some(record.clone())
            } else {
                None
            }
        };
        if let Some(record) = updated_record {
            self.notify(record);
        }
    }

    pub fn set_failed(&self, id: &str, error: String) {
        self.cancellations.write().remove(id);
        self.progress_states.write().remove(id);
        let updated_record = {
            let mut records = self.records.write();
            if let Some(record) = records.get_mut(id) {
                record.status = DownloadStatus::Failed;
                record.error = Some(error);
                record.updated_at_ms = current_time_ms();
                Some(record.clone())
            } else {
                None
            }
        };
        if let Some(record) = updated_record {
            self.notify(record);
        }
    }

    pub fn set_cancelled(&self, id: &str) {
        self.cancellations.write().remove(id);
        self.progress_states.write().remove(id);
        let updated_record = {
            let mut records = self.records.write();
            if let Some(record) = records.get_mut(id) {
                record.status = DownloadStatus::Cancelled;
                record.error = Some("download cancelled".to_string());
                record.updated_at_ms = current_time_ms();
                Some(record.clone())
            } else {
                None
            }
        };
        if let Some(record) = updated_record {
            self.notify(record);
        }
    }

    pub fn cancel(&self, id: &str) -> bool {
        let found = {
            let map = self.cancellations.read();
            match map.get(id) {
                Some(flag) => {
                    flag.store(true, Ordering::SeqCst);
                    true
                }
                None => false,
            }
        };
        if found {
            self.set_cancelled(id);
        }
        found
    }

    pub fn list(&self) -> Vec<DownloadRecord> {
        let mut list: Vec<DownloadRecord> = self.records.read().values().cloned().collect();
        list.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        list
    }

    pub fn get(&self, id: &str) -> Option<DownloadRecord> {
        self.records.read().get(id).cloned()
    }

    pub fn clear(&self) {
        self.cancellations.write().clear();
        self.progress_states.write().clear();
        self.records.write().clear();
    }
}

static DOWNLOAD_REGISTRY: LazyLock<DownloadRegistry> = LazyLock::new(DownloadRegistry::new);

pub fn subscribe_download_updates() -> broadcast::Receiver<DownloadRecord> {
    DOWNLOAD_REGISTRY.subscribe()
}

pub fn register_download_event_forwarder<R: tauri::Runtime>(app: &AppHandle<R>) {
    let app_handle = app.clone();
    let mut rx = subscribe_download_updates();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(record) => {
                    if let Err(err) = app_handle.emit(BROWSER_DOWNLOAD_UPDATED_EVENT, &record) {
                        tracing::warn!(
                            "failed to emit browser download update for {}: {err}",
                            record.id
                        );
                    }
                }
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    tracing::debug!(
                        missed,
                        "download update broadcast receiver lagged; continuing"
                    );
                }
                Err(broadcast::error::RecvError::Closed) => {
                    tracing::debug!("download update broadcast channel closed; stopping forwarder");
                    break;
                }
            }
        }
    });
}

pub fn list_downloads() -> Vec<DownloadRecord> {
    DOWNLOAD_REGISTRY.list()
}

pub fn get_download(id: &str) -> Option<DownloadRecord> {
    DOWNLOAD_REGISTRY.get(id)
}

pub fn cancel_download(id: &str) -> bool {
    DOWNLOAD_REGISTRY.cancel(id)
}

pub fn clear_downloads() {
    DOWNLOAD_REGISTRY.clear();
}

pub async fn download_url_with_cookies(
    url: &str,
    path: &Path,
    cookies: Option<&str>,
    download_id: Option<&str>,
) -> Result<String, BrowserError> {
    let url = validate_url(url)?;
    if url == "about:blank" {
        return Err(BrowserError::DownloadFailed(
            "about:blank cannot be downloaded".into(),
        ));
    }

    let id = download_id
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let path_str = path.to_string_lossy().to_string();
    let cancel_flag = DOWNLOAD_REGISTRY.register(id.clone(), url.clone(), path_str);

    let client_builder = reqwest::Client::builder();
    let client = client_builder
        .build()
        .map_err(|e| {
            let err_msg = format!("failed to build reqwest client: {e}");
            DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
            BrowserError::DownloadFailed(err_msg)
        })?;

    let mut req = client.get(&url);
    if let Some(cookie_str) = cookies {
        if !cookie_str.trim().is_empty() {
            req = req.header(reqwest::header::COOKIE, cookie_str.trim());
        }
    }

    let response = match req.send().await {
        Ok(res) => res,
        Err(err) => {
            let err_msg = err.to_string();
            DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
            return Err(BrowserError::DownloadFailed(err_msg));
        }
    };

    if !response.status().is_success() {
        let err_msg = format!("server returned HTTP {}", response.status());
        DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
        return Err(BrowserError::DownloadFailed(err_msg));
    }

    let total_bytes = response.content_length();
    DOWNLOAD_REGISTRY.set_started(&id, total_bytes);

    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            let err_msg = e.to_string();
            DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
            return Err(BrowserError::DownloadFailed(err_msg));
        }
    }

    let mut file = match tokio::fs::File::create(path).await {
        Ok(f) => f,
        Err(e) => {
            let err_msg = e.to_string();
            DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
            return Err(BrowserError::DownloadFailed(err_msg));
        }
    };

    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;

    while let Some(chunk_result) = stream.next().await {
        if cancel_flag.load(Ordering::SeqCst) {
            if let Err(e) = tokio::fs::remove_file(path).await {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(
                        "failed to clean up partial download file {}: {e}",
                        path.display()
                    );
                }
            }
            DOWNLOAD_REGISTRY.set_cancelled(&id);
            return Err(BrowserError::DownloadFailed("download cancelled".into()));
        }

        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                let err_msg = e.to_string();
                DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
                return Err(BrowserError::DownloadFailed(err_msg));
            }
        };

        received += chunk.len() as u64;
        if let Err(e) = file.write_all(&chunk).await {
            let err_msg = e.to_string();
            DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
            return Err(BrowserError::DownloadFailed(err_msg));
        }
        DOWNLOAD_REGISTRY.update_progress(&id, received);
    }

    if let Err(e) = file.flush().await {
        let err_msg = e.to_string();
        DOWNLOAD_REGISTRY.set_failed(&id, err_msg.clone());
        return Err(BrowserError::DownloadFailed(err_msg));
    }

    DOWNLOAD_REGISTRY.set_completed(&id);
    Ok(id)
}

pub async fn download_url_to_path(url: &str, path: &Path) -> Result<(), BrowserError> {
    download_url_with_cookies(url, path, None, None).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_registry_lifecycle() {
        let registry = DownloadRegistry::new();
        let cancel_flag = registry.register(
            "dl-1".into(),
            "https://example.com/file.zip".into(),
            "/tmp/file.zip".into(),
        );

        assert!(!cancel_flag.load(Ordering::SeqCst));
        let rec = registry.get("dl-1").expect("must exist");
        assert_eq!(rec.status, DownloadStatus::Pending);
        assert_eq!(rec.received_bytes, 0);

        registry.set_started("dl-1", Some(1024));
        let rec = registry.get("dl-1").unwrap();
        assert_eq!(rec.status, DownloadStatus::InProgress);
        assert_eq!(rec.total_bytes, Some(1024));

        registry.update_progress("dl-1", 512);
        let rec = registry.get("dl-1").unwrap();
        assert_eq!(rec.received_bytes, 512);

        registry.set_completed("dl-1");
        let rec = registry.get("dl-1").unwrap();
        assert_eq!(rec.status, DownloadStatus::Completed);

        let list = registry.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "dl-1");
    }

    #[test]
    fn test_download_registry_cancellation() {
        let registry = DownloadRegistry::new();
        let cancel_flag = registry.register(
            "dl-2".into(),
            "https://example.com/data.tar".into(),
            "/tmp/data.tar".into(),
        );

        assert!(!cancel_flag.load(Ordering::SeqCst));
        let cancelled = registry.cancel("dl-2");
        assert!(cancelled);
        assert!(cancel_flag.load(Ordering::SeqCst));

        let rec = registry.get("dl-2").unwrap();
        assert_eq!(rec.status, DownloadStatus::Cancelled);
        assert_eq!(rec.error.as_deref(), Some("download cancelled"));
    }

    #[test]
    fn test_download_registry_failure() {
        let registry = DownloadRegistry::new();
        registry.register(
            "dl-3".into(),
            "https://example.com/notfound.txt".into(),
            "/tmp/notfound.txt".into(),
        );

        registry.set_failed("dl-3", "server returned HTTP 404".into());
        let rec = registry.get("dl-3").unwrap();
        assert_eq!(rec.status, DownloadStatus::Failed);
        assert_eq!(rec.error.as_deref(), Some("server returned HTTP 404"));
    }

    #[test]
    fn test_download_serde_roundtrip() {
        let rec = DownloadRecord {
            id: "dl-99".into(),
            url: "https://example.com/a.pdf".into(),
            file_path: "/tmp/a.pdf".into(),
            status: DownloadStatus::InProgress,
            total_bytes: Some(2048),
            received_bytes: 1024,
            error: None,
            created_at_ms: 1000,
            updated_at_ms: 1050,
        };

        let json = serde_json::to_string(&rec).unwrap();
        assert!(json.contains("\"status\":\"inProgress\""));
        assert!(json.contains("\"totalBytes\":2048"));
        let parsed: DownloadRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, rec);
    }

    #[tokio::test]
    async fn test_download_url_rejects_about_blank() {
        let result = download_url_to_path("about:blank", Path::new("/tmp/test_blank")).await;
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            BrowserError::DownloadFailed("about:blank cannot be downloaded".into())
        );
    }

    #[tokio::test]
    async fn test_download_registry_lifecycle_broadcast_events() {
        let registry = DownloadRegistry::new();
        // Exact subscription BEFORE any mutation
        let mut rx = registry.subscribe();

        let _cancel_flag = registry.register(
            "dl-event-1".into(),
            "https://example.com/file.bin".into(),
            "/tmp/file.bin".into(),
        );

        let event1 = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timeout waiting for register event")
            .expect("recv error");
        assert_eq!(event1.id, "dl-event-1");
        assert_eq!(event1.status, DownloadStatus::Pending);

        registry.set_started("dl-event-1", Some(100));
        let event2 = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timeout waiting for started event")
            .expect("recv error");
        assert_eq!(event2.id, "dl-event-1");
        assert_eq!(event2.status, DownloadStatus::InProgress);
        assert_eq!(event2.total_bytes, Some(100));

        registry.set_completed("dl-event-1");
        let event3 = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timeout waiting for completed event")
            .expect("recv error");
        assert_eq!(event3.id, "dl-event-1");
        assert_eq!(event3.status, DownloadStatus::Completed);
    }

    #[tokio::test]
    async fn test_download_registry_bounded_progress_thresholds() {
        let registry = DownloadRegistry::new();
        // Exact subscription BEFORE mutation
        let mut rx = registry.subscribe();

        let _cancel_flag = registry.register(
            "dl-progress-1".into(),
            "https://example.com/large.iso".into(),
            "/tmp/large.iso".into(),
        );
        let _ = rx.recv().await.unwrap(); // register

        registry.set_started("dl-progress-1", Some(100_000_000)); // 100 MB -> 1% is 1,000,000 bytes
        let _ = rx.recv().await.unwrap(); // started

        // Update with small chunk: 100 bytes (0% change, < 1 MiB, < 250ms) -> should NOT emit
        registry.update_progress("dl-progress-1", 100);
        let try_res = rx.try_recv();
        assert!(
            try_res.is_err(),
            "small sub-threshold progress chunk must not emit"
        );

        // Update crossing 1% (1,000,000 bytes) -> should emit
        registry.update_progress("dl-progress-1", 1_000_000);
        let event = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timeout waiting for progress event on percent threshold")
            .expect("recv error");
        assert_eq!(event.received_bytes, 1_000_000);

        // Sub-threshold again: 1,000,100 bytes (same percent, delta 100 bytes) -> should NOT emit
        registry.update_progress("dl-progress-1", 1_000_100);
        assert!(rx.try_recv().is_err());

        // Update crossing 1 MiB delta (1,000,100 + 1,048,576) without totalBytes (e.g. None)
        registry.register(
            "dl-progress-unknown-len".into(),
            "https://example.com/stream".into(),
            "/tmp/stream".into(),
        );
        let _ = rx.recv().await.unwrap();
        registry.set_started("dl-progress-unknown-len", None);
        let _ = rx.recv().await.unwrap();

        // 500 KiB -> no emit
        registry.update_progress("dl-progress-unknown-len", 512 * 1024);
        assert!(rx.try_recv().is_err());

        // 1.5 MiB -> crosses 1 MiB boundary -> emit
        registry.update_progress("dl-progress-unknown-len", 1536 * 1024);
        let event_mib = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timeout waiting for 1MiB progress event")
            .expect("recv error");
        assert_eq!(event_mib.id, "dl-progress-unknown-len");
        assert_eq!(event_mib.received_bytes, 1536 * 1024);
    }

    #[tokio::test]
    async fn test_download_registry_cancellation_emits_cancelled_event() {
        let registry = DownloadRegistry::new();
        let mut rx = registry.subscribe();

        let _cancel_flag = registry.register(
            "dl-cancel-1".into(),
            "https://example.com/archive.tar".into(),
            "/tmp/archive.tar".into(),
        );
        let _ = rx.recv().await.unwrap();

        registry.set_started("dl-cancel-1", Some(50_000));
        let _ = rx.recv().await.unwrap();

        let cancelled = registry.cancel("dl-cancel-1");
        assert!(cancelled);

        let event = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timeout waiting for cancel event")
            .expect("recv error");
        assert_eq!(event.id, "dl-cancel-1");
        assert_eq!(event.status, DownloadStatus::Cancelled);
        assert_eq!(event.error.as_deref(), Some("download cancelled"));
    }

    #[tokio::test]
    async fn test_download_registry_failure_emits_failed_event() {
        let registry = DownloadRegistry::new();
        let mut rx = registry.subscribe();

        registry.register(
            "dl-fail-1".into(),
            "https://example.com/fail.zip".into(),
            "/tmp/fail.zip".into(),
        );
        let _ = rx.recv().await.unwrap();

        registry.set_failed("dl-fail-1", "connection reset by peer".into());
        let event = tokio::time::timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timeout waiting for failed event")
            .expect("recv error");
        assert_eq!(event.id, "dl-fail-1");
        assert_eq!(event.status, DownloadStatus::Failed);
        assert_eq!(event.error.as_deref(), Some("connection reset by peer"));
    }

    #[test]
    fn test_download_registry_no_deadlock_on_rapid_transitions() {
        let registry = DownloadRegistry::new();
        let mut rx = registry.subscribe();

        let _flag = registry.register("dl-deadlock".into(), "https://a.com".into(), "/tmp/a".into());
        registry.set_started("dl-deadlock", Some(100));
        registry.update_progress("dl-deadlock", 50);
        assert!(registry.cancel("dl-deadlock"));

        // All transitions should be drained without locking or hanging
        let mut count = 0;
        while let Ok(_rec) = rx.try_recv() {
            count += 1;
        }
        assert!(count >= 3);
    }
}
