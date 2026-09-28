import { beforeEach, describe, expect, it, vi } from "vitest";

import { showNotificationPermissionHint } from "./notificationPermissionHint";
import { NOTIFICATION_PERMISSION_HINT_STORAGE_KEY } from "./storageKeys";

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

const { toast } = await import("sonner");
const toastMock = vi.mocked(toast);

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: store.size,
  };
}

describe("showNotificationPermissionHint", () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it("shows hint toast once and persists shown to storage", () => {
    const storage = createMockStorage();
    const openSettings = vi.fn();

    const shown = showNotificationPermissionHint(openSettings, storage);

    expect(shown).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("Desktop notifications are off", {
      description: "Turn them on to hear when agents finish or need your input.",
      action: {
        label: "Open settings",
        onClick: openSettings,
      },
    });
    expect(storage.getItem(NOTIFICATION_PERMISSION_HINT_STORAGE_KEY)).toBe("shown");
  });

  it("returns false and does not show toast when hint has already been shown", () => {
    const storage = createMockStorage();
    storage.setItem(NOTIFICATION_PERMISSION_HINT_STORAGE_KEY, "shown");
    const openSettings = vi.fn();

    const shown = showNotificationPermissionHint(openSettings, storage);

    expect(shown).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("returns false on subsequent call with the same storage", () => {
    const storage = createMockStorage();
    const openSettings = vi.fn();

    expect(showNotificationPermissionHint(openSettings, storage)).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);

    expect(showNotificationPermissionHint(openSettings, storage)).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("executes openSettings callback when toast action is clicked", () => {
    const storage = createMockStorage();
    const openSettings = vi.fn();

    showNotificationPermissionHint(openSettings, storage);

    const callArgs = toastMock.mock.calls[0];
    const action = (callArgs?.[1] as { action?: { onClick?: () => void } })?.action;
    expect(action).toBeDefined();
    action?.onClick?.();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("is null-safe and displays toast when storage is null", () => {
    const openSettings = vi.fn();

    const shown = showNotificationPermissionHint(openSettings, null);

    expect(shown).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("Desktop notifications are off", {
      description: "Turn them on to hear when agents finish or need your input.",
      action: {
        label: "Open settings",
        onClick: openSettings,
      },
    });
  });

  it("handles storage exceptions gracefully", () => {
    const throwingStorage: Storage = {
      getItem: () => {
        throw new Error("storage read restricted");
      },
      setItem: () => {
        throw new Error("storage quota exceeded");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    const openSettings = vi.fn();

    expect(() => showNotificationPermissionHint(openSettings, throwingStorage)).not.toThrow();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("uses window.localStorage by default when storage argument is omitted", () => {
    const mockStorage = createMockStorage();
    vi.stubGlobal("localStorage", mockStorage);
    const openSettings = vi.fn();

    const first = showNotificationPermissionHint(openSettings);
    expect(first).toBe(true);
    expect(mockStorage.getItem(NOTIFICATION_PERMISSION_HINT_STORAGE_KEY)).toBe("shown");

    const second = showNotificationPermissionHint(openSettings);
    expect(second).toBe(false);

    vi.unstubAllGlobals();
  });
});
