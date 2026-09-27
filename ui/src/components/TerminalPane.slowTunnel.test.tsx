import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetSessionLifecycleForTests } from "../lib/sessionLifecycle";
import type { TerminalSession } from "../lib/types";
import { dagStore } from "../state/dagStore";
import { remoteHostStore } from "../state/remoteHostStore";
import { TerminalPane } from "./TerminalPane";

vi.mock("./NativeTerminalPane", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./NativeTerminalPane")>();
  return {
    ...actual,
    NativeTerminalPane: vi.fn(({ sessionId, session }) => (
      <div
        data-testid="native-terminal-pane"
        data-session-id={sessionId}
        data-backend-id={session?.backendSessionId}
      />
    )),
  };
});

vi.mock("./TerminalSearchOverlay", () => ({
  TerminalSearchOverlay: vi.fn(({ sessionId, onClose }) => (
    <div data-testid="terminal-search-overlay" data-session-id={sessionId} onClick={onClose} />
  )),
}));

describe("TerminalPane on a slow paired tunnel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dagStore.reset();
    resetSessionLifecycleForTests();
  });

  afterEach(() => {
    cleanup();
    remoteHostStore.reset();
    resetSessionLifecycleForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps showing a visible spawning reason during slow tunnel connect and attaches native terminal on backend resolution", async () => {
    remoteHostStore.setState((s) => ({ ...s, nativeStatus: "ready", machineFeaturesEnabled: true }));

    const s: TerminalSession = {
      id: "paired-slow",
      workspaceId: "daemon:" + "a".repeat(64),
      cwd: "/remote/repo",
      worktree: null,
      backendSessionId: null,
      lifecycle: "working",
      reconnectLifecycle: "spawning",
    };

    const onOpenNewShell = vi.fn();
    const { rerender } = render(
      <TerminalPane session={s} active={true} onOpenNewShell={onOpenNewShell} />,
    );

    const spawningElement = screen.getByTestId("paired-terminal-spawning");
    expect(spawningElement).toHaveAttribute("role", "status");
    expect(spawningElement).toHaveTextContent("Connecting to paired terminal...");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    const spawningAfterTimeout = screen.getByTestId("paired-terminal-spawning");
    expect(spawningAfterTimeout).toHaveAttribute("role", "status");
    expect(spawningAfterTimeout).toHaveTextContent("Connecting to paired terminal...");
    expect(screen.queryByTestId("paired-terminal-unavailable")).toBeNull();

    const resolvedSession: TerminalSession = {
      ...s,
      backendSessionId: "backend-paired-slow",
      lifecycle: "working",
      reconnectLifecycle: undefined,
    };

    rerender(
      <TerminalPane session={resolvedSession} active={true} onOpenNewShell={onOpenNewShell} />,
    );

    expect(screen.queryByTestId("paired-terminal-spawning")).toBeNull();
    expect(screen.getByTestId("native-terminal-pane")).toBeInTheDocument();
  });
});
