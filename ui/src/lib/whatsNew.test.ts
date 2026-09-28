import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WHATS_NEW_PENDING_STORAGE_KEY, WHATS_NEW_SEEN_VERSION_STORAGE_KEY } from "./storageKeys";
import type { UpdateStatus } from "./updater";
import {
  markWhatsNewSeen,
  recordPendingReleaseNotes,
  resolveWhatsNew,
  startWhatsNewRecorder,
} from "./whatsNew";

const mockSubscribeUpdateStatus = vi.hoisted(() => vi.fn());

vi.mock("./updater", () => ({
  subscribeUpdateStatus: mockSubscribeUpdateStatus,
}));

function createStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

const NOTES = "## Faster sessions\n\n- Tabs restore instantly";

describe("recordPendingReleaseNotes", () => {
  it("stores the entry as JSON under the pending key", () => {
    const storage = createStorage();

    recordPendingReleaseNotes("2026.9.28.1", NOTES, storage);

    expect(storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY)).toBe(
      JSON.stringify({ version: "2026.9.28.1", notes: NOTES }),
    );
  });

  it("ignores empty and whitespace-only notes", () => {
    const storage = createStorage();

    recordPendingReleaseNotes("2026.9.28.1", "", storage);
    recordPendingReleaseNotes("2026.9.28.1", "   \n\t  ", storage);

    expect(storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY)).toBeNull();
  });

  it("does nothing without a storage", () => {
    expect(() => recordPendingReleaseNotes("2026.9.28.1", NOTES, null)).not.toThrow();
  });
});

describe("resolveWhatsNew", () => {
  it("returns null when currentVersion is null", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: JSON.stringify({ version: "2026.9.28.1", notes: NOTES }),
    });

    expect(resolveWhatsNew(null, storage)).toBeNull();
  });

  it("returns the pending entry when versions match and the version is unseen", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: JSON.stringify({ version: "2026.9.28.1", notes: NOTES }),
    });

    expect(resolveWhatsNew("2026.9.28.1", storage)).toEqual({
      version: "2026.9.28.1",
      notes: NOTES,
    });
  });

  it("returns null when no pending entry exists", () => {
    const storage = createStorage();

    expect(resolveWhatsNew("2026.9.28.1", storage)).toBeNull();
  });

  it("returns null when the pending version differs from the current version", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: JSON.stringify({ version: "2026.9.27.1", notes: NOTES }),
    });

    expect(resolveWhatsNew("2026.9.28.1", storage)).toBeNull();
  });

  it("returns null when the current version was already seen", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: JSON.stringify({ version: "2026.9.28.1", notes: NOTES }),
      [WHATS_NEW_SEEN_VERSION_STORAGE_KEY]: "2026.9.28.1",
    });

    expect(resolveWhatsNew("2026.9.28.1", storage)).toBeNull();
  });

  it("still returns the entry when the seen version is an older one", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: JSON.stringify({ version: "2026.9.28.1", notes: NOTES }),
      [WHATS_NEW_SEEN_VERSION_STORAGE_KEY]: "2026.9.27.1",
    });

    expect(resolveWhatsNew("2026.9.28.1", storage)).toEqual({
      version: "2026.9.28.1",
      notes: NOTES,
    });
  });

  it("returns null for malformed pending JSON", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: "{not json",
    });

    expect(resolveWhatsNew("2026.9.28.1", storage)).toBeNull();
  });

  it("returns null when the pending entry has the wrong shape", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: JSON.stringify({ version: "2026.9.28.1", notes: 42 }),
    });

    expect(resolveWhatsNew("2026.9.28.1", storage)).toBeNull();
  });
});

describe("markWhatsNewSeen", () => {
  it("stores the seen version and removes the pending entry", () => {
    const storage = createStorage({
      [WHATS_NEW_PENDING_STORAGE_KEY]: JSON.stringify({ version: "2026.9.28.1", notes: NOTES }),
    });

    markWhatsNewSeen("2026.9.28.1", storage);

    expect(storage.getItem(WHATS_NEW_SEEN_VERSION_STORAGE_KEY)).toBe("2026.9.28.1");
    expect(storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY)).toBeNull();
  });

  it("does nothing without a storage", () => {
    expect(() => markWhatsNewSeen("2026.9.28.1", null)).not.toThrow();
  });
});

describe("startWhatsNewRecorder", () => {
  beforeEach(() => {
    mockSubscribeUpdateStatus.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records release notes when the update reaches downloaded", () => {
    const storage = createStorage();
    const unsubscribe = vi.fn();
    mockSubscribeUpdateStatus.mockReturnValue(unsubscribe);

    const stop = startWhatsNewRecorder(storage);

    expect(mockSubscribeUpdateStatus).toHaveBeenCalledTimes(1);
    const listener = mockSubscribeUpdateStatus.mock.calls[0][0] as (status: UpdateStatus) => void;

    listener({ state: "checking" });
    expect(storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY)).toBeNull();

    listener({ state: "downloading", version: "2026.9.28.1" });
    expect(storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY)).toBeNull();

    listener({ state: "downloaded", version: "2026.9.28.1", releaseNotes: NOTES });
    expect(storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY)).toBe(
      JSON.stringify({ version: "2026.9.28.1", notes: NOTES }),
    );

    expect(stop).toBe(unsubscribe);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not record a downloaded status that lacks version or release notes", () => {
    const storage = createStorage();
    mockSubscribeUpdateStatus.mockReturnValue(vi.fn());

    startWhatsNewRecorder(storage);
    const listener = mockSubscribeUpdateStatus.mock.calls[0][0] as (status: UpdateStatus) => void;

    listener({ state: "downloaded", version: "2026.9.28.1" });
    listener({ state: "downloaded", releaseNotes: NOTES });

    expect(storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY)).toBeNull();
  });
});
