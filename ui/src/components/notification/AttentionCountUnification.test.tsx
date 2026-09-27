import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenterButton } from "./NotificationCenterButton";
import { NotificationCenterPopover } from "./NotificationCenterPopover";
import { createNotificationCenterStore } from "../../lib/notificationCenter/notificationCenterStore";
import { selectGlobalUnreadBadgeCount, type WorkspaceState } from "../../state/workspaceStore";
import { actionableEntryCount } from "../../features/ferryx/control/attentionRows";

describe("Attention count unification across Dock badge, Bell button, and Popover header", () => {
  let store: ReturnType<typeof createNotificationCenterStore>;

  beforeEach(() => {
    localStorage.clear();
    store = createNotificationCenterStore({ storage: null });
  });

  afterEach(cleanup);

  it("ensures Dock badge, Bell button, and Popover header report the same number on states where old counters disagreed", () => {
    store.recordBell({
      workspaceId: "ws-1",
      sessionId: "s-bell-1",
      labels: { terminalTitle: "Terminal 1" },
      subject: "terminal",
      occurredAt: 1000,
      observed: false,
    });
    store.recordBell({
      workspaceId: "ws-1",
      sessionId: "s-bell-2",
      labels: { terminalTitle: "Terminal 2" },
      subject: "terminal",
      occurredAt: 2000,
      observed: false,
    });
    store.recordActivity({
      workspaceId: "ws-1",
      sessionId: "s-waiting",
      labels: { terminalTitle: "Agent Task", agentLabel: "claude" },
      subject: "agent",
      occurredAt: 3000,
      observed: false,
      previousState: "working",
      state: "waiting",
    });

    const entries = store.getSnapshot().entries;
    expect(entries).toHaveLength(3);

    const oldCounter1DockHeuristic = Math.max(1, 2);
    const oldCounter2BellActionable = actionableEntryCount(entries);
    const oldCounter3PopoverUnread = entries.filter((e) => "unread" in e.read).length;

    expect(oldCounter1DockHeuristic).toBe(2);
    expect(oldCounter2BellActionable).toBe(1);
    expect(oldCounter3PopoverUnread).toBe(3);

    const mockState: WorkspaceState = {
      workspaceId: "ws-1",
      worktrees: [],
      activeWorktreePath: "/repo",
      sessions: {},
      layout: { tabs: [], activeTabId: "", layoutsByTabId: {} },
      unreadTabIds: { "tab-bell-1": true, "tab-bell-2": true },
      unreadWorktreePaths: {},
      activityBySessionId: {
        "s-waiting": { state: "waiting", title: "Agent Task", isAgent: true, seen: false },
      },
    } as unknown as WorkspaceState;

    const dockBadgeCount = selectGlobalUnreadBadgeCount(mockState, "ws-1", store);

    const { unmount: unmountButton } = render(<NotificationCenterButton store={store} />);
    const bellBadge = screen.getByTestId("notification-center-badge");
    const bellCount = Number(bellBadge.textContent);

    const { unmount: unmountPopover } = render(
      <NotificationCenterPopover store={store} onClose={vi.fn()} />,
    );

    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.queryByText("2 unread")).toBeNull();
    expect(screen.queryByText("3 unread")).toBeNull();

    expect(dockBadgeCount).toBe(1);
    expect(bellCount).toBe(1);
    expect(dockBadgeCount).toBe(bellCount);

    unmountButton();
    unmountPopover();
  });

  it("unifies to zero when only non-actionable bell notifications are present", () => {
    store.recordBell({
      workspaceId: "ws-1",
      sessionId: "s-bell",
      labels: { terminalTitle: "Terminal Bell" },
      subject: "terminal",
      occurredAt: 1000,
      observed: false,
    });

    const entries = store.getSnapshot().entries;
    expect(entries.filter((e) => "unread" in e.read)).toHaveLength(1);
    expect(actionableEntryCount(entries)).toBe(0);

    const mockState = {
      workspaceId: "ws-1",
      worktrees: [],
      activeWorktreePath: "/repo",
      sessions: {},
      layout: { tabs: [], activeTabId: "", layoutsByTabId: {} },
      unreadTabIds: { "tab-bell": true },
      unreadWorktreePaths: {},
    } as unknown as WorkspaceState;

    expect(selectGlobalUnreadBadgeCount(mockState, "ws-1", store)).toBe(0);

    const { unmount: unmountButton } = render(<NotificationCenterButton store={store} />);
    expect(screen.queryByTestId("notification-center-badge")).toBeNull();

    const { unmount: unmountPopover } = render(
      <NotificationCenterPopover store={store} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/unread/)).toBeNull();

    unmountButton();
    unmountPopover();
  });
});
