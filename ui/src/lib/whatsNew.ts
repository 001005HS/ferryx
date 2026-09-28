import { WHATS_NEW_PENDING_STORAGE_KEY, WHATS_NEW_SEEN_VERSION_STORAGE_KEY } from "./storageKeys";
import { subscribeUpdateStatus } from "./updater";

export type WhatsNewEntry = { version: string; notes: string };

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function recordPendingReleaseNotes(
  version: string,
  notes: string,
  storage: Storage | null = browserStorage(),
): void {
  if (notes.trim().length === 0) return;
  if (!storage) return;
  try {
    storage.setItem(WHATS_NEW_PENDING_STORAGE_KEY, JSON.stringify({ version, notes }));
  } catch {}
}

export function resolveWhatsNew(
  currentVersion: string | null,
  storage: Storage | null = browserStorage(),
): WhatsNewEntry | null {
  if (currentVersion === null) return null;
  if (!storage) return null;
  try {
    const raw = storage.getItem(WHATS_NEW_PENDING_STORAGE_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;
    const { version, notes } = parsed as { version?: unknown; notes?: unknown };
    if (typeof version !== "string" || typeof notes !== "string") return null;
    if (version !== currentVersion) return null;
    if (storage.getItem(WHATS_NEW_SEEN_VERSION_STORAGE_KEY) === currentVersion) return null;
    return { version, notes };
  } catch {
    return null;
  }
}

export function markWhatsNewSeen(
  version: string,
  storage: Storage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(WHATS_NEW_SEEN_VERSION_STORAGE_KEY, version);
    storage.removeItem(WHATS_NEW_PENDING_STORAGE_KEY);
  } catch {}
}

export function startWhatsNewRecorder(storage: Storage | null = browserStorage()): () => void {
  return subscribeUpdateStatus((status) => {
    if (status.state !== "downloaded") return;
    if (status.version === undefined || status.releaseNotes === undefined) return;
    recordPendingReleaseNotes(status.version, status.releaseNotes, storage);
  });
}
