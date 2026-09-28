import { JSDOM } from "jsdom";

if (typeof window === "undefined") {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "http://localhost:3000" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
}

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFilePreviewIds, releaseFilePreview, retainFilePreview } from "../lib/filePreviewTabRegistry";
import type { Worktree } from "../lib/types";
import { useWorkspaceStore, type WorkspaceServices } from "./workspaceStore";

vi.mock("../lib/filePreviewTabRegistry", () => ({
  retainFilePreview: vi.fn(),
  releaseFilePreview: vi.fn(async () => undefined),
  getFilePreview: vi.fn(() => null),
  listFilePreviewIds: vi.fn(() => []),
}));

const services: WorkspaceServices = {
  ensureTerminalEvents: vi.fn(async () => undefined),
  spawnTerminal: vi.fn(async () => "backend-unused"),
  getTerminalCwd: vi.fn(async () => null),
  closeTerminal: vi.fn(async () => undefined),
  waitForTerminalExit: vi.fn(async () => undefined),
};

const worktree: Worktree = {
  path: "/repo/main",
  head: "abc",
  branch: "refs/heads/main",
  bare: false,
  detached: false,
  locked: null,
  prunable: null,
};

const source = {
  leafId: "leaf-1",
  sessionId: "front-1",
  backendSessionId: "back-1",
  workspaceId: "ws-1",
};

describe("file preview tabs", () => {
  const liveIds = new Set<string>();
  beforeEach(() => {
    liveIds.clear();
    vi.mocked(retainFilePreview).mockImplementation((id) => {
      liveIds.add(id);
      return {} as never;
    });
    vi.mocked(listFilePreviewIds).mockImplementation(() => [...liveIds]);
    vi.mocked(releaseFilePreview).mockImplementation(async (id) => {
      liveIds.delete(id);
    });
  });

  it("opens one file tab per path and releases the controller only on close", async () => {
    const { result } = renderHook(() => useWorkspaceStore({ initialWorktrees: [worktree], services }));
    const request = { path: "/repo/readme.md", backendSessionId: "back-1", line: 3, col: 1 };

    let firstId = "";
    act(() => {
      firstId = result.current.openFilePreviewTab(source, request);
    });
    let secondId = "";
    act(() => {
      secondId = result.current.openFilePreviewTab(source, { ...request, line: 9 });
    });
    expect(secondId).toBe(firstId);
    expect(result.current.state.layout.tabs.filter((tab) => tab.kind === "file")).toHaveLength(1);
    const tab = result.current.state.layout.tabs.find((item) => item.id === firstId);
    expect(tab?.kind).toBe("file");
    if (tab?.kind === "file") expect(tab.line).toBe(9);
    expect(retainFilePreview).toHaveBeenCalledTimes(2);
    expect(releaseFilePreview).not.toHaveBeenCalled();

    act(() => {
      result.current.activateTab(firstId);
    });
    expect(releaseFilePreview).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.closeTab(firstId);
    });
    expect(releaseFilePreview).toHaveBeenCalledWith(firstId);
    expect(result.current.state.layout.tabs.some((item) => item.id === firstId)).toBe(false);
  });

  it("disambiguates duplicate basenames across file tabs", () => {
    const { result } = renderHook(() => useWorkspaceStore({ initialWorktrees: [worktree], services }));

    let firstId = "";
    act(() => {
      firstId = result.current.openFilePreviewTab(source, {
        path: "/a/src/index.ts",
        backendSessionId: "back-1",
        line: 1,
        col: 1,
      });
    });

    let tab1 = result.current.state.layout.tabs.find((item) => item.id === firstId);
    expect(tab1?.label).toBe("index.ts");

    let secondId = "";
    act(() => {
      secondId = result.current.openFilePreviewTab(source, {
        path: "/b/ui/index.ts",
        backendSessionId: "back-1",
        line: 1,
        col: 1,
      });
    });

    tab1 = result.current.state.layout.tabs.find((item) => item.id === firstId);
    const tab2 = result.current.state.layout.tabs.find((item) => item.id === secondId);
    expect(tab1?.label).toBe("src/index.ts");
    expect(tab2?.label).toBe("ui/index.ts");
  });

  it("reuses an existing file tab when it lives in a parked worktree layout", () => {
    const otherWorktree: Worktree = {
      path: "/repo/feature",
      head: "def",
      branch: "refs/heads/feature",
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    };

    const { result } = renderHook(() =>
      useWorkspaceStore({ initialWorktrees: [worktree, otherWorktree], services }),
    );

    let tabId = "";
    act(() => {
      tabId = result.current.openFilePreviewTab(source, {
        path: "/repo/shared.ts",
        backendSessionId: "back-1",
        line: 1,
        col: 1,
      });
    });

    act(() => {
      result.current.dispatchWorkspaceAction({ type: "SELECT_WORKTREE", path: otherWorktree.path });
    });

    expect(result.current.state.activeWorktreePath).toBe(otherWorktree.path);
    expect(result.current.state.layout.tabs.some((t) => t.id === tabId)).toBe(false);
    expect(result.current.state.worktreeLayouts?.[worktree.path]?.tabs.some((t) => t.id === tabId)).toBe(true);

    let reopenedId = "";
    act(() => {
      reopenedId = result.current.openFilePreviewTab(source, {
        path: "/repo/shared.ts",
        backendSessionId: "back-1",
        line: 25,
        col: 4,
      });
    });

    expect(reopenedId).toBe(tabId);
    expect(result.current.state.activeWorktreePath).toBe(worktree.path);
    const reopenedTab = result.current.state.layout.tabs.find((t) => t.id === tabId);
    expect(reopenedTab?.kind).toBe("file");
    if (reopenedTab?.kind === "file") {
      expect(reopenedTab.line).toBe(25);
      expect(reopenedTab.col).toBe(4);
    }
  });
});

