import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../state/workspaceStore";
import { deserializeWorkspaceState, serializeWorkspaceState } from "./sessionPersistence";

function workspaceState(customLabel?: string): WorkspaceState {
  return {
    worktrees: [
      { path: "/workspace/main", head: "123456", branch: "main", bare: false, detached: false, locked: null, prunable: null },
    ],
    activeWorktreePath: "/workspace/main",
    sessions: {
      "sess-1": {
        id: "sess-1",
        cwd: "/workspace/main",
        worktreePath: "/workspace/main",
        workspaceId: "default",
        worktree: null,
        backendSessionId: "backend-1",
        lifecycle: "working",
      },
    },
    unreadTabIds: {},
    unreadWorktreePaths: {},
    activityBySessionId: {},
    layout: {
      tabs: [{ id: "tab-1", label: "main", sessionId: "sess-1", ...(customLabel ? { customLabel } : {}) }],
      primaryTabId: "tab-1",
      secondaryTabId: null,
      split: "horizontal",
      nestedSplit: null,
      activeTabId: "tab-1",
      layoutsByTabId: {
        "tab-1": {
          root: { type: "leaf", leafId: "leaf-1" },
          activeLeafId: "leaf-1",
          expandedLeafId: null,
          sessionIdsByLeafId: { "leaf-1": "sess-1" },
        },
      },
    },
  };
}

describe("terminal tab custom label persistence", () => {
  it("round-trips a user rename so it survives a restart", () => {
    const saved = serializeWorkspaceState("default", "/workspace/main", workspaceState("release build"));
    const restored = deserializeWorkspaceState("default", saved, ["backend-1"])!;

    expect(restored.layout.tabs[0]).toMatchObject({ id: "tab-1", label: "main", customLabel: "release build" });
  });

  it("restores an unrenamed tab without a custom label", () => {
    const saved = serializeWorkspaceState("default", "/workspace/main", workspaceState());
    const restored = deserializeWorkspaceState("default", saved, ["backend-1"])!;

    expect(restored.layout.tabs[0]).not.toHaveProperty("customLabel");
  });
});
