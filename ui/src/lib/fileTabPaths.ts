import type { FilePreviewState } from "./filePreview";
import type { FileTab, WorkspaceTab } from "./types";

export function fileTabPaths(
  tab: FileTab,
  resolvedPath: string | null,
  worktreePath: string | null,
): { absolute: string; relative: string | null } {
  const absolute = resolvedPath ?? tab.path;

  if (!worktreePath) {
    return { absolute, relative: null };
  }

  const normAbsolute = absolute.replace(/\\/g, "/");
  let normWorktree = worktreePath.replace(/\\/g, "/");
  if (normWorktree !== "/") {
    normWorktree = normWorktree.replace(/\/+$/, "");
  }

  if (!normWorktree) {
    return { absolute, relative: null };
  }

  const prefix = normWorktree.endsWith("/") ? normWorktree : normWorktree + "/";
  if (normAbsolute.startsWith(prefix)) {
    const relative = normAbsolute.slice(prefix.length);
    return { absolute, relative };
  }

  return { absolute, relative: null };
}

export function createFileTabMenuHandlers(deps: {
  tabs: readonly WorkspaceTab[];
  worktreePath: string | null;
  getController: (previewId: string) => {
    getState(): FilePreviewState;
    reload(): Promise<void>;
    openExternal(): Promise<void>;
  } | null;
  reveal: (path: string) => Promise<void> | void;
}): {
  filePathsForTab(tab: FileTab): { absolute: string; relative: string | null };
  onReloadFileTab(tabId: string): void;
  onOpenFileExternally(tabId: string): void;
  onRevealFileTab(tabId: string): void;
} {
  function filePathsForTab(tab: FileTab): { absolute: string; relative: string | null } {
    const controller = deps.getController(tab.previewId);
    const state = controller?.getState();
    const resolvedPath =
      state?.status === "ready"
        ? ((state.payload as { resolvedPath?: string | null }).resolvedPath ?? null)
        : null;
    return fileTabPaths(tab, resolvedPath, deps.worktreePath);
  }

  function getActiveFileTabAndController(tabId: string) {
    const tab = deps.tabs.find(
      (candidate): candidate is FileTab => candidate.id === tabId && candidate.kind === "file",
    );
    if (!tab) return null;
    const controller = deps.getController(tab.previewId);
    if (!controller) return null;
    return { tab, controller };
  }

  return {
    filePathsForTab,
    onReloadFileTab(tabId: string): void {
      const active = getActiveFileTabAndController(tabId);
      if (!active) return;
      active.controller.reload().catch(() => undefined);
    },
    onOpenFileExternally(tabId: string): void {
      const active = getActiveFileTabAndController(tabId);
      if (!active) return;
      active.controller.openExternal().catch(() => undefined);
    },
    onRevealFileTab(tabId: string): void {
      const active = getActiveFileTabAndController(tabId);
      if (!active) return;
      const { absolute } = filePathsForTab(active.tab);
      try {
        const result = deps.reveal(absolute);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch(() => undefined);
        }
      } catch {
        // no-op
      }
    },
  };
}
