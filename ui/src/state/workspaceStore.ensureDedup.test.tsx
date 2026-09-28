import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import { resetWorkspaceRestore } from "./workspaceRestore";
import { clearHmrWorkspaceState } from "./hmrWorkspaceState";
import { clearWorkspaceSnapshot } from "./workspaceSnapshotCache";
import type { Worktree } from "../lib/types";

const worktree: Worktree = {
  path: "/repo/feature",
  head: "abc",
  branch: "refs/heads/feature",
  bare: false,
  detached: false,
  locked: null,
  prunable: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function gatedServices() {
  const spawns: Array<ReturnType<typeof deferred<string>>> = [];
  const spawnTerminal = vi.fn((_request: { workspaceId: string }) => {
    const gate = deferred<string>();
    spawns.push(gate);
    return gate.promise;
  });
  const services = {
    ensureTerminalEvents: vi.fn(async () => undefined),
    listWorktrees: vi.fn(async () => [worktree]),
    onWorktreeChanged: vi.fn(async () => () => undefined),
    isTauriRuntime: vi.fn(() => true),
    spawnTerminal,
    closeTerminal: vi.fn(async () => undefined),
    waitForTerminalExit: vi.fn(async () => undefined),
    getTerminalCwd: vi.fn(async () => worktree.path),
  };
  return { services, spawns, spawnTerminal };
}

async function spawnStarted(spawns: unknown[], count: number) {
  for (let i = 0; i < 20 && spawns.length < count; i += 1) await Promise.resolve();
  expect(spawns).toHaveLength(count);
}

describe("ensureTabForWorktree in-flight dedup", () => {
  beforeEach(() => {
    resetWorkspaceRestore();
    clearHmrWorkspaceState();
    clearWorkspaceSnapshot();
  });
  afterEach(() => {
    cleanup();
    resetWorkspaceRestore();
    clearHmrWorkspaceState();
    clearWorkspaceSnapshot();
  });

  it("shares one spawn and one tab across concurrent ensures of the same worktree", async () => {
    const { services, spawns, spawnTerminal } = gatedServices();
    const { result } = renderHook(() => useWorkspaceStore({ workspaceId: "ws-a", services }));

    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = result.current.ensureTabForWorktree(worktree);
      second = result.current.ensureTabForWorktree(worktree);
    });
    expect(second).toBe(first);
    await act(async () => { await spawnStarted(spawns, 1); });

    await act(async () => {
      spawns[0].resolve("backend-1");
      await first;
    });

    expect(spawnTerminal).toHaveBeenCalledTimes(1);
    expect(result.current.state.layout.tabs).toHaveLength(1);
    expect(await second).toBe(result.current.state.layout.tabs[0].id);
  });

  it("releases a rejected ensure so the next click can retry", async () => {
    const { services, spawns, spawnTerminal } = gatedServices();
    const { result } = renderHook(() => useWorkspaceStore({ workspaceId: "ws-a", services }));

    let first!: Promise<string | null>;
    let joined!: Promise<string | null>;
    act(() => {
      first = result.current.ensureTabForWorktree(worktree);
      joined = result.current.ensureTabForWorktree(worktree);
    });
    await act(async () => { await spawnStarted(spawns, 1); });
    const failure = { code: "PAIRED_HOST_UNAVAILABLE", message: "offline" };
    await act(async () => {
      spawns[0].reject(failure);
      await expect(first).rejects.toBe(failure);
    });
    await expect(joined).rejects.toBe(failure);

    let retry!: Promise<string | null>;
    act(() => { retry = result.current.ensureTabForWorktree(worktree); });
    expect(retry).not.toBe(first);
    await act(async () => { await spawnStarted(spawns, 2); });
    await act(async () => {
      spawns[1].resolve("backend-2");
      await retry;
    });

    expect(spawnTerminal).toHaveBeenCalledTimes(2);
    expect(result.current.state.layout.tabs).toHaveLength(1);
  });

  it("never hands a previous workspace's in-flight ensure to the new workspace", async () => {
    const { services, spawns, spawnTerminal } = gatedServices();
    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) => useWorkspaceStore({ workspaceId, services }),
      { initialProps: { workspaceId: "ws-a" } },
    );

    let stale!: Promise<string | null>;
    act(() => { stale = result.current.ensureTabForWorktree(worktree); });
    await act(async () => { await spawnStarted(spawns, 1); });

    rerender({ workspaceId: "ws-b" });
    let fresh!: Promise<string | null>;
    act(() => { fresh = result.current.ensureTabForWorktree(worktree); });
    expect(fresh).not.toBe(stale);
    await act(async () => { await spawnStarted(spawns, 2); });

    expect(spawnTerminal).toHaveBeenCalledTimes(2);
    expect(spawnTerminal.mock.calls[0][0].workspaceId).toBe("ws-a");
    expect(spawnTerminal.mock.calls[1][0].workspaceId).toBe("ws-b");

    await act(async () => {
      spawns[0].resolve("backend-stale");
      spawns[1].resolve("backend-fresh");
      await Promise.all([stale, fresh]);
    });
    // The ws-a spawn landed after the switch, so openTab discards it and closes its PTY.
    expect(await stale).toBeNull();
    expect(services.closeTerminal).toHaveBeenCalledWith("backend-stale");
  });
});
