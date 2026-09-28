import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { isMacShortcutPlatform } from "./shortcuts";
import { setNativeTerminalDomOverlayInput } from "./tauri";

const NativeTerminalVisibilityContext = createContext({ visible: true, occluded: false });
// Match modal dialogs and search overlays that own input. Non-modal notifications
// like toasts do NOT own input and must never block terminal interactivity.
const YIELDING_SURFACE_SELECTOR = '[role="dialog"], [role="search"]';
const OPT_OUT_SELECTOR = '[data-native-terminal-yield="off"]';

function isYieldingSurfaceVisible(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  // A surface only forces the terminal to yield when it (and its ancestors) has
  // not opted out. Consulting the closest opt-out for every matching surface
  // means an opted-out popover cannot suppress a second, real modal.
  const surfaces = document.querySelectorAll(YIELDING_SURFACE_SELECTOR);
  for (const surface of surfaces) {
    if (surface.closest(OPT_OUT_SELECTOR) === null) {
      return true;
    }
  }
  return false;
}

/**
 * Mirrors overlay input ownership into the desktop host.
 *
 * macOS keeps native terminal surfaces attached underneath DOM overlays, so the
 * host's AppKit wheel monitor still finds a surface under the pointer and would
 * claim the wheel event for the terminal behind the overlay. Reporting the
 * overlay tells the host to hand those events back to WebKit instead.
 */
function reportDomOverlayInputOwner(active: boolean): void {
  void setNativeTerminalDomOverlayInput(active).catch((error: unknown) => {
    console.warn("Failed to report DOM overlay input ownership to the native terminal host:", error);
  });
}

export function NativeTerminalVisibilityProvider({
  visible,
  occluded = false,
  children,
}: PropsWithChildren<{ visible: boolean; occluded?: boolean }>): ReactElement {
  return (
    <NativeTerminalVisibilityContext.Provider value={{ visible, occluded }}>
      {children}
    </NativeTerminalVisibilityContext.Provider>
  );
}

/**
 * macOS surfaces are below WebKit, so overlays block input without hiding the
 * terminal. Other platforms still yield their native surfaces to DOM overlays.
 * Explicit owner hiding applies on every platform.
 */
export function useNativeTerminalVisibilityState(): { readonly visible: boolean; readonly interactive: boolean } {
  const owner = useContext(NativeTerminalVisibilityContext);
  const [surfaceOpen, setSurfaceOpen] = useState(isYieldingSurfaceVisible);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }

    const update = () => {
      const next = isYieldingSurfaceVisible();
      reportDomOverlayInputOwner(next);
      setSurfaceOpen((current) => (current === next ? current : next));
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const occluded = owner.occluded || surfaceOpen;
  return {
    visible: owner.visible && (isMacShortcutPlatform() || !occluded),
    interactive: owner.visible && !occluded,
  };
}

export function useNativeTerminalVisibility(): boolean {
  return useNativeTerminalVisibilityState().interactive;
}
