import { beforeEach, describe, expect, it } from "vitest";

import type { TerminalActivity } from "../lib/activity";
import type {
  LayoutState,
  TabPaneLayout,
  TerminalSession,
  TerminalTab,
  WorkspaceTab,
} from "../lib/types";
import { __resetTabDisplayCacheForTests, computeTerminalTabDisplay } from "./tabDisplay";

const WORKTREE = "/Users/dev/projects/ferryx";

function terminalTab(id: string, label: string, sessionId = `session-${id}`): TerminalTab {
  return { id, label, sessionId };
}

function session(id: string, worktreePath: string = WORKTREE): TerminalSession {
  return {
    id,
    cwd: worktreePath,
    worktreePath,
    workspaceId: "ws-1",
    worktree: null,
    backendSessionId: `backend-${id}`,
    lifecycle: "running",
  };
}

function agentActivity(title: string): TerminalActivity {
  return { state: "working", title, isAgent: true, agentType: "omo" };
}

function shellActivity(title: string): TerminalActivity {
  return { state: "working", title, isAgent: false };
}

function layoutOf(
  tabs: WorkspaceTab[],
  layoutsByTabId: LayoutState["layoutsByTabId"] = {},
): LayoutState {
  return { tabs, activeTabId: tabs[0]?.id ?? null, layoutsByTabId };
}

describe("computeTerminalTabDisplay", () => {
  beforeEach(() => {
    __resetTabDisplayCacheForTests();
  });

  it("strips the project suffix from an agent title", () => {
    const tab = terminalTab("tab-1", "main", "s1");
    const display = computeTerminalTabDisplay(
      [tab],
      layoutOf([tab]),
      { s1: session("s1") },
      { s1: agentActivity("OmO - fix login bug - ferryx") },
    );

    expect(display["tab-1"]?.text).toBe("fix login bug");
  });

  it("falls back to the tab label when the title is a bare shell prompt", () => {
    const tab = terminalTab("tab-1", "main", "s1");
    const display = computeTerminalTabDisplay(
      [tab],
      layoutOf([tab]),
      { s1: session("s1") },
      { s1: shellActivity("zsh") },
    );

    expect(display["tab-1"]?.text).toBe("main");
  });

  it("prefers an explicit custom label over a live agent title", () => {
    const tab: WorkspaceTab = { ...terminalTab("tab-1", "main", "s1"), customLabel: "My run" };
    const display = computeTerminalTabDisplay(
      [tab],
      layoutOf([tab]),
      { s1: session("s1") },
      { s1: agentActivity("OmO - fix login bug - ferryx") },
    );

    expect(display["tab-1"]?.text).toBe("My run");
  });

  it("disambiguates duplicate resolved texts within one tab list", () => {
    const first = terminalTab("tab-1", "main", "s1");
    const second = terminalTab("tab-2", "main", "s2");
    const tabs = [first, second];
    const display = computeTerminalTabDisplay(
      tabs,
      layoutOf(tabs),
      { s1: session("s1"), s2: session("s2") },
      { s1: shellActivity("zsh"), s2: shellActivity("zsh") },
    );

    expect(display["tab-1"]?.text).toBe("main");
    expect(display["tab-2"]?.text).toBe("main (2)");
  });

  it("uses the focused pane session title for a split tab", () => {
    const tab = terminalTab("tab-1", "main", "s1");
    const paneLayout: TabPaneLayout = {
      root: {
        type: "split",
        direction: "horizontal",
        first: { type: "leaf", leafId: "leaf-a" },
        second: { type: "leaf", leafId: "leaf-b" },
        ratio: 0.5,
      },
      activeLeafId: "leaf-b",
      expandedLeafId: null,
      sessionIdsByLeafId: { "leaf-a": "s1", "leaf-b": "s2" },
    };
    const display = computeTerminalTabDisplay(
      [tab],
      layoutOf([tab], { "tab-1": paneLayout }),
      { s1: session("s1"), s2: session("s2") },
      { s1: shellActivity("zsh"), s2: agentActivity("OmO - fix login bug - ferryx") },
    );

    expect(display["tab-1"]?.text).toBe("fix login bug");
  });

  it("keeps the last stable agent task across a transient status title", () => {
    const tab = terminalTab("tab-1", "main", "s1");
    const layout = layoutOf([tab]);
    const sessions = { s1: session("s1") };

    const first = computeTerminalTabDisplay([tab], layout, sessions, {
      s1: agentActivity("OmO - fix login bug - ferryx"),
    });
    expect(first["tab-1"]?.text).toBe("fix login bug");

    const second = computeTerminalTabDisplay([tab], layout, sessions, {
      s1: agentActivity("OmO - PostToolUse: (OmO) Checking LSP Diagnostics - ferryx"),
    });
    expect(second["tab-1"]?.text).toBe("fix login bug");
  });

  it("drops a legacy stored ordinal from the displayed label", () => {
    const tab = terminalTab("tab-1", "main (3)", "s1");
    const display = computeTerminalTabDisplay(
      [tab],
      layoutOf([tab]),
      { s1: session("s1") },
      { s1: shellActivity("zsh") },
    );

    expect(display["tab-1"]?.text).toBe("main");
  });

  it("leaves browser and file tabs out of the display map", () => {
    const terminal = terminalTab("tab-t", "main", "s1");
    const browser: WorkspaceTab = {
      id: "tab-b",
      kind: "browser",
      label: "Docs",
      browserId: "browser-1",
      url: "https://example.com",
    };
    const file: WorkspaceTab = {
      id: "tab-f",
      kind: "file",
      label: "readme",
      path: "/x/readme.md",
      backendSessionId: "backend-1",
      line: null,
      col: null,
      workspaceId: null,
      previewId: "preview-1",
    };
    const tabs = [terminal, browser, file];
    const display = computeTerminalTabDisplay(tabs, layoutOf(tabs), { s1: session("s1") }, {});

    expect(Object.keys(display)).toEqual(["tab-t"]);
  });

  it("forgets cached agent text once the session leaves the session map", () => {
    const tab = terminalTab("tab-1", "main", "s1");
    const layout = layoutOf([tab]);

    computeTerminalTabDisplay([tab], layout, { s1: session("s1") }, {
      s1: agentActivity("OmO - fix login bug - ferryx"),
    });
    computeTerminalTabDisplay([tab], layout, {}, {});

    const later = computeTerminalTabDisplay([tab], layout, { s1: session("s1") }, {
      s1: agentActivity("OmO - PostToolUse: (OmO) Checking LSP Diagnostics - ferryx"),
    });

    expect(later["tab-1"]?.text).toBe("OMO");
  });
});
