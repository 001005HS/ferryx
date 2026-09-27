# OS Webview Limits and Parity Boundaries

## Standing Architecture Decision

Ferryx keeps the host operating system webview runtime, using WKWebView on macOS, WebView2 on Windows, and WebKitGTK on Linux. We do not bundle Chromium, CEF, or Electron, and we do not attach to an external Google Chrome profile via debugging protocols. This matches the architecture documented by cmux. Choosing system-provided webviews keeps the desktop binary small, eliminates Chromium update overhead, and respects platform sandbox constraints. It also establishes hard boundaries where certain browser capabilities are impossible, host-enableable, or platform-divergent.

## Capability Buckets

Capabilities fall into three distinct architectural buckets:
1. **Impossible on OS Webview (Bucket A)**: Inherent engine limits across WKWebView, WebView2, and WebKitGTK. These cannot be resolved without embedding Chromium or attaching to an external browser process.
2. **Host-Enableable (Bucket B)**: Capabilities exposed by underlying engine delegate protocols, configuration builders, or host scripting, but currently unmapped or incomplete in Ferryx backend code.
3. **OS-Divergent (Bucket C)**: Features where behavior or support splits across macOS, Windows, and Linux due to platform-specific webview implementations.

### Table of Capabilities and Parity Status

| Capability | Bucket | Reason / Architectural Detail | Evidence Citation |
|---|---|---|---|
| User extension inheritance | Impossible (A) | OS webviews do not load extensions installed in user Safari or Chrome. WKWebView limits extensions to app-bundled packages from macOS 15.4. WebView2 turns extensions off and blocks `edge://extensions`. | `wave1/fx-engine-limits.md` (citing `wkwebview-limits.md`, `webview2-gap.md`) |
| Daily Chrome/Safari profile and cookie attachment | Impossible (A) | The embedded webview is a standalone container. It cannot attach to an active browser profile or read external browser credential stores. | `wave1/fx-engine-limits.md` (citing `cdp-attach.md`, `browser-tool-vs-webview.md`) |
| Google OAuth in embedded webviews | Impossible (A) | Google explicitly blocks OAuth authorization flows inside embedded webviews, including WebView2 and WKWebView, returning authentication errors. | `wave1/fx-engine-limits.md` (citing `webview2-gap.md`) |
| Shared multi-webview process pool isolation | Impossible (A) | `WKProcessPool` instances are deprecated since macOS 12 and have no effect. System process limits are implementation-defined. | `wave1/fx-engine-limits.md` (citing `wkwebview-limits.md`) |
| Web Push Notifications and Periodic Background Sync | Impossible (A) | W3C Push API and Periodic Background Sync are disabled in embedded runtimes such as WebView2 and WebKitGTK without full browser shells. | `wave1/fx-engine-limits.md` (citing `webview2-gap.md`) |
| Internal browser settings pages (`edge://*`, `chrome://*`) | Impossible (A) | Management, flag, and extension configuration pages like `edge://settings` or `chrome-search://local-ntp` are unavailable in embedded runtimes. | `wave1/fx-engine-limits.md` (citing `webview2-gap.md`) |
| Cross-engine cookie migration without custom parsers | Impossible (A) | System webviews store cookies in platform-specific SQLite or binary formats without standardized cross-engine migration APIs. | `wave1/fx-engine-limits.md` (citing `engine-switch-cost.md`) |
| Native Wayland pointer lock without compositor protocols | Impossible (A) | `PointerLockManagerWayland::lock()` returns false in WebKitGTK unless the host compositor exports `zwp_pointer_constraints_v1` and `zwp_relative_pointer_manager_v1`. | `wave1/fx-engine-limits.md` (citing `webkitgtk-limits.md`) |
| In-webview PDF annotation and drawing tools | Impossible (A) | Native PDF drawing, highlighting, and erasing features are turned off inside WebView2 and not provided by system WebKit engines. | `wave1/fx-engine-limits.md` (citing `webview2-gap.md`) |
| Geolocation override (`browser.geolocation.set`) | Impossible (A) | System webviews manage geolocation through OS permissions rather than synthetic script overrides. Documented by cmux as not supported. | `wave1/cmux-verbs.md` (citing `cmux-browser.md`); `wave2/cmux-ferryx-matrix.md` (#99, #100) |
| Offline mode toggle (`browser.offline.set`) | Impossible (A) | OS webview runtimes lack an offline network emulation switch without custom protocol proxying. Documented by cmux as not supported. | `wave1/cmux-verbs.md` (citing `cmux-browser.md`); `wave2/cmux-ferryx-matrix.md` (#101) |
| Execution tracing (`browser.trace.start\|stop`) | Impossible (A) | Chrome DevTools Protocol tracing pipelines do not exist across WKWebView and WebKitGTK. Documented by cmux as not supported. | `wave1/cmux-verbs.md` (citing `cmux-browser.md`); `wave2/cmux-ferryx-matrix.md` (#102) |
| Network interception and routing (`browser.network.route`) | Impossible (A) | In-flight network request rewriting and interception lack cross-platform OS webview APIs. Documented by cmux as not supported. | `wave1/cmux-verbs.md` (citing `cmux-browser.md`); `wave2/cmux-ferryx-matrix.md` (#103) |
| Raw hardware input injection (`browser.input_mouse`, `input_keyboard`) | Impossible (A) | OS webviews do not provide low-level hardware input synthesizers for arbitrary coordinates or gestures. Documented by cmux as not supported. | `wave1/cmux-verbs.md` (citing `cmux-browser.md`); `wave2/cmux-ferryx-matrix.md` (#105) |
| Synthetic viewport resizing (`viewport <w> <h>`) | Impossible (A) | OS webviews render to the physical layout pane dimensions. They lack a viewport emulation switch independent of window size. | `wave1/cmux-verbs.md` (citing `cmux-browser.md`); `wave2/cmux-ferryx-matrix.md` (#97, #98) |
| Popup window delegate (`window.open` lifecycle) | Host-Enableable (B) | Engines require `createWebViewWithConfiguration` (WKWebView) or `WebKitWebView::create` (WebKitGTK). Ferryx currently intercepts only bridge scripts. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:1004` |
| Native download delegate and destination control | Host-Enableable (B) | Engines require `WKDownloadDelegate` or navigation action policies. Ferryx currently uses simulated bridge events or unauthenticated GET requests. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:1016`, `src-tauri/src/browser/download.rs` |
| Media and hardware permission delegate | Host-Enableable (B) | Camera, microphone, and geolocation permission requests require host UI delegates. Ferryx does not currently wire a permission decision handler. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:980-1090` |
| Release build developer tools toggle | Host-Enableable (B) | Host engines allow developer tools toggling, but production release gating and macOS App Store private API checks are not wired. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:1001`, `:1272-1289` |
| PDF inline document viewing fallback | Host-Enableable (B) | OS webviews render PDFs, but host-side inline controllers and custom MIME routing must be configured by Ferryx. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:980` |
| Media capture and WebRTC routing policy | Host-Enableable (B) | WebRTC capture state properties and display media streams need host consent and audio routing integration in Ferryx. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:980-1090` |
| WebAuthn and passkey assertion dialogs | Host-Enableable (B) | Passkey requests emit engine-level callbacks that require host application UI mediation to complete assertions. | `wave1/fx-engine-limits.md` |
| Native print dialog delegate | Host-Enableable (B) | Printing is supported by OS webview APIs through host delegates, but Ferryx exposes no print IPC command or handler. | `wave1/fx-engine-limits.md` |
| Named persistent browser data profiles | OS-Divergent (C) | Supported on Windows and Linux via custom data directories. Rejected on macOS WebKit with an unsupported profile error. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:936-963` |
| Native webview pixel capture and screenshots | OS-Divergent (C) | Implemented natively on macOS via `take_browser_screenshot_with_source`. Non-macOS builds return an unsupported IPC error. | `wave1/fx-engine-limits.md`; `src-tauri/src/browser/screenshot.rs:69-87` |
| Linux GTK overlay layout and integer rounding | OS-Divergent (C) | WebKitGTK requires a custom GTK `Overlay` plus `Fixed` container with integer pixel rounding. macOS and Windows use child webview bounds. | `wave1/fx-engine-limits.md`; `src-tauri/src/browser/linux.rs:160-164`, `src-tauri/src/ipc/browser.rs:1160-1175` |
| Navigation history back and forward execution | OS-Divergent (C) | macOS triggers native `WKWebView` history navigation methods. Windows and Linux evaluate synthetic JavaScript `history.back()` scripts. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:1425-1473` |
| Cache-bypassing ("hard") reload | OS-Divergent (C) | macOS calls native `WKWebView.reloadFromOrigin` (end-to-end revalidation) and Linux calls WebKitGTK `WebViewExt::reload_bypass_cache`. Windows has no WebView2 binding in this build, so `ignore_cache: true` returns a structured `UNSUPPORTED` rather than silently serving cached content; the plain reload is unchanged everywhere. | `src-tauri/src/browser/hard_reload.rs` (`hard_reload_support`, `hard_reload`); `src-tauri/src/ipc/browser.rs` (`cmd_browser_reload`) |
| Native keystroke event dispatch | OS-Divergent (C) | macOS posts native AppKit `NSEvent` key events. Windows and Linux fall back to DOM synthetic `KeyboardEvent` script injection. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:170-220` |
| Windows WebView2 private profile runtime version | OS-Divergent (C) | WebView2 requires runtime version 101.0.1210.39 or higher for in-memory private profiles, warning on older runtimes. macOS and Linux do not check this. | `wave1/fx-engine-limits.md`; `src-tauri/src/ipc/browser.rs:970-985` |

## Out of Scope Capabilities

The following capabilities remain intentionally out of scope for Ferryx. Readers should distinguish features that are deferred from those that cannot be built under this architecture.

1. **Synthetic Viewport Overrides (`viewport <w> <h>`)**: Out of scope because OS webviews do not provide a detached headless layout viewport separate from the physical native window view.
2. **Geolocation Spoofing (`geolocation <lat> <long>`)**: Out of scope because OS webviews delegate location requests to system location services. Emulated coordinates are not exposed via delegate APIs.
3. **Offline Network Emulation (`offline <enable|disable>`)**: Out of scope because toggling offline network states requires custom local proxy servers or raw packet interception not provided by system webviews.
4. **Chrome DevTools Protocol Tracing (`trace <start|stop>`)**: Out of scope because WKWebView and WebKitGTK do not implement CDP performance tracing channels.
5. **Arbitrary Network Request Interception (`network.route`)**: Out of scope because fine-grained request/response mutation across all protocols lacks uniform cross-platform OS webview support.
6. **Low-Level Hardware Input Emulation (`input_mouse`, `input_keyboard`)**: Out of scope because OS webviews prevent low-level hardware pointer and keyboard synthesis from untrusted guest scripts. Ferryx provides focused point-clicking for main frames in remote sessions instead.
7. **Built-in Video Screen Recording**: Out of scope because native webview video encoding is not a webview engine responsibility. Ferryx supports JPEG snapshot streams for remote pairing.
8. **Browser Proxy Protocol Configuration**: Out of scope at the webview level. Network proxies must be managed at the host system network layer.

## Research Discrepancies

During synthesis between wave 1 research notes and the wave 2 parity matrix, two minor discrepancies were identified:
- **`screencast` status**: The wave 1 cmux command inventory (`cmux-verbs.md`) marks `screencast.start|stop` as engine-limited under WKWebView. However, the wave 2 parity matrix (`cmux-ferryx-matrix.md` #104) marks `screencast` as implemented in Ferryx because Ferryx authors its own JPEG screen streaming pipeline via `src-tauri/src/browser/remote_service.rs:270`. This document classifies low-level raw media streaming as an engine limit for generic webviews, while recording Ferryx's remote JPEG bridge as a custom host feature.
- **`input` subcommands**: The wave 1 inventory marks raw input injection as engine-limited. The wave 2 matrix splits `input` into general raw input (engine limit #105) and Ferryx remote frame input (#106, #107), where Ferryx provides point clicking on main frames. This document confirms raw hardware injection is impossible under Bucket A, while remote main-frame clicking is a host-provided workaround.

## Document Verification and Drift Warning

- **Last Verified Date:** 2026-09-26
- **Source Files:**
  - `.omo/ulw-research/20260926-inapp-browser-parity/wave1/fx-engine-limits.md`
  - `.omo/ulw-research/20260926-inapp-browser-parity/wave1/cmux-verbs.md`
  - `.omo/ulw-research/20260926-inapp-browser-parity/wave2/cmux-ferryx-matrix.md`
  - `.omo/plans/inapp-browser-cmux-orca-parity.md`
- **Notice on Code References:** Line numbers in `src-tauri/src/ipc/browser.rs`, `src-tauri/src/browser/screenshot.rs`, and related files drift over time. Verify symbols, function names, and module paths (`take_browser_screenshot_with_source`, `WEBVIEW2_PRIVATE_PROFILE_MINIMUM`, `createWebViewWithConfiguration`) when auditing code locations.
