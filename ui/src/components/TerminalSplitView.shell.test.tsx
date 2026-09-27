import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutState, SystemPermissionsStatus, TerminalSession } from "../lib/types";
import { resetNotificationSettings } from "../lib/notificationSettings";
import { TerminalSplitView } from "./TerminalSplitView";

const nativeWindow = vi.hoisted(() => ({
  startDragging: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => nativeWindow,
}));

const nativeMenu = vi.hoisted(() => ({
  lastCall: null as null | {
    command: string;
    items: Array<Record<string, unknown>>;
    position: { x: number; y: number };
    onAction: (id: string) => void;
  },
}));

vi.mock("../lib/nativeMenu", () => ({
  openNativePopupMenu: vi.fn(
    async (
      command: string,
      items: Array<Record<string, unknown>>,
      position: { x: number; y: number },
      onAction: (id: string) => void,
    ) => {
      nativeMenu.lastCall = { command, items, position, onAction };
      return () => undefined;
    },
  ),
}));

vi.mock("./TerminalPane", () => ({
  TerminalPane: ({ session }: { session: TerminalSession }) => (
    <div data-testid="terminal-pane" data-session-id={session.id} />
  ),
}));

const mockTauri = vi.hoisted(() => ({
  getSystemPermissionsStatus: vi.fn(),
}));

vi.mock("../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../lib/tauri")>("../lib/tauri");
  return {
    ...actual,
    getSystemPermissionsStatus: () => mockTauri.getSystemPermissionsStatus(),
  };
});

/**
 * Reports `platform` as the HOST platform and resolves once TabBar has actually asked for
 * it, so tests await the exact IPC request instead of a fixed delay.
 */
function stubHostPlatform(platform: string) {
  return new Promise<void>((resolve) => {
    mockTauri.getSystemPermissionsStatus.mockImplementation(() => {
      resolve();
      return Promise.resolve({ platform } as SystemPermissionsStatus);
    });
  });
}

function findMenuEntryRecursively(
  entries: Array<Record<string, unknown>>,
  predicate: (entry: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  for (const entry of entries) {
    if (predicate(entry)) return entry;
    if (entry.kind === "submenu" && Array.isArray(entry.items)) {
      const child = findMenuEntryRecursively(
        entry.items as Array<Record<string, unknown>>,
        predicate,
      );
      if (child) return child;
    }
  }
  return null;
}

describe("TerminalSplitView Windows shell selection forwarding", () => {
  const originalPlatform = navigator.platform;
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    resetNotificationSettings();
    // The browser OS is deliberately the opposite of the host: the shell profile menu must
    // follow the HOST platform the backend reports, never navigator.
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    resetNotificationSettings();
    nativeMenu.lastCall = null;
    Object.defineProperty(navigator, "platform", { value: originalPlatform, configurable: true });
    Object.defineProperty(navigator, "userAgent", { value: originalUserAgent, configurable: true });
  });

  function singleTabLayout(): LayoutState {
    const tabId = "tab-1";
    const sessionId = "session-1";
    const leafId = "leaf-1";
    return {
      tabs: [{ id: tabId, label: "main", sessionId }],
      activeTabId: tabId,
      layoutsByTabId: {
        [tabId]: {
          root: { type: "leaf", leafId },
          activeLeafId: leafId,
          expandedLeafId: null,
          sessionIdsByLeafId: { [leafId]: sessionId },
        },
      },
      tabGroups: {
        "group-default": { id: "group-default", tabIds: [tabId], activeTabId: tabId },
      },
      tabGroupLayout: { type: "group", groupId: "group-default" },
    };
  }

  const sessions: Record<string, TerminalSession> = {
    "session-1": {
      id: "session-1",
      cwd: "/repo",
      worktreePath: "/repo",
      workspaceId: "ws-1",
      worktree: null,
      backendSessionId: "backend-1",
      lifecycle: "working",
    },
  };

  it("forwards cmd shell selection from TabBar through TabGroupView to onAddTab on Windows", async () => {
    const onAddTab = vi.fn();
    const ready = stubHostPlatform("windows");
    render(
      <TerminalSplitView
        layout={singleTabLayout()}
        sessions={sessions}
        onAddTab={onAddTab}
      />,
    );
    await act(async () => {
      await ready;
    });

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(nativeMenu.lastCall).not.toBeNull();

    const cmdEntry = findMenuEntryRecursively(
      nativeMenu.lastCall!.items,
      (entry) =>
        entry.id === "new-terminal:cmd" ||
        (typeof entry.label === "string" && entry.label.includes("Command Prompt")),
    );
    expect(cmdEntry).not.toBeNull();

    nativeMenu.lastCall!.onAction((cmdEntry as { id: string }).id);
    expect(onAddTab).toHaveBeenCalledWith("cmd");
  });

  it("forwards pwsh, powershell, and wsl shells from TabBar through TabGroupView to onAddTab on Windows", async () => {
    const expectedShells = [
      { id: "new-terminal:pwsh", shell: "pwsh", label: "PowerShell" },
      { id: "new-terminal:powershell", shell: "powershell", label: "Windows PowerShell" },
      { id: "new-terminal:wsl", shell: "wsl", label: "WSL" },
    ];

    for (const target of expectedShells) {
      const onAddTab = vi.fn();
      const ready = stubHostPlatform("windows");
      const { unmount } = render(
        <TerminalSplitView
          layout={singleTabLayout()}
          sessions={sessions}
          onAddTab={onAddTab}
        />,
      );
      await act(async () => {
        await ready;
      });

      fireEvent.click(screen.getByRole("button", { name: "New tab" }));
      expect(nativeMenu.lastCall).not.toBeNull();

      const entry = findMenuEntryRecursively(
        nativeMenu.lastCall!.items,
        (item) => item.id === target.id || item.label === target.label,
      );
      expect(entry).not.toBeNull();

      nativeMenu.lastCall!.onAction((entry as { id: string }).id);
      expect(onAddTab).toHaveBeenCalledWith(target.shell);

      unmount();
    }
  });

  it("forwards generic default New Terminal action without shell to onAddTab", async () => {
    const onAddTab = vi.fn();
    const ready = stubHostPlatform("windows");
    render(
      <TerminalSplitView
        layout={singleTabLayout()}
        sessions={sessions}
        onAddTab={onAddTab}
      />,
    );
    await act(async () => {
      await ready;
    });

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(nativeMenu.lastCall).not.toBeNull();

    const defaultTerminal = findMenuEntryRecursively(
      nativeMenu.lastCall!.items,
      (entry) => entry.id === "new-terminal",
    );
    expect(defaultTerminal).not.toBeNull();

    nativeMenu.lastCall!.onAction("new-terminal");
    expect(onAddTab).toHaveBeenCalledWith();
  });

  it("forwards shell selection to onAddTab when all tabs are closed (empty layout fallback)", async () => {
    const onAddTab = vi.fn();
    const emptyLayout: LayoutState = { tabs: [], activeTabId: null, layoutsByTabId: {} };

    const ready = stubHostPlatform("windows");
    render(
      <TerminalSplitView
        layout={emptyLayout}
        sessions={{}}
        onAddTab={onAddTab}
      />,
    );
    await act(async () => {
      await ready;
    });

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(nativeMenu.lastCall).not.toBeNull();

    const cmdEntry = findMenuEntryRecursively(
      nativeMenu.lastCall!.items,
      (entry) =>
        entry.id === "new-terminal:cmd" ||
        (typeof entry.label === "string" && entry.label.includes("Command Prompt")),
    );
    expect(cmdEntry).not.toBeNull();

    nativeMenu.lastCall!.onAction((cmdEntry as { id: string }).id);
    expect(onAddTab).toHaveBeenCalledWith("cmd");
  });
});
