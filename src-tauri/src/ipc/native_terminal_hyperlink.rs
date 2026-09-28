use crate::ipc::IpcError;
use crate::native_terminal::surface_host::NativeTerminalSurfaceHostState;

#[tauri::command]
pub async fn cmd_native_terminal_hyperlink_at(
    state: tauri::State<'_, NativeTerminalSurfaceHostState>,
    session_id: String,
    col: u16,
    row: u16,
) -> Result<Option<String>, IpcError> {
    state
        .inner()
        .with_session_terminal(&session_id, |t| t.hyperlink_uri_at(col, row))
        .map_err(|e| IpcError::internal(e.to_string()))
}
