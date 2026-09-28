use crate::ipc::{run_blocking, IpcError, IpcErrorCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

pub const REMOTE_FILE_MAX_BYTES: usize = 8 * 1024 * 1024;

fn invalid_remote_path(message: impl Into<String>) -> IpcError {
    IpcError::new(IpcErrorCode::InvalidRequest, message.into())
        .with_details(serde_json::json!({ "reason": "invalidRemotePath" }))
}

pub fn remote_target_path(input: &str, base: &str) -> Result<String, IpcError> {
    if input.is_empty() || input.chars().any(char::is_control) {
        return Err(invalid_remote_path(
            "Remote path cannot be empty or contain control characters",
        ));
    }

    let raw = if input.starts_with('/') {
        input.to_string()
    } else {
        if base.is_empty() || !base.starts_with('/') || base.chars().any(char::is_control) {
            return Err(invalid_remote_path(
                "Base path must be an absolute POSIX path without control characters",
            ));
        }
        if base.ends_with('/') {
            format!("{base}{input}")
        } else {
            format!("{base}/{input}")
        }
    };

    let mut segments: Vec<&str> = Vec::new();
    for segment in raw.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                if segments.pop().is_none() {
                    return Err(invalid_remote_path(
                        "Remote path climbs above root directory",
                    ));
                }
            }
            s => segments.push(s),
        }
    }

    let normalized = if segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", segments.join("/"))
    };

    crate::ssh::direct::validate_remote_path(&normalized)
        .map_err(|e| invalid_remote_path(e.message))?;

    Ok(normalized)
}

pub fn remote_cache_path(cache_root: &Path, workspace_id: &str, remote_path: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(workspace_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(remote_path.as_bytes());
    let hex_digest = format!("{:x}", hasher.finalize());
    let dir_name = &hex_digest[..32];

    let raw_basename = remote_path.rsplit('/').next().unwrap_or("");
    let sanitized: String = raw_basename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();

    let file_name = if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "file"
    } else {
        &sanitized
    };

    cache_root
        .join("remote-files")
        .join(dir_name)
        .join(file_name)
}

pub fn remote_read_command(remote_path: &str) -> String {
    let q = crate::ssh::direct::quote_posix(remote_path);
    format!(
        "test -f {q} || exit 3; head -c {} -- {q}",
        REMOTE_FILE_MAX_BYTES + 1
    )
}

pub(crate) fn ensure_within_limit(len: usize, max: usize) -> Result<(), IpcError> {
    if len > max {
        return Err(IpcError::new(
            IpcErrorCode::PayloadTooLarge,
            format!("Remote file exceeds maximum preview size of {} bytes", max),
        )
        .with_details(serde_json::json!({
            "reason": "remoteFileTooLarge",
            "maxBytes": max,
        })));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileFetched {
    pub local_path: String,
    pub remote_path: String,
    pub byte_length: u64,
}

#[tauri::command]
pub async fn cmd_remote_file_fetch<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    path: String,
    cwd: Option<String>,
) -> Result<RemoteFileFetched, IpcError> {
    let host_store = crate::ipc::ssh::get_ssh_store_path(&app)?;
    let ws_lookup = workspace_id.clone();
    let (project, host) = run_blocking(move || {
        crate::ssh::projects::resolve(&host_store, &ws_lookup)
    })
    .await?;

    if let Some(platform) = project.platform {
        if platform != crate::ssh::runtime::RemotePlatform::Posix {
            return Err(IpcError::new(
                IpcErrorCode::Unsupported,
                "Remote file fetch is only supported on POSIX remote platforms",
            )
            .with_details(serde_json::json!({
                "reason": "unsupportedRemotePlatform",
                "platform": platform,
            })));
        }
    }

    let base = match cwd.as_deref() {
        Some(c) if c.starts_with('/') => c,
        _ => &project.repo_root,
    };

    let remote_path = remote_target_path(&path, base)?;
    let command = remote_read_command(&remote_path);
    let plan = crate::ssh::direct::ssh_plan(&host, command, false)?;

    let deadline = Duration::from_secs(30);
    let max_wire_bytes = REMOTE_FILE_MAX_BYTES + 1;
    let bytes_res =
        crate::ssh::direct::bounded_output_with_limit(&plan, deadline, max_wire_bytes).await;

    let bytes = match bytes_res {
        Ok(b) => b,
        Err(err) => {
            let is_missing = err
                .details
                .as_ref()
                .and_then(|d| d.get("exitCode"))
                .and_then(|c| c.as_i64())
                == Some(3);
            if is_missing {
                return Err(IpcError::new(
                    IpcErrorCode::NotFound,
                    format!("Remote file not found or not a regular file: {remote_path}"),
                )
                .with_details(serde_json::json!({ "reason": "remoteFileMissing" })));
            }
            return Err(err);
        }
    };

    ensure_within_limit(bytes.len(), REMOTE_FILE_MAX_BYTES)?;

    let cache_root = app.path().app_cache_dir().map_err(|e| {
        IpcError::new(
            IpcErrorCode::IoError,
            format!("Failed to resolve app cache directory: {e}"),
        )
    })?;

    let local_target = remote_cache_path(&cache_root, &workspace_id, &remote_path);
    let target_for_write = local_target.clone();
    let byte_length = bytes.len() as u64;

    run_blocking(move || {
        let parent = target_for_write.parent().ok_or_else(|| {
            IpcError::new(
                IpcErrorCode::IoError,
                "Missing parent directory for cache file",
            )
        })?;
        std::fs::create_dir_all(parent).map_err(|e| {
            IpcError::new(
                IpcErrorCode::IoError,
                format!("Failed to create cache directory: {e}"),
            )
        })?;

        let temp = target_for_write.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let write_result = (|| {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            std::fs::rename(&temp, &target_for_write)
        })();

        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&temp);
            return Err(IpcError::new(
                IpcErrorCode::IoError,
                format!("Failed to write cached remote file: {error}"),
            ));
        }

        Ok(())
    })
    .await?;

    Ok(RemoteFileFetched {
        local_path: local_target.to_string_lossy().to_string(),
        remote_path,
        byte_length,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remote_target_path_absolute_passthrough() {
        assert_eq!(
            remote_target_path("/var/log/syslog", "/home/user").unwrap(),
            "/var/log/syslog"
        );
        assert_eq!(
            remote_target_path("/etc/nginx/nginx.conf", "/home/user").unwrap(),
            "/etc/nginx/nginx.conf"
        );
    }

    #[test]
    fn test_remote_target_path_relative_join() {
        assert_eq!(
            remote_target_path("src/lib.rs", "/home/user/project").unwrap(),
            "/home/user/project/src/lib.rs"
        );
        assert_eq!(
            remote_target_path("config.json", "/home/user/project/").unwrap(),
            "/home/user/project/config.json"
        );
        assert_eq!(
            remote_target_path("./file.txt", "/home/user/project").unwrap(),
            "/home/user/project/file.txt"
        );
    }

    #[test]
    fn test_remote_target_path_dot_dot_normalization_inside_root() {
        assert_eq!(
            remote_target_path("src/../docs/readme.md", "/home/user/project").unwrap(),
            "/home/user/project/docs/readme.md"
        );
        assert_eq!(
            remote_target_path("/a/b/../c/./d", "/base").unwrap(),
            "/a/c/d"
        );
        assert_eq!(remote_target_path("..", "/a/b").unwrap(), "/a");
        assert_eq!(remote_target_path("../c", "/a/b").unwrap(), "/a/c");
        assert_eq!(
            remote_target_path("sub/../../a/b", "/home/user").unwrap(),
            "/home/a/b"
        );
    }

    #[test]
    fn test_remote_target_path_climbing_above_root_rejected() {
        let err1 = remote_target_path("/..", "/base").unwrap_err();
        assert_eq!(err1.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err1.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );

        let err2 = remote_target_path("/a/../..", "/base").unwrap_err();
        assert_eq!(err2.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err2.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );

        let err3 = remote_target_path("../../etc/passwd", "/home").unwrap_err();
        assert_eq!(err3.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err3.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );

        let err4 = remote_target_path("..", "/").unwrap_err();
        assert_eq!(err4.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err4.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );
    }

    #[test]
    fn test_remote_target_path_control_char_rejected() {
        let err_nul = remote_target_path("/path/with\0null", "/base").unwrap_err();
        assert_eq!(err_nul.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err_nul.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );

        let err_nl = remote_target_path("/path/with\nnewline", "/base").unwrap_err();
        assert_eq!(err_nl.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err_nl.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );

        let err_cr = remote_target_path("/path/with\rreturn", "/base").unwrap_err();
        assert_eq!(err_cr.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err_cr.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );

        let err_tab = remote_target_path("some\tfile.txt", "/base").unwrap_err();
        assert_eq!(err_tab.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err_tab.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );
    }

    #[test]
    fn test_remote_target_path_empty_rejected() {
        let err_empty = remote_target_path("", "/base").unwrap_err();
        assert_eq!(err_empty.code, IpcErrorCode::InvalidRequest);
        assert_eq!(
            err_empty.details.as_ref().unwrap().get("reason").unwrap(),
            "invalidRemotePath"
        );
    }

    #[test]
    fn test_remote_cache_path_deterministic() {
        let cache_root = Path::new("/var/cache/ferryx");
        let p1 = remote_cache_path(cache_root, "ssh:ws-1", "/home/user/project/file.txt");
        let p2 = remote_cache_path(cache_root, "ssh:ws-1", "/home/user/project/file.txt");
        assert_eq!(p1, p2);
    }

    #[test]
    fn test_remote_cache_path_differs_per_workspace() {
        let cache_root = Path::new("/var/cache/ferryx");
        let p1 = remote_cache_path(cache_root, "ssh:ws-1", "/home/user/project/file.txt");
        let p2 = remote_cache_path(cache_root, "ssh:ws-2", "/home/user/project/file.txt");
        assert_ne!(p1, p2);
    }

    #[test]
    fn test_remote_cache_path_sanitizes_basename() {
        let cache_root = Path::new("/var/cache/ferryx");
        let path = remote_cache_path(cache_root, "ssh:ws-1", "/home/user/a b;.txt");
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "a_b_.txt");

        let path_empty_slash = remote_cache_path(cache_root, "ssh:ws-1", "/");
        assert_eq!(
            path_empty_slash.file_name().unwrap().to_str().unwrap(),
            "file"
        );

        let path_trailing_slash = remote_cache_path(cache_root, "ssh:ws-1", "/dir/");
        assert_eq!(
            path_trailing_slash.file_name().unwrap().to_str().unwrap(),
            "file"
        );
    }

    #[test]
    fn test_remote_cache_path_stays_under_cache_root() {
        let cache_root = Path::new("/var/cache/ferryx");
        let p1 = remote_cache_path(cache_root, "ssh:ws-1", "/home/user/a b;.txt");
        assert!(p1.starts_with(cache_root));

        let p2 = remote_cache_path(cache_root, "ssh:ws-1", "/..");
        assert!(p2.starts_with(cache_root));

        let p3 = remote_cache_path(cache_root, "ssh:ws-1", "/");
        assert!(p3.starts_with(cache_root));

        let p4 = remote_cache_path(cache_root, "ssh:ws-1", "..");
        assert!(p4.starts_with(cache_root));
    }

    #[test]
    fn test_remote_read_command_quotes_path_with_single_quote() {
        let cmd = remote_read_command("/path/with'quote/file.txt");
        assert!(cmd.contains("'/path/with'\\''quote/file.txt'"));
        assert_eq!(
            cmd,
            format!(
                "test -f '/path/with'\\''quote/file.txt' || exit 3; head -c {} -- '/path/with'\\''quote/file.txt'",
                REMOTE_FILE_MAX_BYTES + 1
            )
        );
    }

    #[test]
    fn test_ensure_within_limit() {
        let max = REMOTE_FILE_MAX_BYTES;
        assert!(ensure_within_limit(0, max).is_ok());
        assert!(ensure_within_limit(max, max).is_ok());

        let err = ensure_within_limit(max + 1, max).unwrap_err();
        assert_eq!(err.code, IpcErrorCode::PayloadTooLarge);
        let details = err.details.as_ref().expect("details must be present");
        assert_eq!(
            details.get("reason").unwrap(),
            "remoteFileTooLarge"
        );
        assert_eq!(
            details.get("maxBytes").and_then(|v| v.as_u64()),
            Some(max as u64)
        );
        assert_eq!(
            details.get("maxBytes").unwrap(),
            &serde_json::json!(max)
        );
    }
}
