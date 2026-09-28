import { FILE_OPEN_TARGETS_STORAGE_KEY } from "./storageKeys";

export type FileOpenCategory = "markdown" | "image" | "pdf" | "media" | "text";
export type FileOpenTarget = "in-app" | "external";

export const DEFAULT_FILE_OPEN_TARGETS: Record<FileOpenCategory, FileOpenTarget> = {
  markdown: "in-app",
  image: "in-app",
  pdf: "in-app",
  media: "in-app",
  text: "in-app",
};

const CATEGORIES: readonly FileOpenCategory[] = ["markdown", "image", "pdf", "media", "text"];

export function classifyFileOpenCategory(path: string): FileOpenCategory {
  if (!path) return "text";
  const normalized = path.replace(/[/\\]+$/, "");
  const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const filename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0) {
    return "text";
  }
  const ext = filename.slice(dotIndex + 1).toLowerCase();
  switch (ext) {
    case "md":
    case "markdown":
    case "mdx":
      return "markdown";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
    case "svg":
    case "ico":
    case "avif":
      return "image";
    case "pdf":
      return "pdf";
    case "mp4":
    case "mov":
    case "webm":
    case "m4v":
    case "mp3":
    case "wav":
    case "ogg":
    case "m4a":
    case "flac":
      return "media";
    default:
      return "text";
  }
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadFileOpenTargets(
  storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage(),
): Record<FileOpenCategory, FileOpenTarget> {
  const result: Record<FileOpenCategory, FileOpenTarget> = {
    ...DEFAULT_FILE_OPEN_TARGETS,
  };

  if (!storage) {
    return result;
  }

  try {
    const raw = storage.getItem(FILE_OPEN_TARGETS_STORAGE_KEY);
    if (!raw) {
      return result;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const cat of CATEGORIES) {
        const val = record[cat];
        if (val === "in-app" || val === "external") {
          result[cat] = val;
        }
      }
    }
  } catch {
    return { ...DEFAULT_FILE_OPEN_TARGETS };
  }

  return result;
}

export function saveFileOpenTargets(
  next: Record<FileOpenCategory, FileOpenTarget>,
  storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage(),
): void {
  const sanitized: Record<FileOpenCategory, FileOpenTarget> = {
    markdown: next?.markdown === "external" ? "external" : "in-app",
    image: next?.image === "external" ? "external" : "in-app",
    pdf: next?.pdf === "external" ? "external" : "in-app",
    media: next?.media === "external" ? "external" : "in-app",
    text: next?.text === "external" ? "external" : "in-app",
  };
  try {
    storage?.setItem(FILE_OPEN_TARGETS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {}
}

export function fileOpenTargetFor(
  path: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage(),
): FileOpenTarget {
  const category = classifyFileOpenCategory(path);
  const targets = loadFileOpenTargets(storage);
  return targets[category];
}
