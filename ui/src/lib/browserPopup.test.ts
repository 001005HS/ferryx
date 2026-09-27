import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  browserTabIdForBrowserId,
  createPopupBrowser,
  onBrowserPopupCloseRequested,
  popupOpenerLink,
  type BrowserOpenRequestedPayload,
  type BrowserPopupOpenRequestedPayload,
} from "./browserTauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const eventMocks = vi.hoisted(() => {
  const captured: {
    event: string | null;
    handler: ((event: { payload: unknown }) => void) | null;
  } = { event: null, handler: null };
  return {
    captured,
    listen: vi.fn(async (event: string, handler: (payload: { payload: unknown }) => void) => {
      captured.event = event;
      captured.handler = handler;
      return () => undefined;
    }),
  };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: eventMocks.listen }));

const openPayload: BrowserOpenRequestedPayload = {
  browserId: "opener-1",
  targetUrl: "https://auth.example.com/authorize",
  profileId: "default",
};

const popupOpenPayload: BrowserPopupOpenRequestedPayload = {
  ...openPayload,
  openerBrowserId: "opener-1",
  popupHandle: "p1",
};

const openerOnlyPayload: BrowserPopupOpenRequestedPayload = {
  ...openPayload,
  openerBrowserId: "opener-1",
};

const handleOnlyPayload: BrowserPopupOpenRequestedPayload = {
  ...openPayload,
  popupHandle: "p1",
};

describe("popup opener link", () => {
  it("maps a popup-open payload to the opener link the create request needs", () => {
    // RED when the mapping drops either field (a popup tab would then be created as a
    // normal tab, whose window.opener must stay null) or invents a link without them.
    expect(popupOpenerLink(popupOpenPayload)).toEqual({
      browserId: "opener-1",
      handle: "p1",
    });
    expect(popupOpenerLink(openPayload)).toBeUndefined();
    expect(popupOpenerLink(openerOnlyPayload)).toBeUndefined();
    expect(popupOpenerLink(handleOnlyPayload)).toBeUndefined();
  });
});

describe("popup create request", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({ browserId: "popup-1" });
  });

  it("sends the opener link on the create command so the host can route the callback", async () => {
    // RED when the invoke payload stops carrying `opener`: the created tab is never
    // linked, so the OAuth callback has nowhere to go.
    await createPopupBrowser({ url: "https://auth.example.com/authorize" }, { browserId: "opener-1", handle: "p1" });

    expect(invoke).toHaveBeenCalledWith("cmd_browser_create", {
      request: expect.objectContaining({ url: "https://auth.example.com/authorize" }),
      opener: { browserId: "opener-1", handle: "p1" },
    });
  });

  it("resolves the profile and zoom the same way a normal create does", async () => {
    // RED when the popup create stops resolving the profile, which would send an
    // unsupported profile id and fail creation.
    await createPopupBrowser({ url: "https://auth.example.com/authorize" }, { browserId: "opener-1", handle: "p1" });

    const [, args] = vi.mocked(invoke).mock.calls[0] as [string, { request: { profile?: string; zoomFactor?: number } }];
    expect(typeof args.request.profile).toBe("string");
    expect(typeof args.request.zoomFactor).toBe("number");
  });
});

describe("close request routing", () => {
  it("finds the browser tab showing a browser id and ignores other tab kinds", () => {
    // RED when the lookup compares the tab id instead of the browser id, which would
    // close whichever tab happens to share the popup's id space.
    const tabs = [
      { id: "popup-1", kind: "terminal" },
      { id: "tab-browser", kind: "browser", browserId: "popup-1" },
    ];

    expect(browserTabIdForBrowserId(tabs, "popup-1")).toBe("tab-browser");
    expect(browserTabIdForBrowserId(tabs, "missing")).toBeNull();
  });

  it("subscribes the popup close request to the host event", async () => {
    // RED when the listener is registered on a different event name, so a popup's
    // window.close() never closes its tab.
    const listener = vi.fn();
    await onBrowserPopupCloseRequested(listener);

    expect(eventMocks.captured.event).toBe("browser_close_requested");
    eventMocks.captured.handler?.({ payload: { browserId: "popup-1" } });
    expect(listener).toHaveBeenCalledWith({ browserId: "popup-1" });
  });
});
