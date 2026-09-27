use tauri::Url;

pub const BROWSER_SESSION_CREATED_EVENT: &str = "browser_session_created";
pub const BROWSER_OPEN_REQUESTED_EVENT: &str = "browser_open_requested";
pub const BROWSER_DOWNLOAD_REQUESTED_EVENT: &str = "browser_download_requested";
pub const BROWSER_SHORTCUT_REQUESTED_EVENT: &str = "browser_shortcut_requested";
pub const BROWSER_ELEMENT_PICKED_EVENT: &str = "browser_element_picked";
pub const BROWSER_LINK_CLICKED_EVENT: &str = "browser_link_clicked";
pub const BROWSER_CLOSE_REQUESTED_EVENT: &str = "browser_close_requested";

const OPEN_HOST: &str = "open.ferryx.invalid";
const DOWNLOAD_HOST: &str = "download.ferryx.invalid";
const SHORTCUT_HOST: &str = "shortcut.ferryx.invalid";
const PICK_HOST: &str = "pick.ferryx.invalid";
const CLICK_HOST: &str = "click.ferryx.invalid";
const MODCLICK_HOST: &str = "modclick.ferryx.invalid";
/// `window.open` from a page: params `url`, `handle`, `op=open|navigate`.
const POPUP_HOST: &str = "popup.ferryx.invalid";
/// `window.close()` from a popup tab.
const POPUP_CLOSE_HOST: &str = "popupclose.ferryx.invalid";
/// `window.opener.postMessage(...)` from a popup tab: param `msg` = JSON
/// `{ data, targetOrigin }`.
const OPENER_HOST: &str = "opener.ferryx.invalid";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserGuestAction {
    Open(String),
    Download(String),
    Shortcut(String),
    ElementPick,
    LinkClick(String),
    ModifierLinkClick(String),
    /// The host creates the popup tab and links it to `handle`, the opener's
    /// per-page popup id.
    PopupOpen { url: String, handle: String },
    /// A later `location.href` / `assign` / `replace` on an already-routed handle.
    PopupNavigate { url: String, handle: String },
    /// `window.opener.postMessage(...)` from a popup tab.
    OpenerMessage { message: String },
    /// `window.close()` from a popup tab.
    PopupCloseRequested,
    /// `handle.close()` from the opener tab for a specific popup handle.
    PopupCloseHandle { handle: String },
    /// `handle.postMessage(...)` from the opener tab to a specific popup handle.
    PopupMessage { handle: String, message: String },
}

pub fn parse_browser_guest_action(url: &Url, expected_nonce: &str) -> Option<BrowserGuestAction> {
    let host = url.host_str()?;
    if query_value(url, "nonce").as_deref() != Some(expected_nonce) {
        return None;
    }
    match host {
        OPEN_HOST => query_value(url, "url").map(BrowserGuestAction::Open),
        DOWNLOAD_HOST => query_value(url, "url").map(BrowserGuestAction::Download),
        SHORTCUT_HOST => query_value(url, "action").map(BrowserGuestAction::Shortcut),
        PICK_HOST => Some(BrowserGuestAction::ElementPick),
        CLICK_HOST => query_value(url, "url").map(BrowserGuestAction::LinkClick),
        MODCLICK_HOST => query_value(url, "url").map(BrowserGuestAction::ModifierLinkClick),
        POPUP_HOST => {
            let handle = query_value(url, "handle")?;
            match query_value(url, "op").as_deref() {
                Some("close") => Some(BrowserGuestAction::PopupCloseHandle { handle }),
                Some("message") | Some("postmessage") => {
                    let message = query_value(url, "msg")?;
                    Some(BrowserGuestAction::PopupMessage { handle, message })
                }
                Some("navigate") => {
                    let target = query_value(url, "url")?;
                    Some(BrowserGuestAction::PopupNavigate {
                        url: target,
                        handle,
                    })
                }
                Some("open") | None => {
                    let target = query_value(url, "url")?;
                    Some(BrowserGuestAction::PopupOpen {
                        url: target,
                        handle,
                    })
                }
                Some(_) => None,
            }
        }
        POPUP_CLOSE_HOST => match query_value(url, "handle") {
            Some(handle) => Some(BrowserGuestAction::PopupCloseHandle { handle }),
            None => Some(BrowserGuestAction::PopupCloseRequested),
        },
        OPENER_HOST => {
            query_value(url, "msg").map(|message| BrowserGuestAction::OpenerMessage { message })
        }
        _ => None,
    }
}

fn query_value(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.trim().is_empty())
}

const BRIDGE_NONCE_PLACEHOLDER: &str = "__FERRYX_BROWSER_BRIDGE_NONCE__";
const BRIDGE_HARD_RELOAD_PLACEHOLDER: &str = "__FERRYX_BROWSER_BRIDGE_HARD_RELOAD__";
const POPUP_SURFACE_PLACEHOLDER: &str = "__FERRYX_IS_POPUP_SURFACE__";

/// Source of the popup-only bridge surface, substituted for
/// [`POPUP_SURFACE_PLACEHOLDER`].
///
/// The surface is substituted as source rather than gated behind a `true`/`false`
/// placeholder so a tab the host did NOT create as a popup cannot even contain the
/// opener proxy: real OAuth callback pages branch on `if (window.opener)`, and a fake
/// opener makes them postMessage into a proxy nobody reads and call close() instead of
/// continuing the redirect flow. The non-popup test pins that absence.
const POPUP_SURFACE_SOURCE: &str = r#"
  // Popup-only surface: this tab WAS opened by another tab, so it gets an opener
  // proxy whose messages travel through the host to the real opener webview.
  const openerProxy = {
    closed: false,
    postMessage: (message, targetOrigin) => {
      let payload;
      try {
        payload = JSON.stringify({ data: message, targetOrigin: targetOrigin || '*' });
      } catch (error) {
        pushConsoleEntry('warn', '[popup:opener-message] could not serialize the message: ' + error);
        return;
      }
      route('opener.ferryx.invalid', 'msg', payload);
    },
    focus: () => {},
    blur: () => {},
    location: {
      get href() {
        return '';
      },
      set href(value) {
        // The host protocol has no "navigate the opener" op, so say so instead of
        // pretending the redirect happened.
        pushConsoleEntry('warn', '[popup:opener-location] window.opener.location is not supported: ' + value);
      },
    },
  };
  try {
    window.opener = openerProxy;
  } catch (assignError) {
    // Some engines expose `opener` as an accessor that refuses plain assignment.
    try {
      Object.defineProperty(window, 'opener', {
        value: openerProxy,
        writable: true,
        configurable: true,
      });
    } catch (defineError) {
      reportBridgeFailure('could not install window.opener (' + assignError + ')', defineError);
    }
  }
  try {
    Object.defineProperty(window, '__ferryxOpenerProxyInstalled', { value: true });
  } catch (error) {
    reportBridgeFailure('could not mark the opener proxy as installed', error);
  }

  // window.close() in a popup asks the host to close this tab, and the host is the only
  // thing that can: it owns the tab, and its close path is what calls
  // window.__ferryxPopupClosed(handle) in the opener. Closing the webview directly here
  // would skip that bookkeeping and leave the opener's handle reporting `closed === false`
  // forever.
  window.close = () => {
    routeHost('popupclose.ferryx.invalid');
  };
"#;

/// Builds the guest bridge initialization script for one browser webview.
/// `nonce` is JSON-encoded into the script and required as an extra query
/// parameter on every routed control URL, so a page that never received the
/// bridge cannot forge open/download/shortcut requests (see
/// `parse_browser_guest_action`).
///
/// `is_popup` is true only for a tab the host created because a page called
/// `window.open`; every other tab must keep `window.opener` null (see
/// [`POPUP_SURFACE_SOURCE`]).
pub fn browser_guest_bridge_script(nonce: &str, is_popup: bool) -> String {
    let nonce_json = serde_json::to_string(nonce).unwrap_or_else(|_| "\"\"".to_string());
    BRIDGE_SCRIPT_TEMPLATE
        .replace(BRIDGE_NONCE_PLACEHOLDER, &nonce_json)
        .replace(
            POPUP_SURFACE_PLACEHOLDER,
            if is_popup { POPUP_SURFACE_SOURCE } else { "" },
        )
        .replace(
            BRIDGE_HARD_RELOAD_PLACEHOLDER,
            if crate::browser::hard_reload::hard_reload_supported() {
                "true"
            } else {
                "false"
            },
        )
}

const BRIDGE_SCRIPT_TEMPLATE: &str = r#"
(() => {
  if (window.__ferryxBrowserBridgeInstalled) return;
  Object.defineProperty(window, '__ferryxBrowserBridgeInstalled', { value: true });

  // Captured before the console patch below so a failure inside the capture machinery
  // itself can still be reported without recursing back through the patched console.
  const nativeConsoleWarn = typeof console !== 'undefined' && typeof console.warn === 'function'
    ? console.warn.bind(console)
    : null;

  const consoleRing = (window.__FERRYX_BROWSER_CONSOLE__ = window.__FERRYX_BROWSER_CONSOLE__ || []);
  const pushConsoleEntry = (level, text) => {
    try {
      while (consoleRing.length >= 500) {
        consoleRing.shift();
      }
      consoleRing.push({
        level: String(level),
        text: String(text),
        atMs: Date.now(),
      });
    } catch (error) {
      // The ring itself is broken, so the entry cannot be recorded. Report it on the
      // native console only: the patched console pushes into this same ring, so going
      // through it here would recurse forever.
      if (nativeConsoleWarn) nativeConsoleWarn.call(console, '[ferryx] console capture failed', error);
    }
  };

  // A swallowed failure is invisible to `ferryx browser console`, which is how a broken
  // OAuth callback turns into "nothing happened". Every catch in this bridge therefore
  // reports what failed -- into the ring first, so the CLI can read it -- while still
  // containing the error so the page keeps running.
  const reportBridgeFailure = (what, error) => {
    const detail = error && error.message ? String(error.message) : String(error);
    const text = '[ferryx] ' + what + ': ' + detail;
    try {
      pushConsoleEntry('warn', text);
    } catch (nested) {
      if (nativeConsoleWarn) nativeConsoleWarn.call(console, text, nested);
    }
  };

  ['log', 'info', 'warn', 'error'].forEach((level) => {
    const original = console[level];
    if (typeof original === 'function') {
      console[level] = function (...args) {
        try {
          const text = args.map((arg) => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') {
              try { return JSON.stringify(arg); } catch (_) { return String(arg); }
            }
            return String(arg);
          }).join(' ');
          pushConsoleEntry(level, text);
        } catch (error) {
          reportBridgeFailure('console capture failed', error);
        }
        return original.apply(this, args);
      };
    }
  });

  const originalOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    try {
      const text = error && error.stack ? String(error.stack) : `${message} at ${source}:${lineno}:${colno}`;
      pushConsoleEntry('error', text);
    } catch (error) {
      reportBridgeFailure('window.onerror capture failed', error);
    }
    if (typeof originalOnError === 'function') {
      return originalOnError.apply(this, arguments);
    }
    return false;
  };

  // Host-controlled JS Dialog interception (alert, confirm, prompt)
  const dialogHistory = (window.__FERRYX_BROWSER_DIALOGS__ = window.__FERRYX_BROWSER_DIALOGS__ || []);
  const dialogState = (window.__FERRYX_DIALOG_STATE__ = window.__FERRYX_DIALOG_STATE__ || {
    policy: 'auto-dismiss',
    pending: null,
    nextAction: null,
  });

  const recordDialog = (type, message, defaultValue) => {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: String(type),
      message: String(message),
      defaultValue: defaultValue !== undefined && defaultValue !== null ? String(defaultValue) : null,
      atMs: Date.now(),
      handled: true,
      action: 'dismiss',
      result: null,
    };

    const next = dialogState.nextAction;
    dialogState.nextAction = null;

    if (next && next.action) {
      entry.action = next.action;
      if (next.action === 'accept') {
        if (type === 'confirm') entry.result = 'true';
        else if (type === 'prompt') entry.result = next.promptText !== undefined && next.promptText !== null ? String(next.promptText) : (defaultValue ? String(defaultValue) : '');
        else entry.result = 'ok';
      } else {
        if (type === 'confirm') entry.result = 'false';
        else if (type === 'prompt') entry.result = null;
        else entry.result = 'dismissed';
      }
    } else if (dialogState.policy === 'auto-accept') {
      entry.action = 'accept';
      if (type === 'confirm') entry.result = 'true';
      else if (type === 'prompt') entry.result = defaultValue ? String(defaultValue) : '';
      else entry.result = 'ok';
    } else {
      // default: auto-dismiss policy
      entry.action = 'dismiss';
      if (type === 'confirm') entry.result = 'false';
      else if (type === 'prompt') entry.result = null;
      else entry.result = 'dismissed';
    }

    dialogState.pending = entry;
    dialogHistory.push(entry);
    if (dialogHistory.length > 100) dialogHistory.shift();

    pushConsoleEntry('info', '[dialog:' + type + '] ' + entry.message + ' -> ' + entry.action);

    if (type === 'confirm') return entry.result === 'true';
    if (type === 'prompt') return entry.result;
    return undefined;
  };

  window.alert = function (message) {
    try { recordDialog('alert', message); } catch (error) { reportBridgeFailure('alert interception failed', error); }
  };

  window.confirm = function (message) {
    try { return recordDialog('confirm', message); } catch (_) { return false; }
  };

  window.prompt = function (message, defaultValue) {
    try { return recordDialog('prompt', message, defaultValue); } catch (_) { return null; }
  };

  // This script runs at document start, before any page script, so these
  // references are still pristine. `route` below builds a URL containing the
  // bridge nonce and hands it to `assign`; resolving either function at call
  // time instead would let a page install its own `location.assign` or
  // `encodeURIComponent` and capture the nonce, which is exactly the credential
  // that stops it from forging control messages.
  const assign = location.assign.bind(location);
  const enc = encodeURIComponent;
  const closestOf = Element.prototype.closest;
  const addDocumentListener = document.addEventListener.bind(document);
  // Captured at document start, before page script runs.
  // In Chromium/Gecko, `isTrusted` is an accessor on Event.prototype.
  // In WebKit/WKWebView, `isTrusted` is an own [LegacyUnforgeable] property on each event
  // instance, so Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted') is undefined.
  // We take the prototype getter when present; otherwise we safely read the instance
  // property (which cannot be shadowed or reconfigured when [LegacyUnforgeable]).
  const isTrustedDesc = Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted');
  const isTrustedOf = isTrustedDesc && typeof isTrustedDesc.get === 'function' ? isTrustedDesc.get : null;
  // Only real user input may reach the bridge. Without this, ordinary page script
  // can `document.dispatchEvent(new KeyboardEvent('keydown', {key:'t', metaKey:true}))`
  // and drive privileged app chrome -- spawning terminal tabs, closing the active
  // surface and its running session, opening the palette -- with no user interaction,
  // including from a hidden background tab. The bridge nonce cannot help: the bridge
  // itself supplies the nonce on behalf of the forged event.
  const isUserEvent = (event) => {
    try {
      if (!event) return false;
      return isTrustedOf ? isTrustedOf.call(event) === true : event.isTrusted === true;
    } catch (_) {
      return false;
    }
  };

  const resolveHttpUrl = (raw) => {
    if (!raw) return null;
    try {
      const parsed = new URL(String(raw), location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch (_) {
      return null;
    }
  };

  const routeParams = (host, params) => {
    const pairs = Object.keys(params)
      .map((key) => `${enc(key)}=${enc(params[key])}`)
      .join('&');
    assign(`https://${host}/?${pairs}&nonce=${__FERRYX_BROWSER_BRIDGE_NONCE__}`);
  };
  const route = (host, key, value) => {
    routeParams(host, { [key]: value });
  };
  const routeHost = (host) => {
    assign(`https://${host}/?nonce=${__FERRYX_BROWSER_BRIDGE_NONCE__}`);
  };
  window.__ferryxRoute = route;

  // OAuth popups are host-created browser tabs, so a popup's callback has to travel
  // through the host: a same-origin broadcast channel only reaches the same storage partition,
  // so two webviews silently deliver nothing to each other. The popup-only surface is
  // substituted below and only for a tab the host created as a popup: a normal tab must
  // keep `window.opener` null, because real OAuth callback pages branch on it and a fake
  // opener makes them postMessage into a proxy nobody reads and call close() instead of
  // continuing the redirect flow.
__FERRYX_IS_POPUP_SURFACE__

  // Every tab, popup or not, gets real window.open handles: the opener drives the popup
  // through the handle and the host creates the actual tab. Each handle is registered
  // under a per-page id so the host can address it in both directions.
  const popupHandles = (window.__ferryxPopupHandles = window.__ferryxPopupHandles || {});
  let popupHandleCounter = 0;

  const originalOpen = window.open.bind(window);
  window.open = (url, name, ...rest) => {
    if (window.__FERRYX_POPUP_POLICY__ === 'block') {
      pushConsoleEntry('warn', '[popup:blocked] Popup blocked by policy: ' + url);
      return null;
    }

    const raw = url === undefined || url === null ? '' : String(url);
    const deferred = !raw.trim() || raw.trim() === 'about:blank';
    const initial = resolveHttpUrl(raw);
    if (!initial && !deferred) {
      pushConsoleEntry('warn', '[popup:rejected] Invalid popup URL scheme: ' + url);
      return null;
    }

    popupHandleCounter += 1;
    const handleId = `p${popupHandleCounter}`;
    let closed = false;
    let currentUrl = initial || 'about:blank';
    let routed = false;

    const navigate = (nextUrl) => {
      const resolved = resolveHttpUrl(nextUrl);
      if (!resolved) {
        pushConsoleEntry('warn', '[popup:rejected] Invalid popup URL scheme: ' + nextUrl);
        return;
      }
      currentUrl = resolved;
      // The first assignment is what creates the popup tab; later ones navigate the tab
      // the host already created for this handle.
      if (routed) {
        routeParams('popup.ferryx.invalid', { url: resolved, handle: handleId, op: 'navigate' });
      } else {
        routeParams('popup.ferryx.invalid', { url: resolved, handle: handleId, op: 'open' });
        routed = true;
      }
    };

    const handleLocation = {
      get href() {
        return currentUrl;
      },
      set href(nextUrl) {
        navigate(nextUrl);
      },
      assign: (nextUrl) => navigate(nextUrl),
      replace: (nextUrl) => navigate(nextUrl),
      reload: () => {},
      toString: () => currentUrl,
    };

    const popupHandle = {
      name: typeof name === 'string' ? name : '',
      opener: window,
      location: handleLocation,
      close: () => {
        // The host owns the tab, so ask it to close this linked popup by handleId.
        // `closed` flips when the host confirms through window.__ferryxPopupClosed, which
        // keeps it real state instead of an optimistic guess.
        routeParams('popupclose.ferryx.invalid', { handle: handleId });
      },
      focus: () => {},
      blur: () => {},
      postMessage: (message, targetOrigin) => {
        let payload;
        try {
          payload = JSON.stringify({ data: message, targetOrigin: targetOrigin || '*' });
        } catch (error) {
          pushConsoleEntry('warn', '[popup:handle-message] could not serialize the message: ' + error);
          return;
        }
        routeParams('popup.ferryx.invalid', { op: 'message', handle: handleId, msg: payload });
      },
    };

    Object.defineProperty(popupHandle, 'closed', {
      get: () => closed,
      set: (value) => { closed = Boolean(value); },
    });
    // The host calls this when the popup tab actually closes (by the user, by the page,
    // or by the host), which is the only way `closed` reflects reality.
    popupHandle.__ferryxMarkClosed = () => { closed = true; };
    popupHandles[handleId] = popupHandle;

    if (initial) {
      routeParams('popup.ferryx.invalid', { url: initial, handle: handleId, op: 'open' });
      routed = true;
    }
    return popupHandle;
  };

  window.__ferryxPopupClosed = (id) => {
    const handle = popupHandles[id];
    if (!handle) return false;
    if (typeof handle.__ferryxMarkClosed === 'function') handle.__ferryxMarkClosed();
    return true;
  };

  addDocumentListener('click', (event) => {
    if (!isUserEvent(event)) return;
    if (window.__ferryxPicker && window.__ferryxPicker.installed) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = closestOf.call(target, 'a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const url = resolveHttpUrl(anchor.href);
    if (!url) return;
    if (anchor.hasAttribute('download')) {
      event.preventDefault();
      route('download.ferryx.invalid', 'url', url);
      return;
    }
    const isMac = typeof navigator !== 'undefined' && (
      /Mac|iPhone|iPod|iPad/.test(navigator.platform || '') ||
      /Macintosh/.test(navigator.userAgent || '')
    );
    const modifier = isMac ? (event.metaKey && !event.ctrlKey) : (event.ctrlKey && !event.metaKey);
    const blank = (anchor.target || '').toLowerCase() === '_blank';
    event.preventDefault();
    route(modifier || blank ? 'modclick.ferryx.invalid' : 'click.ferryx.invalid', 'url', url);
  }, true);

  const isMac = typeof navigator !== 'undefined' && (
    /Mac|iPhone|iPod|iPad/.test(navigator.platform || '') ||
    /Macintosh/.test(navigator.userAgent || '')
  );

  // A cache-bypassing reload needs a native binding this build only has on macOS and Linux; the
  // host substitutes the platform flag as a literal, so Windows never offers the chord at all.
  const hardReloadSupported = __FERRYX_BROWSER_BRIDGE_HARD_RELOAD__;

  addDocumentListener('keydown', (event) => {
    if (!isUserEvent(event)) return;
    let action = null;
    const composing = event.isComposing || event.keyCode === 229;
    if (composing) return;

    const code = event.code || '';
    const key = event.key ? event.key.toLowerCase() : '';
    const primaryMod = isMac ? (event.metaKey && !event.ctrlKey) : (event.ctrlKey && !event.metaKey);

    // Global app commands (new tab, close tab, command palette, sidebar toggle,
    // settings, pane split, tab select, tab cycle, workspace select) work
    // everywhere in the child webview, even while typing in text inputs or
    // textareas, matching native desktop browser expectations.
    if (primaryMod && !event.altKey) {
      if (!event.shiftKey) {
        if (key === 't' || code === 'KeyT') action = 'tab-new-browser';
        else if (key === 'w' || code === 'KeyW') action = 'tab-close';
        else if (key === 'k' || code === 'KeyK') action = 'command-palette';
        else if (key === 'b' || code === 'KeyB') action = 'sidebar-toggle';
        else if (key === ',' || code === 'Comma') action = 'settings-toggle';
        else if (key === 'd' || code === 'KeyD') action = 'split-right';
        else if (key === '=' || code === 'Equal') action = 'zoom-in';
        else if (key === '-' || code === 'Minus') action = 'zoom-out';
        else if (key === '0' || code === 'Digit0') action = 'zoom-reset';
      } else {
        if (key === 't' || code === 'KeyT') action = 'tab-reopen-closed';
        else if (key === 'd' || code === 'KeyD') action = 'split-down';
        else if (key === '+' || code === 'Equal') action = 'zoom-in';
        else if (hardReloadSupported && (key === 'r' || code === 'KeyR')) action = 'reload-hard';
      }
    }

    // Workspace selection: Cmd+1..9 on macOS, Alt+1..9 on Windows/Linux
    if (!action && !event.shiftKey) {
      const isWsMod = isMac ? (event.metaKey && !event.ctrlKey && !event.altKey) : (event.altKey && !event.ctrlKey && !event.metaKey);
      if (isWsMod) {
        const digit = /^[1-9]$/.test(event.key) ? event.key : (code.match(/^Digit([1-9])$/) || [])[1];
        if (digit) action = 'workspace-select-' + digit;
      }
    }

    // Tab selection (Ctrl+1..9 on all platforms)
    if (!action && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const digit = /^[1-9]$/.test(event.key) ? event.key : (code.match(/^Digit([1-9])$/) || [])[1];
      if (digit) action = 'tab-select-' + digit;
    }

    // Tab cycling (Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageUp/Down, Cmd+Shift+[/])
    if (!action) {
      if (event.ctrlKey && !event.metaKey && !event.altKey && (key === 'tab' || code === 'Tab')) {
        action = event.shiftKey ? 'tab-previous' : 'tab-next';
      } else if (event.ctrlKey && !event.metaKey && !event.altKey && (key === 'pagedown' || code === 'PageDown')) {
        action = 'tab-next';
      } else if (event.ctrlKey && !event.metaKey && !event.altKey && (key === 'pageup' || code === 'PageUp')) {
        action = 'tab-previous';
      } else if (primaryMod && event.shiftKey && !event.altKey && (code === 'BracketRight' || key === ']' || key === '}')) {
        action = 'tab-next';
      } else if (primaryMod && event.shiftKey && !event.altKey && (code === 'BracketLeft' || key === '[' || key === '{')) {
        action = 'tab-previous';
      }
    }

    // Browser address bar, reload, and find work everywhere, even while typing
    // in text inputs or textareas, matching standard browser keyboard conventions.
    if (!action && primaryMod && !event.altKey && !event.shiftKey) {
      if (key === 'l' || code === 'KeyL') action = 'focus-address';
      else if (key === 'r' || code === 'KeyR') action = 'reload';
      else if (key === 'f' || code === 'KeyF') action = 'find';
    }

    // In-page navigation outside editable fields
    const keyTarget = event.target;
    const inEditable = keyTarget instanceof Element && (
      keyTarget.tagName === 'INPUT' || keyTarget.tagName === 'TEXTAREA' ||
      keyTarget.tagName === 'SELECT' || keyTarget.isContentEditable
    );

    if (!action && !inEditable) {
      if (primaryMod && key === '[') action = 'back';
      else if (primaryMod && key === ']') action = 'forward';
      else if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === 'ArrowLeft') action = 'back';
      else if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === 'ArrowRight') action = 'forward';
    }

    if (!action) return;
    event.preventDefault();
    route('shortcut.ferryx.invalid', 'action', action);
  }, true);

  addDocumentListener('drop', (event) => {
    if (!isUserEvent(event)) return;
    const uri = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || '';
    const target = resolveHttpUrl(uri.split(/\r?\n/).find((line) => line && !line.startsWith('#')) || uri);
    if (!target) return;
    event.preventDefault();
    assign(target);
  }, true);
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_NONCE: &str = "550e8400-e29b-41d4-a716-446655440000";

    #[test]
    fn bridge_script_captures_nonce_carrying_builtins_at_document_start() {
        let script = browser_guest_bridge_script(TEST_NONCE, false);

        assert!(script.contains("const assign = location.assign.bind(location);"));
        assert!(script.contains("const enc = encodeURIComponent;"));

        // The routed URL carries the nonce, so it must be built and dispatched
        // through the captured references: resolving them at call time lets a
        // page swap either one in and read the nonce out of the target URL.
        assert!(script.contains("&nonce="));
        assert!(
            !script.contains("encodeURIComponent(value)"),
            "route must encode through the captured reference"
        );
        assert!(
            !script.contains("location.assign(target)"),
            "route must navigate through the captured reference"
        );
    }

    #[test]
    fn parses_bridge_actions_and_ignores_normal_navigation() {
        let open = Url::parse(&format!(
            "https://open.ferryx.invalid/?url=https%3A%2F%2Fexample.com%2Foauth&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&open, TEST_NONCE),
            Some(BrowserGuestAction::Open("https://example.com/oauth".into()))
        );

        let download = Url::parse(&format!(
            "https://download.ferryx.invalid/?url=https%3A%2F%2Fexample.com%2Ffile.pdf&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&download, TEST_NONCE),
            Some(BrowserGuestAction::Download(
                "https://example.com/file.pdf".into()
            ))
        );

        let shortcut = Url::parse(&format!(
            "https://shortcut.ferryx.invalid/?action=find&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&shortcut, TEST_NONCE),
            Some(BrowserGuestAction::Shortcut("find".into()))
        );

        let click = Url::parse(&format!(
            "https://click.ferryx.invalid/?url=https%3A%2F%2Fexample.com%2Fdocs&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&click, TEST_NONCE),
            Some(BrowserGuestAction::LinkClick("https://example.com/docs".into()))
        );
        let modifier_click = Url::parse(&format!(
            "https://modclick.ferryx.invalid/?url=https%3A%2F%2Fexample.com%2Fdocs&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&modifier_click, TEST_NONCE),
            Some(BrowserGuestAction::ModifierLinkClick(
                "https://example.com/docs".into()
            ))
        );

        // App-level and tab navigation chords ride the same shortcut host so the main
        // webview (which never sees the keydown) can still switch tabs and run app commands.
        for action in [
            "tab-next",
            "tab-previous",
            "tab-select-1",
            "tab-select-9",
            "tab-new-terminal",
            "tab-new-browser",
            "tab-reopen-closed",
            "tab-close",
            "command-palette",
            "sidebar-toggle",
            "settings-toggle",
            "split-right",
            "split-down",
            "zoom-in",
            "zoom-out",
            "zoom-reset",
            "workspace-select-1",
            "workspace-select-9",
            "reload-hard",
        ] {
            let forwarded = Url::parse(&format!(
                "https://shortcut.ferryx.invalid/?action={action}&nonce={TEST_NONCE}"
            ))
            .unwrap();
            assert_eq!(
                parse_browser_guest_action(&forwarded, TEST_NONCE),
                Some(BrowserGuestAction::Shortcut(action.into()))
            );
        }

        // The hard-reload chord is emitted only where the platform can honour it, so the bridge
        // must carry the resolved platform flag instead of a leftover placeholder.
        let script = browser_guest_bridge_script(TEST_NONCE, false);
        assert!(script.contains("action = 'reload-hard'"));
        assert!(!script.contains(BRIDGE_HARD_RELOAD_PLACEHOLDER));
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        assert!(script.contains("const hardReloadSupported = true;"));
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        assert!(script.contains("const hardReloadSupported = false;"));

        assert_eq!(
            parse_browser_guest_action(&Url::parse("https://example.com/").unwrap(), TEST_NONCE),
            None
        );
    }

    #[test]
    fn guest_control_urls_require_matching_nonce() {
        // Correct nonce still parses.
        let open = Url::parse(&format!(
            "https://open.ferryx.invalid/?nonce={TEST_NONCE}&url=https%3A%2F%2Fexample.com"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&open, TEST_NONCE),
            Some(BrowserGuestAction::Open("https://example.com".into()))
        );

        // Wrong nonce is rejected on every control host.
        let forged_open = Url::parse(
            "https://open.ferryx.invalid/?url=https%3A%2F%2Fexample.com&nonce=attacker-guess",
        )
        .unwrap();
        assert_eq!(parse_browser_guest_action(&forged_open, TEST_NONCE), None);
        let forged_download = Url::parse(
            "https://download.ferryx.invalid/?url=https%3A%2F%2Fexample.com%2Ff.pdf&nonce=attacker-guess",
        )
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&forged_download, TEST_NONCE),
            None
        );
        let forged_shortcut =
            Url::parse("https://shortcut.ferryx.invalid/?action=find&nonce=attacker-guess")
                .unwrap();
        assert_eq!(
            parse_browser_guest_action(&forged_shortcut, TEST_NONCE),
            None
        );

        // Missing nonce (the legacy shape any page can produce) is rejected.
        let legacy_open =
            Url::parse("https://open.ferryx.invalid/?url=https%3A%2F%2Fexample.com").unwrap();
        assert_eq!(parse_browser_guest_action(&legacy_open, TEST_NONCE), None);
        let legacy_download =
            Url::parse("https://download.ferryx.invalid/?url=https%3A%2F%2Fexample.com%2Ff.pdf")
                .unwrap();
        assert_eq!(
            parse_browser_guest_action(&legacy_download, TEST_NONCE),
            None
        );
        let legacy_shortcut = Url::parse("https://shortcut.ferryx.invalid/?action=find").unwrap();
        assert_eq!(
            parse_browser_guest_action(&legacy_shortcut, TEST_NONCE),
            None
        );
    }

    #[test]
    fn guest_bridge_covers_popup_download_shortcuts_and_url_drop() {
        let script = browser_guest_bridge_script(TEST_NONCE, false);
        assert!(script.contains("window.open"));
        assert!(script.contains("download.ferryx.invalid"));
        assert!(script.contains("shortcut.ferryx.invalid"));
        assert!(script.contains("text/uri-list"));
        assert!(script.contains("tab-new-browser"));
        assert!(script.contains("tab-reopen-closed"));
        assert!(script.contains("zoom-in"));
        // The OAuth callback travels through the host now, not through BroadcastChannel,
        // which is same-origin and same-storage-partition only and therefore delivered
        // nothing between two webviews.
        assert!(!script.contains("__ferryx_oauth_bridge__"));
        assert!(!script.contains("BroadcastChannel"));
        // The nonce is embedded JSON-encoded and appended to every routed URL.
        let nonce_json = serde_json::to_string(TEST_NONCE).unwrap();
        assert!(script.contains(&format!("&nonce=${{{nonce_json}}}")));
        assert!(!script.contains(BRIDGE_NONCE_PLACEHOLDER));
    }

    #[test]
    fn test_console_drain_script_and_parser() {
        let drain_script_all = build_console_drain_script(false, false);
        assert!(drain_script_all.contains("__FERRYX_BROWSER_CONSOLE__"));

        let sample_json = r#"[{"level":"log","text":"hello world","atMs":12345678},{"level":"error","text":"failed","atMs":12345679}]"#;
        let entries = parse_console_drain_result(sample_json).expect("parse console entries");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].level, "log");
        assert_eq!(entries[0].text, "hello world");
        assert_eq!(entries[0].at_ms, 12345678);
        assert_eq!(entries[1].level, "error");

        let bridge = browser_guest_bridge_script(TEST_NONCE, false);
        assert!(bridge.contains("__FERRYX_BROWSER_CONSOLE__"));
        assert!(bridge.contains("500"));
    }

    #[test]
    fn test_dialog_scripts_and_parser() {
        let handle_script = build_dialog_handle_script("accept", Some("yes"));
        assert!(handle_script.contains("__FERRYX_DIALOG_STATE__"));
        assert!(handle_script.contains("\"accept\""));
        assert!(handle_script.contains("\"yes\""));

        let arm_script = build_dialog_arm_script("accept", Some("ok-prompt"));
        assert!(arm_script.contains("nextAction"));
        assert!(arm_script.contains("\"accept\""));

        let policy_script = build_dialog_policy_script("auto-accept");
        assert!(policy_script.contains("policy = \"auto-accept\""));

        let drain_script = build_dialog_drain_script();
        assert!(drain_script.contains("__FERRYX_BROWSER_DIALOGS__"));

        let sample_entry_json = r#"{"id":"d1","type":"confirm","message":"Leave?","defaultValue":null,"atMs":1234,"handled":true,"action":"accept","result":"true"}"#;
        let entry = parse_dialog_entry(sample_entry_json).expect("parse dialog entry");
        assert_eq!(entry.id, "d1");
        assert_eq!(entry.r#type, "confirm");
        assert_eq!(entry.message, "Leave?");
        assert_eq!(entry.action, "accept");

        let sample_list_json = format!("[{sample_entry_json}]");
        let list = parse_dialog_drain_result(&sample_list_json).expect("parse dialog drain");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "d1");

        let bridge = browser_guest_bridge_script(TEST_NONCE, false);
        assert!(bridge.contains("__FERRYX_BROWSER_DIALOGS__"));
        assert!(bridge.contains("window.alert = function"));
        assert!(bridge.contains("window.confirm = function"));
        assert!(bridge.contains("window.prompt = function"));
    }

    #[test]
    fn parses_popup_open_navigate_and_opener_message_actions() {
        // `window.open(url)` routes the popup creation with the page-local handle id.
        let open = Url::parse(&format!(
            "https://popup.ferryx.invalid/?url=https%3A%2F%2Fauth.example.com%2Fauthorize&handle=p1&op=open&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&open, TEST_NONCE),
            Some(BrowserGuestAction::PopupOpen {
                url: "https://auth.example.com/authorize".into(),
                handle: "p1".into(),
            })
        );

        // A missing `op` is the legacy shape of the same action and stays an open.
        let implicit_open = Url::parse(&format!(
            "https://popup.ferryx.invalid/?url=https%3A%2F%2Fauth.example.com%2Fauthorize&handle=p2&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&implicit_open, TEST_NONCE),
            Some(BrowserGuestAction::PopupOpen {
                url: "https://auth.example.com/authorize".into(),
                handle: "p2".into(),
            })
        );

        // A later `handle.location.href = ...` navigates the tab the host already made.
        let navigate = Url::parse(&format!(
            "https://popup.ferryx.invalid/?url=https%3A%2F%2Fapp.example.com%2Fcallback%3Fcode%3Dabc&handle=p1&op=navigate&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&navigate, TEST_NONCE),
            Some(BrowserGuestAction::PopupNavigate {
                url: "https://app.example.com/callback?code=abc".into(),
                handle: "p1".into(),
            })
        );

        // An unknown op is not guessed into an open.
        let unknown_op = Url::parse(&format!(
            "https://popup.ferryx.invalid/?url=https%3A%2F%2Fapp.example.com&handle=p1&op=replace&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(parse_browser_guest_action(&unknown_op, TEST_NONCE), None);

        // A popup action without a handle cannot be addressed back to the opener.
        let missing_handle = Url::parse(&format!(
            "https://popup.ferryx.invalid/?url=https%3A%2F%2Fapp.example.com&op=open&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(parse_browser_guest_action(&missing_handle, TEST_NONCE), None);

        // `window.opener.postMessage(data, targetOrigin)` from the popup.
        let message = Url::parse(&format!(
            "https://opener.ferryx.invalid/?msg=%7B%22data%22%3A%7B%22code%22%3A%22abc%22%7D%2C%22targetOrigin%22%3A%22*%22%7D&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&message, TEST_NONCE),
            Some(BrowserGuestAction::OpenerMessage {
                message: r#"{"data":{"code":"abc"},"targetOrigin":"*"}"#.into(),
            })
        );

        // `window.close()` from the popup.
        let close = Url::parse(&format!(
            "https://popupclose.ferryx.invalid/?nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&close, TEST_NONCE),
            Some(BrowserGuestAction::PopupCloseRequested)
        );

        // `handle.close()` from the opener carried via popupclose.ferryx.invalid with handle.
        let handle_close = Url::parse(&format!(
            "https://popupclose.ferryx.invalid/?handle=p1&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&handle_close, TEST_NONCE),
            Some(BrowserGuestAction::PopupCloseHandle { handle: "p1".into() })
        );

        // `handle.close()` carried via popup.ferryx.invalid with op=close.
        let op_close = Url::parse(&format!(
            "https://popup.ferryx.invalid/?op=close&handle=p2&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&op_close, TEST_NONCE),
            Some(BrowserGuestAction::PopupCloseHandle { handle: "p2".into() })
        );

        // `handle.postMessage(msg)` from opener to child popup.
        let opener_to_popup = Url::parse(&format!(
            "https://popup.ferryx.invalid/?op=message&handle=p1&msg=%7B%22data%22%3A%22token%22%7D&nonce={TEST_NONCE}"
        ))
        .unwrap();
        assert_eq!(
            parse_browser_guest_action(&opener_to_popup, TEST_NONCE),
            Some(BrowserGuestAction::PopupMessage {
                handle: "p1".into(),
                message: r#"{"data":"token"}"#.into(),
            })
        );
    }

    #[test]
    fn guest_control_urls_require_matching_nonce_for_popup_hosts() {
        // A popup action carrying a forged nonce is refused even though every other
        // parameter is well formed: the nonce is the only thing that stops a page which
        // never received the bridge from driving the opener's tab.
        let forged_open = Url::parse(
            "https://popup.ferryx.invalid/?url=https%3A%2F%2Fevil.example.com&handle=p1&op=open&nonce=attacker-guess",
        )
        .unwrap();
        assert_eq!(parse_browser_guest_action(&forged_open, TEST_NONCE), None);

        let forged_message = Url::parse(
            "https://opener.ferryx.invalid/?msg=%7B%22data%22%3A%22steal%22%7D&nonce=attacker-guess",
        )
        .unwrap();
        assert_eq!(parse_browser_guest_action(&forged_message, TEST_NONCE), None);

        let forged_close =
            Url::parse("https://popupclose.ferryx.invalid/?nonce=attacker-guess").unwrap();
        assert_eq!(parse_browser_guest_action(&forged_close, TEST_NONCE), None);

        let forged_handle_close =
            Url::parse("https://popupclose.ferryx.invalid/?handle=p1&nonce=attacker-guess").unwrap();
        assert_eq!(parse_browser_guest_action(&forged_handle_close, TEST_NONCE), None);

        let forged_popup_msg =
            Url::parse("https://popup.ferryx.invalid/?op=message&handle=p1&msg=%7B%7D&nonce=attacker-guess").unwrap();
        assert_eq!(parse_browser_guest_action(&forged_popup_msg, TEST_NONCE), None);

        // Missing nonce is the legacy shape any page can produce, so it is refused too.
        let legacy_open = Url::parse(
            "https://popup.ferryx.invalid/?url=https%3A%2F%2Fevil.example.com&handle=p1&op=open",
        )
        .unwrap();
        assert_eq!(parse_browser_guest_action(&legacy_open, TEST_NONCE), None);
        let legacy_close = Url::parse("https://popupclose.ferryx.invalid/").unwrap();
        assert_eq!(parse_browser_guest_action(&legacy_close, TEST_NONCE), None);
        let legacy_message = Url::parse("https://opener.ferryx.invalid/?msg=%7B%7D").unwrap();
        assert_eq!(parse_browser_guest_action(&legacy_message, TEST_NONCE), None);
    }

    #[test]
    fn guest_bridge_installs_the_opener_proxy_only_in_popup_tabs() {
        // A normal tab must keep `window.opener` null: real OAuth callback pages branch on
        // `if (window.opener)`, and a fake opener makes them postMessage into a proxy
        // nobody reads and call close() instead of continuing the redirect flow.
        let normal = browser_guest_bridge_script(TEST_NONCE, false);
        assert!(!normal.contains("__ferryxOpenerProxyInstalled"));
        assert!(!normal.contains("window.opener = openerProxy"));
        assert!(!normal.contains("opener.ferryx.invalid"));
        assert!(!normal.contains("openerProxy"));
        assert!(!normal.contains(POPUP_SURFACE_PLACEHOLDER));

        let popup = browser_guest_bridge_script(TEST_NONCE, true);
        assert!(popup.contains("window.opener = openerProxy"));
        assert!(popup.contains("opener.ferryx.invalid"));
        assert!(popup.contains("popupclose.ferryx.invalid"));
        assert!(popup.contains("window.__ferryxPopupClosed"));
        assert!(!popup.contains(POPUP_SURFACE_PLACEHOLDER));
    }

    #[test]
    fn guest_bridge_routes_popup_handles_and_real_closed_state() {
        let script = browser_guest_bridge_script(TEST_NONCE, false);
        // Handles live under a per-page registry the host can address by id.
        assert!(script.contains("window.__ferryxPopupHandles"));
        // `window.open('')` + `w.location.href = url` is the common OAuth pattern, so the
        // handle's location must route instead of only mutating a field.
        assert!(script.contains("const handleLocation = {"));
        assert!(script.contains("assign: (nextUrl) => navigate(nextUrl)"));
        assert!(script.contains("replace: (nextUrl) => navigate(nextUrl)"));
        assert!(script.contains("op: 'open'"));
        assert!(script.contains("op: 'navigate'"));
        assert!(script.contains("popup.ferryx.invalid"));
        // `closed` is host-confirmed state, not an optimistic guess flipped by close().
        assert!(script.contains("popupHandle.__ferryxMarkClosed"));
        assert!(script.contains("window.__ferryxPopupClosed = (id) => {"));
        // A handle's close() asks the host with handleId, which owns the tab and links.
        assert!(script.contains("routeParams('popupclose.ferryx.invalid', { handle: handleId })"));
        assert!(script.contains("op: 'message'"));
    }

    #[test]
    fn guest_bridge_never_swallows_a_failure_silently() {
        // An empty catch hides exactly the OAuth failure this lane exists to surface: the
        // callback routes into nothing and the page sees no error at all.
        for is_popup in [false, true] {
            let script = browser_guest_bridge_script(TEST_NONCE, is_popup);
            assert!(
                !script.contains("catch (_) {}"),
                "the bridge must report what failed instead of dropping it"
            );
            assert!(script.contains("reportBridgeFailure"));
        }
    }

    #[test]
    fn guest_bridge_is_trusted_handles_wkwebview_instance_unforgeable_property() {
        // RED mutation: revert to unguarded `Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted').get;`
        // or remove the `event.isTrusted === true` instance fallback.
        assert!(
            !BRIDGE_SCRIPT_TEMPLATE.contains("Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted').get;"),
            "bridge template must not unguardedly index .get on prototype descriptor because WKWebView lacks it"
        );
        assert!(
            BRIDGE_SCRIPT_TEMPLATE.contains("event.isTrusted === true"),
            "bridge template must fall back to reading instance isTrusted property"
        );

        for is_popup in [false, true] {
            let script = browser_guest_bridge_script(TEST_NONCE, is_popup);
            assert!(
                !script.contains("Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted').get;"),
                "instantiated script must not contain unguarded prototype getter"
            );
            assert!(
                script.contains("event.isTrusted === true"),
                "instantiated script must contain instance isTrusted fallback"
            );
        }
    }

    #[test]
    fn guest_bridge_console_entry_emits_only_at_ms_camel_case() {
        // RED mutation: re-add `at_ms:` to BRIDGE_SCRIPT_TEMPLATE or serialize both keys into the console ring.
        assert!(
            !BRIDGE_SCRIPT_TEMPLATE.contains("at_ms:"),
            "bridge template must never emit at_ms: alongside atMs, preventing serde duplicate field error"
        );

        let parsed = parse_console_drain_result(r#"[{"level":"log","text":"x","atMs":1}]"#)
            .expect("console drain parser must succeed with canonical atMs single key");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].level, "log");
        assert_eq!(parsed[0].text, "x");
        assert_eq!(parsed[0].at_ms, 1);
    }
}

pub fn build_console_drain_script(clear: bool, errors_only: bool) -> String {
    format!(
        r#"(() => {{
  const ring = window.__FERRYX_BROWSER_CONSOLE__ || [];
  let entries = ring;
  if ({errors_only}) {{
    entries = ring.filter(e => e.level === "error");
  }}
  if ({clear}) {{
    if ({errors_only}) {{
      window.__FERRYX_BROWSER_CONSOLE__ = ring.filter(e => e.level !== "error");
    }} else {{
      window.__FERRYX_BROWSER_CONSOLE__ = [];
    }}
  }}
  return JSON.stringify(entries);
}})()"#,
        errors_only = errors_only,
        clear = clear,
    )
}

pub fn build_dialog_handle_script(action: &str, prompt_text: Option<&str>) -> String {
    let action_json = serde_json::to_string(action).unwrap_or_else(|_| "\"dismiss\"".into());
    let prompt_json = serde_json::to_string(&prompt_text).unwrap_or_else(|_| "null".into());
    format!(
        r#"(() => {{
  const state = window.__FERRYX_DIALOG_STATE__;
  if (!state) return JSON.stringify({{ error: "no_active_dialog" }});
  const pending = state.pending;
  if (!pending) {{
    return JSON.stringify({{ error: "no_active_dialog" }});
  }}
  pending.action = {action_json};
  if ({action_json} === 'accept') {{
    if (pending.type === 'confirm') pending.result = 'true';
    else if (pending.type === 'prompt') pending.result = {prompt_json};
    else pending.result = 'ok';
  }} else {{
    if (pending.type === 'confirm') pending.result = 'false';
    else if (pending.type === 'prompt') pending.result = null;
    else pending.result = 'dismissed';
  }}
  state.pending = null;
  return JSON.stringify({{ ok: true, dialog: pending }});
}})()"#
    )
}

pub fn build_dialog_arm_script(action: &str, prompt_text: Option<&str>) -> String {
    let action_json = serde_json::to_string(action).unwrap_or_else(|_| "\"dismiss\"".into());
    let prompt_json = serde_json::to_string(&prompt_text).unwrap_or_else(|_| "null".into());
    format!(
        r#"(() => {{
  const state = (window.__FERRYX_DIALOG_STATE__ = window.__FERRYX_DIALOG_STATE__ || {{ policy: 'auto-dismiss', pending: null, nextAction: null }});
  state.nextAction = {{ action: {action_json}, promptText: {prompt_json} }};
  return JSON.stringify({{ ok: true }});
}})()"#
    )
}

pub fn build_dialog_policy_script(policy: &str) -> String {
    let policy_json = serde_json::to_string(policy).unwrap_or_else(|_| "\"auto-dismiss\"".into());
    format!(
        r#"(() => {{
  const state = (window.__FERRYX_DIALOG_STATE__ = window.__FERRYX_DIALOG_STATE__ || {{ policy: 'auto-dismiss', pending: null, nextAction: null }});
  state.policy = {policy_json};
  return JSON.stringify({{ ok: true, policy: state.policy }});
}})()"#
    )
}

pub fn build_dialog_drain_script() -> String {
    r#"(() => {
  const dialogs = window.__FERRYX_BROWSER_DIALOGS__ || [];
  return JSON.stringify(dialogs);
})()"#
        .into()
}

pub fn parse_dialog_entry(raw_json: &str) -> Result<crate::browser::model::BrowserDialogEntry, String> {
    if let Ok(entry) = serde_json::from_str::<crate::browser::model::BrowserDialogEntry>(raw_json) {
        return Ok(entry);
    }
    if let Ok(unquoted) = serde_json::from_str::<String>(raw_json) {
        if let Ok(entry) = serde_json::from_str::<crate::browser::model::BrowserDialogEntry>(&unquoted) {
            return Ok(entry);
        }
    }
    Err("failed to parse browser dialog entry".to_string())
}

pub fn parse_dialog_drain_result(
    raw_json: &str,
) -> Result<Vec<crate::browser::model::BrowserDialogEntry>, String> {
    if let Ok(entries) =
        serde_json::from_str::<Vec<crate::browser::model::BrowserDialogEntry>>(raw_json)
    {
        return Ok(entries);
    }
    if let Ok(unquoted) = serde_json::from_str::<String>(raw_json) {
        if let Ok(entries) =
            serde_json::from_str::<Vec<crate::browser::model::BrowserDialogEntry>>(&unquoted)
        {
            return Ok(entries);
        }
    }
    Err("failed to parse browser dialog entries".to_string())
}

pub fn parse_console_drain_result(
    raw_json: &str,
) -> Result<Vec<crate::browser::model::BrowserConsoleEntry>, String> {
    if let Ok(entries) =
        serde_json::from_str::<Vec<crate::browser::model::BrowserConsoleEntry>>(raw_json)
    {
        return Ok(entries);
    }
    if let Ok(unquoted) = serde_json::from_str::<String>(raw_json) {
        if let Ok(entries) =
            serde_json::from_str::<Vec<crate::browser::model::BrowserConsoleEntry>>(&unquoted)
        {
            return Ok(entries);
        }
    }
    Err("failed to parse console drain entries".to_string())
}

pub fn browser_guest_geometry_observation_script() -> &'static str {
    r#"
    (() => {
      try {
        return JSON.stringify({
          innerWidth: window.innerWidth || 0,
          innerHeight: window.innerHeight || 0,
          scrollX: window.scrollX || 0,
          scrollY: window.scrollY || 0,
          devicePixelRatio: window.devicePixelRatio || 1.0,
        });
      } catch (e) {
        return null;
      }
    })()
    "#
}
