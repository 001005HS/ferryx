import { beforeEach, describe, expect, it } from "vitest";
import { createLayoutState } from "../state/layout";
import type { WorkspaceState } from "../state/workspaceStore";
import { saveBrowserSettings } from "./browserSettings";
import {
  clearBrowserScroll,
  getBrowserScroll,
  recordBrowserHistory,
  recordBrowserScroll,
  loadBrowserHistory,
  clearBrowserHistory,
} from "./browserHistory";
import {
  deserializeWorkspaceState,
  isPrivateBrowserProfileId,
  serializeWorkspaceState,
} from "./sessionPersistence";
import type { BrowserTab, PersistedWorkspaceSession } from "./types";

function createMockWorkspace(): WorkspaceState {
  return {
    workspaceId: "ws-1",
    worktrees: [
      {
        path: "/repo/main",
        head: "head-main",
        branch: "main",
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      },
      {
        path: "/repo/feat-x",
        head: "head-feat",
        branch: "feat-x",
        bare: false,
        detached: false,
        locked: null,
        prunable: null,
      },
    ],
    activeWorktreePath: "/repo/main",
    sessions: {},
    layout: createLayoutState(),
    worktreeLayouts: {},
    unreadTabIds: {},
    unreadWorktreePaths: {},
    activityBySessionId: {},
  };
}

describe("browser tab restore per worktree with scroll positions", () => {
  beforeEach(() => {
    localStorage.clear();
    clearBrowserScroll();
    clearBrowserHistory();
    saveBrowserSettings({ restoreTabsOnLaunch: true });
  });

  it("identifies private profile IDs correctly", () => {
    expect(isPrivateBrowserProfileId("private")).toBe(true);
    expect(isPrivateBrowserProfileId("remote")).toBe(true);
    expect(isPrivateBrowserProfileId("default")).toBe(false);
    expect(isPrivateBrowserProfileId(undefined)).toBe(false);
    expect(isPrivateBrowserProfileId(null)).toBe(false);
  });

  it("records and retrieves scroll positions in browserHistory", () => {
    recordBrowserScroll("browser-1", "https://example.com/page", { x: 50, y: 320 });
    const pos = getBrowserScroll("browser-1", "https://example.com/page");
    expect(pos).toEqual({ x: 50, y: 320 });

    recordBrowserHistory({
      browserId: "browser-1",
      url: "https://example.com/page",
      title: "Page Title",
      scrollPosition: { x: 100, y: 500 },
    });
    const history = loadBrowserHistory();
    expect(history[0].scrollPosition).toEqual({ x: 100, y: 500 });
    expect(history[0].scrollX).toBe(100);
    expect(history[0].scrollY).toBe(500);
  });

  it("persists and restores browser tabs per worktree with scroll positions", () => {
    const ws = createMockWorkspace();

    const mainTab: BrowserTab = {
      kind: "browser",
      id: "tab-main-browser",
      label: "Main Docs",
      browserId: "browser-main",
      url: "https://example.com/docs",
      profileId: "default",
      zoomFactor: 1.1,
      worktreePath: "/repo/main",
      ...({ scrollPosition: { x: 0, y: 450 } } as any),
    };

    const featTab: BrowserTab = {
      kind: "browser",
      id: "tab-feat-browser",
      label: "Feat Design",
      browserId: "browser-feat",
      url: "https://example.com/design",
      profileId: "default",
      zoomFactor: 1.0,
      worktreePath: "/repo/feat-x",
      ...({ scrollPosition: { x: 120, y: 890 } } as any),
    };

    ws.layout = createLayoutState([mainTab], mainTab.id);
    ws.worktreeLayouts = {
      "/repo/feat-x": createLayoutState([featTab], featTab.id),
    };

    const serialized = serializeWorkspaceState("ws-1", "/repo/main", ws);
    const deserialized = deserializeWorkspaceState("ws-1", serialized);

    expect(deserialized).not.toBeNull();
    if (!deserialized) return;

    expect(deserialized.layout.tabs).toHaveLength(1);
    const restoredMain = deserialized.layout.tabs[0] as BrowserTab & { scrollPosition?: { x: number; y: number } };
    expect(restoredMain.browserId).toBe("browser-main");
    expect(restoredMain.url).toBe("https://example.com/docs");
    expect(restoredMain.worktreePath).toBe("/repo/main");
    expect(restoredMain.scrollPosition).toEqual({ x: 0, y: 450 });

    const restoredFeatLayout = deserialized.worktreeLayouts?.["/repo/feat-x"];
    expect(restoredFeatLayout).toBeDefined();
    expect(restoredFeatLayout?.tabs).toHaveLength(1);
    const restoredFeat = restoredFeatLayout?.tabs[0] as BrowserTab & { scrollPosition?: { x: number; y: number } };
    expect(restoredFeat.browserId).toBe("browser-feat");
    expect(restoredFeat.url).toBe("https://example.com/design");
    expect(restoredFeat.worktreePath).toBe("/repo/feat-x");
    expect(restoredFeat.scrollPosition).toEqual({ x: 120, y: 890 });
  });

  it("strictly excludes private-profile tabs from serialization and deserialization", () => {
    const ws = createMockWorkspace();

    const normalTab: BrowserTab = {
      kind: "browser",
      id: "tab-normal",
      label: "Normal",
      browserId: "browser-normal",
      url: "https://example.com/normal",
      profileId: "default",
    };
    const privateTab: BrowserTab = {
      kind: "browser",
      id: "tab-private",
      label: "Private",
      browserId: "browser-private",
      url: "https://example.com/incognito",
      profileId: "private",
    };

    ws.layout = createLayoutState([normalTab, privateTab], normalTab.id);

    const serialized = serializeWorkspaceState("ws-1", "/repo/main", ws);
    const persistedTabs = serialized.workspaces["ws-1"].layout.tabs;
    expect(persistedTabs.some((t) => t.id === "tab-private")).toBe(false);
    expect(persistedTabs.some((t) => t.id === "tab-normal")).toBe(true);

    const payloadWithPrivate: PersistedWorkspaceSession = {
      ...serialized,
      workspaces: {
        "ws-1": {
          ...serialized.workspaces["ws-1"],
          layout: {
            ...serialized.workspaces["ws-1"].layout,
            tabs: [
              ...serialized.workspaces["ws-1"].layout.tabs,
              {
                id: "sneaky-private",
                kind: "browser",
                label: "Sneaky",
                browser: {
                  browserId: "sneaky-id",
                  url: "https://example.com/private",
                  profileId: "private",
                },
              },
            ],
          },
        },
      },
    };

    const deserialized = deserializeWorkspaceState("ws-1", payloadWithPrivate);
    expect(deserialized?.layout.tabs.some((t) => t.id === "sneaky-private")).toBe(false);
  });

  it("is backward-compatible with legacy stored payloads missing scroll positions", () => {
    const legacyPayload: PersistedWorkspaceSession = {
      version: 2,
      timestamp: Date.now(),
      activeWorkspaceId: "ws-legacy",
      workspaces: {
        "ws-legacy": {
          workspaceId: "ws-legacy",
          repoRoot: "/repo/legacy",
          worktrees: [
            {
              path: "/repo/legacy",
              branch: "main",
              head: "111",
              isMain: true,
              isLocked: false,
            },
          ],
          activeWorktreePath: "/repo/legacy",
          terminalSessions: {},
          layout: {
            splitMode: "none",
            primaryTabId: "tab-legacy-browser",
            secondaryTabId: null,
            activeTabId: "tab-legacy-browser",
            tabs: [
              {
                id: "tab-legacy-browser",
                kind: "browser",
                label: "Legacy Tab",
                browser: {
                  browserId: "b-legacy",
                  url: "https://example.com/legacy",
                },
              },
            ],
          },
        },
      },
    };

    const deserialized = deserializeWorkspaceState("ws-legacy", legacyPayload);
    expect(deserialized).not.toBeNull();
    const tab = deserialized?.layout.tabs[0] as BrowserTab & { scrollPosition?: { x: number; y: number } };
    expect(tab.browserId).toBe("b-legacy");
    expect(tab.url).toBe("https://example.com/legacy");
    expect(tab.scrollPosition).toEqual({ x: 0, y: 0 });
  });

  it("skips stale tabs whose worktree was deleted or whose URL is unnavigable", () => {
    const stalePayload: PersistedWorkspaceSession = {
      version: 3,
      timestamp: Date.now(),
      activeWorkspaceId: "ws-stale",
      workspaces: {
        "ws-stale": {
          workspaceId: "ws-stale",
          repoRoot: "/repo/main",
          worktrees: [
            { path: "/repo/main", branch: "main", head: "111", isMain: true, isLocked: false },
          ],
          activeWorktreePath: "/repo/main",
          terminalSessions: {},
          layout: {
            splitMode: "none",
            primaryTabId: "valid-tab",
            secondaryTabId: null,
            activeTabId: "valid-tab",
            tabs: [
              {
                id: "valid-tab",
                kind: "browser",
                label: "Valid",
                browser: {
                  browserId: "b-valid",
                  url: "https://example.com/valid",
                  worktreePath: "/repo/main",
                },
              },
              {
                id: "stale-wt-tab",
                kind: "browser",
                label: "Deleted Worktree",
                browser: {
                  browserId: "b-deleted-wt",
                  url: "https://example.com/orphan",
                  worktreePath: "/repo/deleted-worktree-branch",
                },
              },
              {
                id: "stale-url-tab",
                kind: "browser",
                label: "Bad Scheme",
                browser: {
                  browserId: "b-bad-url",
                  url: "javascript:void(0)",
                  worktreePath: "/repo/main",
                },
              },
            ],
          },
        },
      },
    };

    const deserialized = deserializeWorkspaceState("ws-stale", stalePayload);
    expect(deserialized).not.toBeNull();
    const tabIds = deserialized?.layout.tabs.map((t) => t.id);
    expect(tabIds).toContain("valid-tab");
    expect(tabIds).not.toContain("stale-wt-tab");
    expect(tabIds).not.toContain("stale-url-tab");
  });
});
