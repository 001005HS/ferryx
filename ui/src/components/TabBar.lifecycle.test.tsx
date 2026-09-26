import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceTab } from "../lib/types";
import { TabBar } from "./TabBar";

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

const lifecycle = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/sessionLifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sessionLifecycle")>()),
  requestSessionLifecycleAction: lifecycle.request,
}));

function menuItems() {
  if (!nativeMenu.lastCall) throw new Error("native menu was not opened");
  return nativeMenu.lastCall.items;
}

function findEntryRecursively(
  items: Array<Record<string, unknown>>,
  idOrLabel: string,
): { id: string; label: string; enabled?: boolean } | undefined {
  for (const item of items) {
    if (
      (item as { id?: string }).id === idOrLabel ||
      ((item as { label?: string }).label ?? "").includes(idOrLabel)
    ) {
      return item as { id: string; label: string; enabled?: boolean };
    }
    if (item.kind === "submenu" && Array.isArray(item.items)) {
      const found = findEntryRecursively(item.items as Array<Record<string, unknown>>, idOrLabel);
      if (found) return found;
    }
  }
  return undefined;
}

function menuItem(idOrLabel: string) {
  const items = menuItems();
  const found = findEntryRecursively(items, idOrLabel);
  if (!found) {
    throw new Error(`menu item not found: ${idOrLabel}; got ${JSON.stringify(items)}`);
  }
  return found as { id: string; label: string; enabled?: boolean };
}

function clickMenuItem(idOrLabel: string) {
  if (!nativeMenu.lastCall) throw new Error("native menu was not opened");
  act(() => {
    nativeMenu.lastCall?.onAction(menuItem(idOrLabel).id);
  });
}

function terminalTab(id: string, label: string, pinned = false): WorkspaceTab {
  return { id, label, sessionId: `session-${id}`, pinned };
}

function getTab(label: string): HTMLElement {
  return screen.getByText(label).closest('[role="tab"]') as HTMLElement;
}

afterEach(() => {
  cleanup();
  nativeWindow.startDragging.mockClear();
  nativeMenu.lastCall = null;
  lifecycle.request.mockClear();
  localStorage.clear();
});

describe("TabBar lifecycle actions", () => {
  it("(a) with sessionIdForLifecycle, invoking suspend-session and restart-session targets the focused pane session", () => {
    const tab1 = terminalTab("tab-1", "Terminal 1");
    const onActivate = vi.fn();
    render(
      <TabBar
        tabs={[tab1]}
        activeTabId="tab-1"
        onActivate={onActivate}
        onClose={vi.fn()}
        onAdd={vi.fn()}
        sessionIdForLifecycle={() => "session-pane-2"}
      />,
    );

    fireEvent.contextMenu(getTab("Terminal 1"), { clientX: 100, clientY: 20 });
    clickMenuItem("suspend-session");
    expect(lifecycle.request).toHaveBeenCalledWith("suspend", "session-pane-2");

    lifecycle.request.mockClear();

    fireEvent.contextMenu(getTab("Terminal 1"), { clientX: 100, clientY: 20 });
    clickMenuItem("restart-session");
    expect(onActivate).toHaveBeenCalledWith("tab-1");
    expect(lifecycle.request).toHaveBeenCalledWith("restart", "session-pane-2");
  });

  it("(b) without sessionIdForLifecycle, suspend-session uses the tab's own sessionId", () => {
    const tab1 = terminalTab("tab-1", "Terminal 1");
    render(
      <TabBar
        tabs={[tab1]}
        activeTabId="tab-1"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    fireEvent.contextMenu(getTab("Terminal 1"), { clientX: 100, clientY: 20 });
    clickMenuItem("suspend-session");
    expect(lifecycle.request).toHaveBeenCalledWith("suspend", "session-tab-1");
  });
});
