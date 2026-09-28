import { describe, expect, it } from "vitest";

import {
  loadFilePreviewWordWrap,
  loadMarkdownFontSize,
  loadMarkdownWide,
  MARKDOWN_FONT_SIZE_DEFAULT,
  MARKDOWN_FONT_SIZE_MAX,
  MARKDOWN_FONT_SIZE_MIN,
  saveFilePreviewWordWrap,
  saveMarkdownFontSize,
  saveMarkdownWide,
  type StorageShim,
} from "./filePreviewReadingSettings";
import {
  FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY,
  FILE_PREVIEW_MARKDOWN_WIDE_STORAGE_KEY,
  FILE_PREVIEW_WORD_WRAP_STORAGE_KEY,
} from "./storageKeys";

function createFakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function createThrowingStorage(): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: () => {
      throw new Error("storage read failure");
    },
    setItem: () => {
      throw new Error("storage write failure");
    },
  };
}

describe("filePreviewReadingSettings", () => {
  it("defaults with empty storage", () => {
    const storage = createFakeStorage();

    expect(loadFilePreviewWordWrap(storage)).toBe(true);
    expect(loadMarkdownFontSize(storage)).toBe(MARKDOWN_FONT_SIZE_DEFAULT);
    expect(loadMarkdownWide(storage)).toBe(false);
  });

  it("persisted values round-trip via a Map-backed fake storage", () => {
    const storage = createFakeStorage();

    saveFilePreviewWordWrap(false, storage);
    expect(storage.getItem(FILE_PREVIEW_WORD_WRAP_STORAGE_KEY)).toBe("0");
    expect(loadFilePreviewWordWrap(storage)).toBe(false);

    saveFilePreviewWordWrap(true, storage);
    expect(storage.getItem(FILE_PREVIEW_WORD_WRAP_STORAGE_KEY)).toBe("1");
    expect(loadFilePreviewWordWrap(storage)).toBe(true);

    saveMarkdownFontSize(18, storage);
    expect(storage.getItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY)).toBe("18");
    expect(loadMarkdownFontSize(storage)).toBe(18);

    saveMarkdownFontSize(14, storage);
    expect(storage.getItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY)).toBe("14");
    expect(loadMarkdownFontSize(storage)).toBe(14);

    saveMarkdownWide(true, storage);
    expect(storage.getItem(FILE_PREVIEW_MARKDOWN_WIDE_STORAGE_KEY)).toBe("1");
    expect(loadMarkdownWide(storage)).toBe(true);

    saveMarkdownWide(false, storage);
    expect(storage.getItem(FILE_PREVIEW_MARKDOWN_WIDE_STORAGE_KEY)).toBe("0");
    expect(loadMarkdownWide(storage)).toBe(false);
  });

  it("font clamp (5 -> 11, 40 -> 22, \"abc\" -> 14)", () => {
    const storage = createFakeStorage();

    storage.setItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY, "5");
    expect(loadMarkdownFontSize(storage)).toBe(MARKDOWN_FONT_SIZE_MIN);

    storage.setItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY, "40");
    expect(loadMarkdownFontSize(storage)).toBe(MARKDOWN_FONT_SIZE_MAX);

    storage.setItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY, "abc");
    expect(loadMarkdownFontSize(storage)).toBe(MARKDOWN_FONT_SIZE_DEFAULT);

    saveMarkdownFontSize(5, storage);
    expect(storage.getItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY)).toBe(String(MARKDOWN_FONT_SIZE_MIN));
    expect(loadMarkdownFontSize(storage)).toBe(MARKDOWN_FONT_SIZE_MIN);

    saveMarkdownFontSize(40, storage);
    expect(storage.getItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY)).toBe(String(MARKDOWN_FONT_SIZE_MAX));
    expect(loadMarkdownFontSize(storage)).toBe(MARKDOWN_FONT_SIZE_MAX);

    saveMarkdownFontSize(Number.NaN, storage);
    expect(storage.getItem(FILE_PREVIEW_MARKDOWN_FONT_SIZE_STORAGE_KEY)).toBe(String(MARKDOWN_FONT_SIZE_DEFAULT));
    expect(loadMarkdownFontSize(storage)).toBe(MARKDOWN_FONT_SIZE_DEFAULT);
  });

  it("null storage returns defaults and save does not throw", () => {
    const nullStorage: StorageShim = null;

    expect(loadFilePreviewWordWrap(nullStorage)).toBe(true);
    expect(loadMarkdownFontSize(nullStorage)).toBe(MARKDOWN_FONT_SIZE_DEFAULT);
    expect(loadMarkdownWide(nullStorage)).toBe(false);

    expect(() => saveFilePreviewWordWrap(false, nullStorage)).not.toThrow();
    expect(() => saveMarkdownFontSize(18, nullStorage)).not.toThrow();
    expect(() => saveMarkdownWide(true, nullStorage)).not.toThrow();
  });

  it("throwing storage returns defaults", () => {
    const throwingStorage = createThrowingStorage();

    expect(loadFilePreviewWordWrap(throwingStorage)).toBe(true);
    expect(loadMarkdownFontSize(throwingStorage)).toBe(MARKDOWN_FONT_SIZE_DEFAULT);
    expect(loadMarkdownWide(throwingStorage)).toBe(false);

    expect(() => saveFilePreviewWordWrap(false, throwingStorage)).not.toThrow();
    expect(() => saveMarkdownFontSize(18, throwingStorage)).not.toThrow();
    expect(() => saveMarkdownWide(true, throwingStorage)).not.toThrow();
  });
});
