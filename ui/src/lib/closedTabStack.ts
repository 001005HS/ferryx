import type { FilePreviewSource } from "./filePreviewTypes";

export type ClosedBrowserTab = {
  kind: "browser";
  url: string;
  profileId?: string;
  worktreePath?: string;
};

export type ClosedFileTab = {
  kind: "file";
  source: FilePreviewSource;
  request: {
    path: string;
    backendSessionId: string;
    line: number | null;
    col: number | null;
  };
};

export type ClosedTab = ClosedBrowserTab | ClosedFileTab;

export function createClosedTabStack(limit = 50): {
  push(entry: ClosedTab): void;
  pop(): ClosedTab | null;
  size(): number;
} {
  const maxLimit = Math.max(0, limit);
  const entries: ClosedTab[] = [];

  return {
    push(entry: ClosedTab): void {
      if (maxLimit === 0) return;
      entries.push(entry);
      while (entries.length > maxLimit) {
        entries.shift();
      }
    },
    pop(): ClosedTab | null {
      while (entries.length > 0) {
        const entry = entries.pop()!;
        if (entry.kind === "browser" && !entry.url) {
          continue;
        }
        return entry;
      }
      return null;
    },
    size(): number {
      return entries.length;
    },
  };
}
