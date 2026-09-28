import {
  FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY,
  FILE_PREVIEW_MARKDOWN_WIDE_STORAGE_KEY,
  FILE_PREVIEW_WORD_WRAP_STORAGE_KEY,
} from "./storageKeys";

export const MARKDOWN_FONT_SIZE_MIN = 11;
export const MARKDOWN_FONT_SIZE_MAX = 22;
export const MARKDOWN_FONT_SIZE_DEFAULT = 14;

export type StorageShim = Pick<Storage, "getItem" | "setItem"> | null;

export function defaultStorage(): StorageShim {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadFilePreviewWordWrap(storage: StorageShim = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(FILE_PREVIEW_WORD_WRAP_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function saveFilePreviewWordWrap(value: boolean, storage: StorageShim = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(FILE_PREVIEW_WORD_WRAP_STORAGE_KEY, value ? "1" : "0");
  } catch {
  }
}

export function loadMarkdownFontSize(storage: StorageShim = defaultStorage()): number {
  if (!storage) return MARKDOWN_FONT_SIZE_DEFAULT;
  try {
    const raw = storage.getItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY);
    if (raw === null) return MARKDOWN_FONT_SIZE_DEFAULT;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return MARKDOWN_FONT_SIZE_DEFAULT;
    return Math.max(MARKDOWN_FONT_SIZE_MIN, Math.min(MARKDOWN_FONT_SIZE_MAX, parsed));
  } catch {
    return MARKDOWN_FONT_SIZE_DEFAULT;
  }
}

export function saveMarkdownFontSize(value: number, storage: StorageShim = defaultStorage()): void {
  if (!storage) return;
  const parsed = Number.isNaN(value) ? MARKDOWN_FONT_SIZE_DEFAULT : Math.round(value);
  const clamped = Math.max(MARKDOWN_FONT_SIZE_MIN, Math.min(MARKDOWN_FONT_SIZE_MAX, parsed));
  try {
    storage.setItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY, String(clamped));
  } catch {
  }
}

export function loadMarkdownWide(storage: StorageShim = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(FILE_PREVIEW_MARKDOWN_WIDE_STORAGE_KEY);
    if (raw === null) return false;
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

export function saveMarkdownWide(value: boolean, storage: StorageShim = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(FILE_PREVIEW_MARKDOWN_WIDE_STORAGE_KEY, value ? "1" : "0");
  } catch {
  }
}
