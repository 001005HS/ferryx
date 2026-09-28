import { describe, expect, it, vi } from "vitest";

import type { FilePreviewState } from "./filePreview";
import { createFileTabMenuHandlers, fileTabPaths } from "./fileTabPaths";
import type { FileTab, WorkspaceTab } from "./types";

function makeFileTab(path: string): FileTab {
  return {
    kind: "file",
    id: "tab-1",
    label: "test.ts",
    path,
    backendSessionId: "backend-1",
    line: null,
    col: null,
    workspaceId: "ws-1",
    previewId: "preview-1",
  };
}

describe("fileTabPaths", () => {
  it("resolves inside paths relative to the worktree", () => {
    const tab = makeFileTab("src/index.ts");
    const result = fileTabPaths(tab, "/workspace/project/src/index.ts", "/workspace/project");
    expect(result).toEqual({
      absolute: "/workspace/project/src/index.ts",
      relative: "src/index.ts",
    });
  });

  it("returns null relative when the path is outside the worktree", () => {
    const tab = makeFileTab("/etc/hosts");
    const result = fileTabPaths(tab, "/etc/hosts", "/workspace/project");
    expect(result).toEqual({
      absolute: "/etc/hosts",
      relative: null,
    });
  });

  it("returns null relative when worktree prefix matches sibling directory", () => {
    const tab = makeFileTab("/workspace/project-sibling/file.ts");
    const result = fileTabPaths(tab, "/workspace/project-sibling/file.ts", "/workspace/project");
    expect(result).toEqual({
      absolute: "/workspace/project-sibling/file.ts",
      relative: null,
    });
  });

  it("falls back to tab.path when resolvedPath is null", () => {
    const tab = makeFileTab("/workspace/project/src/app.tsx");
    const result = fileTabPaths(tab, null, "/workspace/project");
    expect(result).toEqual({
      absolute: "/workspace/project/src/app.tsx",
      relative: "src/app.tsx",
    });
  });

  it("handles Windows backslash paths correctly", () => {
    const tab = makeFileTab("C:\\Users\\User\\project\\src\\main.ts");
    const result = fileTabPaths(
      tab,
      "C:\\Users\\User\\project\\src\\main.ts",
      "C:\\Users\\User\\project",
    );
    expect(result).toEqual({
      absolute: "C:\\Users\\User\\project\\src\\main.ts",
      relative: "src/main.ts",
    });
  });

  it("handles Windows paths when worktree has forward slashes", () => {
    const tab = makeFileTab("C:\\Users\\User\\project\\src\\main.ts");
    const result = fileTabPaths(
      tab,
      "C:\\Users\\User\\project\\src\\main.ts",
      "C:/Users/User/project",
    );
    expect(result).toEqual({
      absolute: "C:\\Users\\User\\project\\src\\main.ts",
      relative: "src/main.ts",
    });
  });

  it("returns null relative when worktreePath is null", () => {
    const tab = makeFileTab("/workspace/project/src/index.ts");
    const result = fileTabPaths(tab, "/workspace/project/src/index.ts", null);
    expect(result).toEqual({
      absolute: "/workspace/project/src/index.ts",
      relative: null,
    });
  });
});

describe("createFileTabMenuHandlers", () => {
  it("uses resolvedPath when ready and tab.path otherwise", () => {
    const tabReady = makeFileTab("src/original.ts");
    tabReady.id = "tab-ready";
    tabReady.previewId = "preview-ready";

    const tabLoading = makeFileTab("src/loading.ts");
    tabLoading.id = "tab-loading";
    tabLoading.previewId = "preview-loading";

    const tabNoController = makeFileTab("src/no-controller.ts");
    tabNoController.id = "tab-no-controller";
    tabNoController.previewId = "preview-none";

    const readyController = {
      getState: () =>
        ({
          status: "ready",
          payload: { resolvedPath: "/workspace/project/src/resolved.ts" },
        }) as unknown as FilePreviewState,
      reload: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
    };

    const loadingController = {
      getState: () => ({ status: "loading" }) as unknown as FilePreviewState,
      reload: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
    };

    const handlers = createFileTabMenuHandlers({
      tabs: [tabReady, tabLoading, tabNoController],
      worktreePath: "/workspace/project",
      getController: (previewId) => {
        if (previewId === "preview-ready") return readyController;
        if (previewId === "preview-loading") return loadingController;
        return null;
      },
      reveal: vi.fn(),
    });

    expect(handlers.filePathsForTab(tabReady).absolute).toBe(
      "/workspace/project/src/resolved.ts",
    );
    expect(handlers.filePathsForTab(tabLoading).absolute).toBe("src/loading.ts");
    expect(handlers.filePathsForTab(tabNoController).absolute).toBe("src/no-controller.ts");
  });

  it("computes relative path against worktreePath", () => {
    const insideTab = makeFileTab("/workspace/project/src/index.ts");
    insideTab.previewId = "preview-inside";
    const outsideTab = makeFileTab("/var/log/syslog");
    outsideTab.previewId = "preview-outside";

    const handlersWithWorktree = createFileTabMenuHandlers({
      tabs: [insideTab, outsideTab],
      worktreePath: "/workspace/project",
      getController: () => null,
      reveal: vi.fn(),
    });

    expect(handlersWithWorktree.filePathsForTab(insideTab)).toEqual({
      absolute: "/workspace/project/src/index.ts",
      relative: "src/index.ts",
    });
    expect(handlersWithWorktree.filePathsForTab(outsideTab)).toEqual({
      absolute: "/var/log/syslog",
      relative: null,
    });

    const handlersWithoutWorktree = createFileTabMenuHandlers({
      tabs: [insideTab],
      worktreePath: null,
      getController: () => null,
      reveal: vi.fn(),
    });

    expect(handlersWithoutWorktree.filePathsForTab(insideTab)).toEqual({
      absolute: "/workspace/project/src/index.ts",
      relative: null,
    });
  });

  it("calls the right fake for a known file tab id on reload, openExternal, and reveal", async () => {
    const tab = makeFileTab("/workspace/project/src/main.ts");
    const fakeController = {
      getState: () =>
        ({
          status: "ready",
          payload: { resolvedPath: "/workspace/project/src/resolved-main.ts" },
        }) as unknown as FilePreviewState,
      reload: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
    };
    const fakeReveal = vi.fn();

    const handlers = createFileTabMenuHandlers({
      tabs: [tab],
      worktreePath: "/workspace/project",
      getController: (previewId) => (previewId === tab.previewId ? fakeController : null),
      reveal: fakeReveal,
    });

    handlers.onReloadFileTab(tab.id);
    expect(fakeController.reload).toHaveBeenCalledTimes(1);

    handlers.onOpenFileExternally(tab.id);
    expect(fakeController.openExternal).toHaveBeenCalledTimes(1);

    handlers.onRevealFileTab(tab.id);
    expect(fakeReveal).toHaveBeenCalledTimes(1);
    expect(fakeReveal).toHaveBeenCalledWith("/workspace/project/src/resolved-main.ts");
  });

  it("does nothing for unknown id and non-file tab id", () => {
    const fileTab = makeFileTab("/workspace/project/src/main.ts");
    const terminalTab: WorkspaceTab = {
      kind: "terminal",
      id: "term-1",
      label: "Terminal",
      sessionId: "session-1",
    };
    const fakeController = {
      getState: () => ({ status: "closed" }) as unknown as FilePreviewState,
      reload: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => undefined),
    };
    const fakeReveal = vi.fn();

    const handlers = createFileTabMenuHandlers({
      tabs: [fileTab, terminalTab],
      worktreePath: "/workspace/project",
      getController: () => fakeController,
      reveal: fakeReveal,
    });

    handlers.onReloadFileTab("unknown-id");
    handlers.onOpenFileExternally("unknown-id");
    handlers.onRevealFileTab("unknown-id");

    handlers.onReloadFileTab(terminalTab.id);
    handlers.onOpenFileExternally(terminalTab.id);
    handlers.onRevealFileTab(terminalTab.id);

    expect(fakeController.reload).not.toHaveBeenCalled();
    expect(fakeController.openExternal).not.toHaveBeenCalled();
    expect(fakeReveal).not.toHaveBeenCalled();
  });

  it("treats null controller as a no-op", () => {
    const tab = makeFileTab("/workspace/project/src/main.ts");
    const fakeReveal = vi.fn();

    const handlers = createFileTabMenuHandlers({
      tabs: [tab],
      worktreePath: "/workspace/project",
      getController: () => null,
      reveal: fakeReveal,
    });

    handlers.onReloadFileTab(tab.id);
    handlers.onOpenFileExternally(tab.id);
    handlers.onRevealFileTab(tab.id);

    expect(fakeReveal).not.toHaveBeenCalled();
  });

  it("catches rejected promises from reload and openExternal", async () => {
    const tab = makeFileTab("/workspace/project/src/main.ts");
    const fakeController = {
      getState: () => ({ status: "closed" }) as unknown as FilePreviewState,
      reload: vi.fn(async () => {
        throw new Error("reload failed");
      }),
      openExternal: vi.fn(async () => {
        throw new Error("openExternal failed");
      }),
    };

    const handlers = createFileTabMenuHandlers({
      tabs: [tab],
      worktreePath: "/workspace/project",
      getController: () => fakeController,
      reveal: vi.fn(),
    });

    expect(() => handlers.onReloadFileTab(tab.id)).not.toThrow();
    expect(() => handlers.onOpenFileExternally(tab.id)).not.toThrow();
  });
});
