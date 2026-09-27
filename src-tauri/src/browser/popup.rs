//! Host-side registry and script builders for OAuth popups.
//!
//! A `window.open` popup is a real browser tab owned by the host, so the callback path
//! between the popup and its opener runs through the host. The previous implementation
//! used `BroadcastChannel`, which is same-origin and same-storage-partition only and
//! therefore delivered nothing between two webviews.
//!
//! This module holds the popup -> opener link and builds the scripts the host evaluates
//! in the opener tab. The IPC layer evaluates them, because only it holds the
//! `AppHandle` and the live webviews. Every builder embeds page-supplied data through
//! `serde_json`, never by raw interpolation.

use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// One popup tab, keyed by the popup's own browser id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PopupLink {
    /// The tab that called `window.open`.
    pub opener_browser_id: String,
    /// The opener page's own handle id (`window.__ferryxPopupHandles[handle]`), which is
    /// what the opener needs in order to mark the right handle closed.
    pub handle: String,
}

/// The JSON body a popup's `window.opener.postMessage(message, targetOrigin)` sends.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenerMessage {
    /// Absent when the page posted `undefined`, which is still a legal message.
    #[serde(default)]
    pub data: serde_json::Value,
    /// The origin the page asked for; `None` means the page passed nothing.
    #[serde(default)]
    pub target_origin: Option<String>,
}

fn links() -> &'static Mutex<HashMap<String, PopupLink>> {
    static LINKS: OnceLock<Mutex<HashMap<String, PopupLink>>> = OnceLock::new();
    LINKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pending_closes() -> &'static Mutex<HashSet<(String, String)>> {
    static PENDING: OnceLock<Mutex<HashSet<(String, String)>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Records that a handle was closed before its popup tab finished creation.
pub fn record_pending_close(opener_browser_id: &str, handle: &str) {
    pending_closes()
        .lock()
        .insert((opener_browser_id.to_string(), handle.to_string()));
}

/// Checks whether a pending close exists for `(opener_browser_id, handle)`.
pub fn is_pending_close(opener_browser_id: &str, handle: &str) -> bool {
    pending_closes()
        .lock()
        .contains(&(opener_browser_id.to_string(), handle.to_string()))
}

/// Takes and removes a pending close if one existed.
pub fn take_pending_close(opener_browser_id: &str, handle: &str) -> bool {
    pending_closes()
        .lock()
        .remove(&(opener_browser_id.to_string(), handle.to_string()))
}

/// Records that `popup_browser_id` is the popup of `opener_browser_id` for `handle`.
/// Returns `false` if the handle had already been closed via a pending close (in which case
/// the link is NOT registered and the caller must discard the newly created webview).
pub fn link(popup_browser_id: &str, opener_browser_id: &str, handle: &str) -> bool {
    if take_pending_close(opener_browser_id, handle) {
        return false;
    }
    links().lock().insert(
        popup_browser_id.to_string(),
        PopupLink {
            opener_browser_id: opener_browser_id.to_string(),
            handle: handle.to_string(),
        },
    );
    true
}

/// The link for a popup tab, if it is still open.
pub fn lookup(popup_browser_id: &str) -> Option<PopupLink> {
    links().lock().get(popup_browser_id).cloned()
}

/// The popup tab an opener created for one of its handles, if it is still open.
pub fn popup_for_handle(opener_browser_id: &str, handle: &str) -> Option<String> {
    links()
        .lock()
        .iter()
        .find(|(_, link)| link.opener_browser_id == opener_browser_id && link.handle == handle)
        .map(|(popup_browser_id, _)| popup_browser_id.clone())
}

/// Removes and returns the link of a closing popup, so its opener is notified once.
pub fn unlink(popup_browser_id: &str) -> Option<PopupLink> {
    links().lock().remove(popup_browser_id)
}

/// Drops every link and pending close. Tests only: the registry is process-wide.
#[cfg(test)]
pub fn clear_all() {
    links().lock().clear();
    pending_closes().lock().clear();
}

/// The origin of a URL the `BrowserManager` recorded for a tab.
///
/// This is the origin the opener sees on a popup's message. It is read from the tab's
/// recorded URL, never from the message, so a popup cannot claim to be another origin.
pub fn origin_of(url: &str) -> Option<String> {
    let parsed = tauri::Url::parse(url).ok()?;
    let origin = parsed.origin().ascii_serialization();
    if origin == "null" {
        None
    } else {
        Some(origin)
    }
}

/// Whether a popup's requested `targetOrigin` permits delivery to `opener_origin`.
///
/// `*` always permits it; anything else must equal the opener's origin exactly. An empty
/// or absent value does not permit it: the page never named a recipient, so the safe
/// direction is to refuse and say so.
pub fn target_origin_allows(opener_origin: &str, target_origin: &str) -> bool {
    let target = target_origin.trim();
    target == "*" || target == opener_origin
}

/// JSON-encodes a string for embedding in a script, escaping the sequences that would
/// otherwise break out of the surrounding source: `</` (an inline `</script>`), and the
/// two line separators older engines treat as line terminators even inside a string.
pub fn script_string(value: &str) -> String {
    let raw = serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string());
    escape_script_literals(&raw)
}

/// JSON-encodes a value for embedding in a script, with the same source-safety escapes.
pub fn embed_value(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_else(|_| "null".to_string());
    escape_script_literals(&raw)
}

fn escape_script_literals(raw: &str) -> String {
    raw.replace("</", "<\\/")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// Parses the `msg` parameter of an `opener.ferryx.invalid` action.
pub fn parse_opener_message(raw: &str) -> Option<OpenerMessage> {
    serde_json::from_str::<OpenerMessage>(raw).ok()
}

/// Dispatches a popup's message into the opener as a `message` event.
///
/// `origin` is the popup's recorded origin (see [`origin_of`]). `source` is initialized
/// as null for WebIDL safety (an arbitrary non-WindowProxy object passed to `MessageEventInit.source`
/// throws `TypeError` in WebIDL bindings), then enriched with an own-property `source` getter
/// pointing to `window.__ferryxPopupHandles[handle]` if available, allowing `event.source === popup`
/// checks in userland code where supported. Note that across separate webview processes,
/// a true DOM `WindowProxy` cannot exist; this provides synthetic handle identity.
pub fn opener_message_script(handle: &str, popup_origin: &str, data: &serde_json::Value) -> String {
    format!(
        r#"(() => {{
  const handleObj = (typeof window.__ferryxPopupHandles === 'object' && window.__ferryxPopupHandles)
    ? window.__ferryxPopupHandles[{handle}]
    : null;
  const event = new MessageEvent('message', {{
    data: {data},
    origin: {origin},
    source: null,
  }});
  if (handleObj) {{
    try {{
      Object.defineProperty(event, 'source', {{
        value: handleObj,
        configurable: true,
        enumerable: true,
        writable: false,
      }});
    }} catch (err) {{
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {{
        console.warn('[ferryx] failed to define event.source on opener message:', err);
      }}
    }}
  }}
  window.dispatchEvent(event);
  return JSON.stringify({{ ok: true, handle: {handle} }});
}})()"#,
        data = embed_value(data),
        origin = script_string(popup_origin),
        handle = script_string(handle),
    )
}

/// Dispatches an opener's message into the popup as a `message` event.
///
/// `origin` is the opener's recorded origin (see [`origin_of`]). `source` is initialized
/// as null for WebIDL safety, then enriched with an own-property `source` pointing to
/// `window.opener` (`openerProxy`) if available, allowing child popup
/// `event.source === window.opener` checks.
pub fn popup_message_script(opener_origin: &str, data: &serde_json::Value) -> String {
    format!(
        r#"(() => {{
  const openerObj = (typeof window.opener === 'object' && window.opener) ? window.opener : null;
  const event = new MessageEvent('message', {{
    data: {data},
    origin: {origin},
    source: null,
  }});
  if (openerObj) {{
    try {{
      Object.defineProperty(event, 'source', {{
        value: openerObj,
        configurable: true,
        enumerable: true,
        writable: false,
      }});
    }} catch (err) {{
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {{
        console.warn('[ferryx] failed to define event.source on popup message:', err);
      }}
    }}
  }}
  window.dispatchEvent(event);
  return JSON.stringify({{ ok: true }});
}})()"#,
        data = embed_value(data),
        origin = script_string(opener_origin),
    )
}

/// Tells the opener that its message to a popup handle was refused due to targetOrigin mismatch.
pub fn popup_message_rejected_script(
    target_origin: &str,
    popup_origin: &str,
    opener_origin: &str,
) -> String {
    format!(
        r#"(() => {{
  const text = '[ferryx] popup handle message refused: the opener asked for targetOrigin ' + {target}
    + ' but this popup is ' + {popup} + ' (opener origin ' + {opener} + ')';
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {{
    console.warn(text);
  }}
  return JSON.stringify({{ ok: false, reason: 'targetOrigin mismatch' }});
}})()"#,
        target = script_string(target_origin),
        popup = script_string(popup_origin),
        opener = script_string(opener_origin),
    )
}

/// Tells the opener that a popup's message was refused, instead of dropping it silently.
pub fn opener_message_rejected_script(
    target_origin: &str,
    opener_origin: &str,
    popup_origin: &str,
) -> String {
    format!(
        r#"(() => {{
  const text = '[ferryx] popup message refused: the popup asked for targetOrigin ' + {target}
    + ' but this tab is ' + {opener} + ' (popup origin ' + {popup} + ')';
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {{
    console.warn(text);
  }}
  return JSON.stringify({{ ok: false, reason: 'targetOrigin mismatch' }});
}})()"#,
        target = script_string(target_origin),
        opener = script_string(opener_origin),
        popup = script_string(popup_origin),
    )
}

/// Marks the opener's handle for a closed popup, so `popup.closed` reads real state.
pub fn popup_closed_script(handle: &str) -> String {
    format!(
        r#"(() => {{
  if (typeof window.__ferryxPopupClosed !== 'function') {{
    return JSON.stringify({{ ok: false, reason: 'the popup bridge is not installed in this tab' }});
  }}
  return JSON.stringify({{ ok: window.__ferryxPopupClosed({handle}) === true }});
}})()"#,
        handle = script_string(handle),
    )
}

/// A warning to evaluate in the page whose message could not be routed, so the failure is
/// visible in that page's console instead of vanishing.
pub fn page_warning_script(message: &str) -> String {
    format!(
        r#"(() => {{
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {{
    console.warn({message});
  }}
  return JSON.stringify({{ ok: false }});
}})()"#,
        message = script_string(message),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_links_looks_up_and_unlinks() {
        // RED when `unlink` stops removing the entry (returns the link but leaves it
        // registered), or when `popup_for_handle` matches on the handle alone.
        clear_all();
        link("popup-1", "opener-1", "p1");
        link("popup-2", "opener-2", "p1");

        assert_eq!(
            lookup("popup-1"),
            Some(PopupLink {
                opener_browser_id: "opener-1".into(),
                handle: "p1".into(),
            })
        );
        // The same handle id in two openers addresses two different popups.
        assert_eq!(
            popup_for_handle("opener-1", "p1").as_deref(),
            Some("popup-1")
        );
        assert_eq!(
            popup_for_handle("opener-2", "p1").as_deref(),
            Some("popup-2")
        );
        assert_eq!(popup_for_handle("opener-1", "p2"), None);

        assert_eq!(
            unlink("popup-1").map(|link| link.opener_browser_id),
            Some("opener-1".into())
        );
        assert_eq!(lookup("popup-1"), None);
        assert_eq!(popup_for_handle("opener-1", "p1"), None);
        assert_eq!(unlink("popup-1"), None);
        assert_eq!(lookup("never-linked"), None);
        clear_all();
    }

    #[test]
    fn pending_close_prevents_late_linking_and_handles_race() {
        // Deterministic regression: when opener calls popup.close() before creation completes,
        // pending close is recorded. When link() runs later, it detects pending close,
        // refuses registration (returns false), and leaves the registry clean.
        clear_all();
        record_pending_close("opener-race", "p_fast_close");
        assert!(is_pending_close("opener-race", "p_fast_close"));
        assert!(!is_pending_close("opener-race", "other_handle"));

        // Late creation attempt is rejected:
        let linked = link("popup-late", "opener-race", "p_fast_close");
        assert!(!linked, "link must return false when handle was already pending close");
        assert_eq!(lookup("popup-late"), None);
        assert_eq!(popup_for_handle("opener-race", "p_fast_close"), None);
        assert!(!is_pending_close("opener-race", "p_fast_close"));

        // Subsequent link without pending close succeeds:
        assert!(link("popup-normal", "opener-race", "p_normal"));
        assert_eq!(
            popup_for_handle("opener-race", "p_normal").as_deref(),
            Some("popup-normal")
        );
        clear_all();
    }

    #[test]
    fn popup_message_script_embeds_opener_origin_and_binds_opener_source() {
        // RED when Object.defineProperty fails silently instead of logging diagnostics,
        // or when source configuration suppresses event dispatch.
        let data = serde_json::json!({ "token": "oauth_token_123" });
        let script = popup_message_script("https://app.example.com", &data);

        assert!(script.contains("origin: \"https://app.example.com\""));
        assert!(script.contains("oauth_token_123"));
        assert!(script.contains("source: null"));
        assert!(script.contains("window.opener"));
        assert!(script.contains("Object.defineProperty(event, 'source'"));
        assert!(script.contains("catch (err)"));
        assert!(script.contains("[ferryx] failed to define event.source on popup message:"));
        assert!(script.contains("console.warn"));
        assert!(script.contains("window.dispatchEvent(event)"));
    }

    #[test]
    fn popup_message_rejected_script_warns_on_target_origin_mismatch() {
        let rejected = popup_message_rejected_script(
            "https://expected-popup.com",
            "https://actual-popup.com",
            "https://app.example.com",
        );
        assert!(rejected.contains("console.warn"));
        assert!(rejected.contains("https://expected-popup.com"));
        assert!(rejected.contains("https://actual-popup.com"));
        assert!(rejected.contains("https://app.example.com"));
        assert!(rejected.contains("targetOrigin mismatch"));
        assert!(!rejected.contains("dispatchEvent"));
    }

    #[test]
    fn opener_message_script_carries_the_recorded_origin_and_escapes_hostile_data() {
        // RED when Object.defineProperty fails silently instead of logging diagnostics,
        // or when source configuration suppresses event dispatch, or when the builder
        // interpolates the origin or data raw.
        let data = serde_json::json!({
            "code": "a\"b\\c",
            "html": "</script><script>alert(1)</script>",
            "line": "a\u{2028}b\u{2029}c",
        });
        let script = opener_message_script("p1", "https://auth.example.com", &data);

        assert!(script.contains("origin: \"https://auth.example.com\""));
        assert!(script.contains("handle: \"p1\""));
        assert!(script.contains(r#"a\"b\\c"#));
        assert!(script.contains("<\\/script>"));
        assert!(!script.contains("</script>"));
        assert!(script.contains("\\u2028"));
        assert!(script.contains("\\u2029"));
        assert!(!script.contains('\u{2028}'));
        assert!(!script.contains('\u{2029}'));
        // A `MessageEvent` source must be a WindowProxy or MessagePort, so the handle is
        // never passed as one.
        assert!(script.contains("source: null"));
        assert!(!script.contains("source: source"));
        assert!(script.contains("catch (err)"));
        assert!(script.contains("[ferryx] failed to define event.source on opener message:"));
        assert!(script.contains("console.warn"));
        assert!(script.contains("window.dispatchEvent(event)"));

        // The recorded origin wins over any origin the message claims: the claimed origin
        // has no parameter here at all.
        assert!(!script.contains("targetOrigin"));
    }

    #[test]
    fn target_origin_mismatch_is_refused_with_a_visible_warning() {
        // RED when `target_origin_allows` returns true for any value, or when the refusal
        // script stops warning (a silent drop is what this lane exists to remove).
        assert!(target_origin_allows("https://app.example.com", "*"));
        assert!(target_origin_allows("https://app.example.com", " * "));
        assert!(target_origin_allows(
            "https://app.example.com",
            "https://app.example.com"
        ));
        assert!(!target_origin_allows(
            "https://app.example.com",
            "https://evil.example.com"
        ));
        assert!(!target_origin_allows("https://app.example.com", ""));
        assert!(!target_origin_allows(
            "https://app.example.com",
            "https://app.example.com.evil.test"
        ));

        let rejected = opener_message_rejected_script(
            "https://evil.example.com",
            "https://app.example.com",
            "https://auth.example.com",
        );
        assert!(rejected.contains("console.warn"));
        assert!(rejected.contains("https://evil.example.com"));
        assert!(rejected.contains("https://app.example.com"));
        assert!(rejected.contains("https://auth.example.com"));
        assert!(!rejected.contains("dispatchEvent"));
    }

    #[test]
    fn popup_closed_script_calls_the_handle_hook() {
        // RED when the builder stops calling `window.__ferryxPopupClosed`, which is the
        // only thing that makes the opener's handle report `closed === true`.
        let script = popup_closed_script("p3");
        assert!(script.contains("window.__ferryxPopupClosed(\"p3\")"));
        assert!(script.contains("'the popup bridge is not installed in this tab'"));
    }

    #[test]
    fn page_warning_script_reports_instead_of_dropping() {
        // RED when the script stops warning (the page then sees nothing at all).
        let script = page_warning_script("no opener is linked to this popup");
        assert!(script.contains("console.warn"));
        assert!(script.contains("no opener is linked to this popup"));
    }

    #[test]
    fn origin_of_reads_the_recorded_url_origin() {
        // RED when the origin is taken from the message instead of the recorded URL.
        assert_eq!(
            origin_of("https://example.com/path?q=1"),
            Some("https://example.com".into())
        );
        assert_eq!(
            origin_of("https://example.com:8443/x"),
            Some("https://example.com:8443".into())
        );
        assert_eq!(
            origin_of("http://localhost:3000/callback"),
            Some("http://localhost:3000".into())
        );
        // Opaque origins cannot be matched by a targetOrigin, so they are refused.
        assert_eq!(origin_of("about:blank"), None);
        assert_eq!(origin_of("data:text/html,<p>x</p>"), None);
        assert_eq!(origin_of("not a url"), None);
    }

    #[test]
    fn parse_opener_message_reads_data_and_target_origin() {
        // RED when `targetOrigin` stops being read (every popup message would then be
        // treated as if the page asked for nothing).
        let parsed = parse_opener_message(r#"{"data":{"code":"abc"},"targetOrigin":"*"}"#)
            .expect("parse opener message");
        assert_eq!(parsed.data, serde_json::json!({ "code": "abc" }));
        assert_eq!(parsed.target_origin.as_deref(), Some("*"));

        let bare = parse_opener_message(r#"{"data":"token"}"#).expect("parse bare message");
        assert_eq!(bare.data, serde_json::json!("token"));
        assert_eq!(bare.target_origin, None);

        assert_eq!(parse_opener_message("not json"), None);
    }
}
