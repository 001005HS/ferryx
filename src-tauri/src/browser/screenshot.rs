use crate::browser::snapshot_source::*;

use crate::browser::remote_service::BrowserRemoteService;
use crate::ipc::error::{IpcError, IpcErrorCode};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

pub fn resolve_screenshot_path(path_str: &str) -> Result<PathBuf, IpcError> {
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return Err(IpcError::new(
            IpcErrorCode::InvalidArgument,
            "screenshot output path cannot be empty",
        ));
    }
    let path = if let Some(stripped) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs_home_dir() {
            home.join(stripped)
        } else {
            return Err(IpcError::new(
                IpcErrorCode::InvalidPath,
                "failed to expand home directory",
            ));
        }
    } else if trimmed == "~" {
        if let Some(home) = dirs_home_dir() {
            home
        } else {
            return Err(IpcError::new(
                IpcErrorCode::InvalidPath,
                "failed to expand home directory",
            ));
        }
    } else {
        PathBuf::from(trimmed)
    };

    let path = if path.is_relative() {
        std::env::current_dir()
            .map_err(|e| IpcError::new(IpcErrorCode::IoError, e.to_string()))?
            .join(path)
    } else {
        path
    };

    Ok(path)
}

fn dirs_home_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            if !profile.is_empty() {
                return Some(PathBuf::from(profile));
            }
        }
    }
    std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}

pub fn unsupported_screenshot_error() -> IpcError {
    IpcError::new(
        IpcErrorCode::Unsupported,
        "screenshots are unavailable on this platform: native webview capture is macOS-only in this build",
    )
}

#[cfg(target_os = "macos")]
pub async fn take_browser_screenshot<R: tauri::Runtime>(
    app: &AppHandle<R>,
    webview_label: &str,
    out_path: &str,
) -> Result<String, IpcError> {
    let target_path = resolve_screenshot_path(out_path)?;
    let source = TauriBrowserSnapshotSource::new(app.clone());
    take_browser_screenshot_with_source(&source, webview_label, target_path).await
}

#[cfg(not(target_os = "macos"))]
pub async fn take_browser_screenshot<R: tauri::Runtime>(
    app: &AppHandle<R>,
    webview_label: &str,
    out_path: &str,
) -> Result<String, IpcError> {
    use tauri::Manager;

    // Reject an unusable output path BEFORE reporting the platform limitation, so a
    // caller that asked for an impossible path gets that specific error instead of a
    // blanket `Unsupported`. Nothing is written here, so the resolved path is
    // deliberately dropped.
    resolve_screenshot_path(out_path).map(|_resolved_path| ())?;
    let _ = app
        .get_webview(webview_label)
        .ok_or_else(|| crate::browser::BrowserError::WebviewNotFound(webview_label.to_string()))?;
    Err(unsupported_screenshot_error())
}

pub async fn take_browser_screenshot_with_source<S: BrowserSnapshotSource + ?Sized>(
    source: &S,
    webview_label: &str,
    target_path: PathBuf,
) -> Result<String, IpcError> {
    let snapshot = source
        .capture_snapshot(webview_label, SnapshotOptions::png())
        .await?;

    let path_to_write = target_path.clone();
    crate::ipc::run_blocking(move || {
        if let Some(parent) = path_to_write.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        std::fs::write(&path_to_write, snapshot.bytes).map_err(|e| {
            IpcError::new(
                IpcErrorCode::BrowserScreenshotFailed,
                format!(
                    "failed to write screenshot to {}: {e}",
                    path_to_write.display()
                ),
            )
        })?;
        Ok(())
    })
    .await?;

    Ok(target_path.to_string_lossy().to_string())
}

/// Capability descriptor for native browser snapshots. The frontend uses this to
/// disable platform-limited affordances (element picking, screenshot capture)
/// instead of offering a control that can never complete.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSnapshotCapability {
    pub supported: bool,
    pub formats: Vec<String>,
}

/// Reports whether native webview snapshot capture is available in this build and
/// which encodings it supports. Non-macOS builds report the platform limitation here
/// instead of failing silently when a snapshot is requested.
#[tauri::command]
pub fn cmd_browser_snapshot_capability(
    service: State<'_, Arc<BrowserRemoteService>>,
) -> BrowserSnapshotCapability {
    let source = service.snapshot_source();
    BrowserSnapshotCapability {
        supported: service.is_snapshot_supported(),
        formats: source.supported_formats(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_screenshot_path() {
        assert!(resolve_screenshot_path("").is_err());
        assert!(resolve_screenshot_path("   ").is_err());

        let res = resolve_screenshot_path("~/my-shot.png").expect("expand tilde");
        assert!(res.to_str().unwrap().ends_with("my-shot.png"));
        assert!(!res.to_str().unwrap().starts_with('~'));

        let absolute_input = if cfg!(windows) { r"C:\tmp\direct.png" } else { "/tmp/direct.png" };
        let abs = resolve_screenshot_path(absolute_input).expect("absolute path");
        assert_eq!(abs, PathBuf::from(absolute_input));

        let rel = resolve_screenshot_path("shots/rel.png").expect("relative path");
        assert!(rel.is_absolute(), "relative input must be anchored to the current dir");
        assert!(rel.ends_with("shots/rel.png"));
    }

    #[tokio::test]
    async fn test_take_browser_screenshot_with_source_png_file_contract() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("shot.png");
        let source = FakeBrowserSnapshotSource::new(FakeSnapshotBehavior::Auto {
            width: 120,
            height: 90,
        });

        let saved_path =
            take_browser_screenshot_with_source(&source, "main-view", file_path.clone())
                .await
                .expect("should save PNG file");

        assert_eq!(saved_path, file_path.to_string_lossy().to_string());
        let read_bytes = std::fs::read(&file_path).expect("file should exist");
        assert!(read_bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[tokio::test]
    async fn test_take_browser_screenshot_with_source_unsupported_propagates() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("shot.png");
        let source = UnsupportedSnapshotSource;

        let err = take_browser_screenshot_with_source(&source, "main-view", file_path)
            .await
            .expect_err("should propagate unsupported error");

        assert_eq!(err.code, IpcErrorCode::Unsupported);
    }

    #[test]
    fn test_unsupported_screenshot_error_contract() {
        let err = unsupported_screenshot_error();
        assert_eq!(err.code, IpcErrorCode::Unsupported);
        let code_str = serde_json::to_value(&err.code)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap();
        assert_eq!(code_str, "UNSUPPORTED");
        assert!(err.message.contains("macOS-only"));
    }

    #[test]
    fn test_non_macos_screenshot_validates_path_before_unsupported() {
        assert_eq!(
            resolve_screenshot_path("").unwrap_err().code,
            IpcErrorCode::InvalidArgument
        );
        assert_eq!(
            resolve_screenshot_path("   ").unwrap_err().code,
            IpcErrorCode::InvalidArgument
        );
    }
}
