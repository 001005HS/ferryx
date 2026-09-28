import { describe, expect, it } from "vitest";

import { formatPaneDebugInfo } from "./paneDebugInfo";
import type { TerminalSession } from "./types";

describe("formatPaneDebugInfo", () => {
  it("emits one JSON line carrying the identity triad and daemon binding", () => {
    const session = {
      id: "session-a",
      cwd: "/repo",
      workspaceId: "daemon:machine-a",
      worktree: null,
      backendSessionId: "backend-a",
      lifecycle: "working",
      daemonEpoch: "epoch-2",
      remoteGeneration: 3,
    } as TerminalSession;

    const text = formatPaneDebugInfo("leaf-a", session);

    expect(text).not.toContain("\n");
    expect(JSON.parse(text)).toMatchObject({
      leafId: "leaf-a",
      sessionId: "session-a",
      backendSessionId: "backend-a",
      daemonEpoch: "epoch-2",
      workspaceId: "daemon:machine-a",
      cwd: "/repo",
      lifecycle: "working",
      remoteGeneration: 3,
    });
  });

  it("reports a missing backend binding as null instead of dropping the key", () => {
    const parsed = JSON.parse(formatPaneDebugInfo("leaf-b", undefined));

    expect(parsed).toHaveProperty("backendSessionId", null);
    expect(parsed).toHaveProperty("sessionId", null);
  });
});
