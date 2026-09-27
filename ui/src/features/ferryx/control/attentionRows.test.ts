import { describe, expect, it } from "vitest";

import type { NotificationEntry } from "../../../lib/notificationCenter/types";
import type { Agent } from "./client";
import {
  actionableEntryCount,
  buildAttentionRows,
  filterRows,
  groupRows,
  isRowActionable,
  isRowUnread,
  rowDisplayEntry,
  rowDotState,
  sortRows,
} from "./attentionRows";

function entry(overrides: Partial<NotificationEntry> & Pick<NotificationEntry, "id">): NotificationEntry {
  return {
    workspaceId: "ws-1",
    sessionId: "s-1",
    labels: {},
    subject: "agent",
    reason: "waiting",
    firstOccurredAt: 1000,
    lastOccurredAt: 1000,
    updateOrder: 1,
    revision: 1,
    occurrenceCount: 1,
    read: { unread: true },
    ...overrides,
  };
}

function agent(overrides: Partial<Agent> & Pick<Agent, "target">): Agent {
  return {
    workspaceId: "ws-1",
    label: "agent-1",
    state: "waiting",
    revision: 1,
    source: { kind: "lifecycle" },
    ...overrides,
  };
}

const target = (backendSessionId: string) => ({
  hostId: "local",
  ownerId: "ws-1",
  epoch: "1",
  backendSessionId,
});

describe("buildAttentionRows", () => {
  it("merges the inventory and the event record into one row per session", () => {
    const rows = buildAttentionRows(
      [entry({ id: "e1", sessionId: "s-1", labels: { agentLabel: "claude" }, reason: "waiting" })],
      [agent({ target: target("backend-1"), label: "inventory-label", state: "waiting" })],
      () => "s-1",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("s-1");
    expect(rows[0].section).toBe("needs-you");
    expect(rows[0].label).toBe("claude");
    expect(rows[0].target).toEqual(target("backend-1"));
  });

  it("keeps an inventory session that never raised an event", () => {
    const rows = buildAttentionRows(
      [],
      [agent({ target: target("backend-9"), label: "quiet-agent", state: "working" })],
      () => "s-9",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].section).toBe("working");
    expect(rows[0].label).toBe("quiet-agent");
    expect(rows[0].entry).toBeNull();
  });

  it("keeps an event whose session is no longer in the inventory", () => {
    const rows = buildAttentionRows(
      [entry({ id: "e2", sessionId: "gone", reason: "done" })],
      [],
      () => null,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("gone");
    expect(rows[0].section).toBe("finished");
  });

  it("routes a mention to its own section instead of needs-you", () => {
    const rows = buildAttentionRows(
      [entry({ id: "e3", sessionId: "s-1", reason: "bell" })],
      [agent({ target: target("b"), state: "waiting" })],
      () => "s-1",
    );

    expect(rows[0].section).toBe("mentions");
  });

  it("drops a finished row that has no event behind it, since it would be unreadable", () => {
    const rows = buildAttentionRows(
      [],
      [agent({ target: target("b"), state: "exited" })],
      () => "s-1",
    );

    expect(rows).toHaveLength(0);
  });
});

describe("row classification", () => {
  it("treats a blocked agent and an unread finish as actionable", () => {
    const [blocked] = buildAttentionRows([entry({ id: "a", reason: "waiting" })], [], () => null);
    const [unreadDone] = buildAttentionRows(
      [entry({ id: "b", reason: "done", read: { unread: true } })],
      [],
      () => null,
    );
    const [seenDone] = buildAttentionRows(
      [entry({ id: "c", reason: "done", read: { seen: true, seenAt: 5 } })],
      [],
      () => null,
    );
    const [mention] = buildAttentionRows([entry({ id: "d", reason: "bell" })], [], () => null);

    expect(isRowActionable(blocked)).toBe(true);
    expect(isRowActionable(unreadDone)).toBe(true);
    expect(isRowActionable(seenDone)).toBe(false);
    expect(isRowActionable(mention)).toBe(false);
    expect(isRowUnread(mention)).toBe(true);
  });

  it("counts actionable entries for the badge", () => {
    expect(
      actionableEntryCount([
        entry({ id: "a", reason: "waiting" }),
        entry({ id: "b", reason: "done", read: { unread: true } }),
        entry({ id: "c", reason: "done", read: { seen: true, seenAt: 1 } }),
        entry({ id: "d", reason: "bell" }),
      ]),
    ).toBe(2);
  });
});

describe("filters, order and groups", () => {
  const rows = () =>
    buildAttentionRows(
      [
        entry({ id: "w", sessionId: "w", reason: "waiting", lastOccurredAt: 10 }),
        entry({ id: "d", sessionId: "d", reason: "done", lastOccurredAt: 90, read: { unread: true } }),
        entry({ id: "b", sessionId: "b", reason: "bell", lastOccurredAt: 50 }),
      ],
      [agent({ target: target("k"), workspaceId: "ws-1", label: "worker", state: "working" })],
      (candidate) => (candidate.label === "worker" ? "k" : null),
    );

  it("filters unread and actionable", () => {
    expect(filterRows(rows(), "all")).toHaveLength(4);
    expect(filterRows(rows(), "unread").map((row) => row.sessionId).sort()).toEqual(["b", "d", "k", "w"]);
    expect(filterRows(rows(), "needs-you").map((row) => row.sessionId).sort()).toEqual(["d", "w"]);
  });

  it("orders by section, then unread, then recency, with a total tie-break", () => {
    const ordered = sortRows(rows()).map((row) => row.sessionId);
    expect(ordered).toEqual(["w", "d", "k", "b"]);
  });

  it("emits non-empty sections in priority order", () => {
    const groups = groupRows(rows());
    expect(groups.map((group) => group.section)).toEqual(["needs-you", "finished", "working", "mentions"]);
    expect(groups[0].title).toBe("Needs you");
    expect(groups[3].title).toBe("Mentions");
  });
});

describe("row presentation adapters", () => {
  it("borrows the entry shape for an inventory-only row so one renderer serves both", () => {
    const [row] = buildAttentionRows(
      [],
      [agent({ target: target("k"), label: "worker", state: "working" })],
      () => "k",
    );
    const display = rowDisplayEntry(row);

    expect(display.id).toBe(row.key);
    expect(display.labels.agentLabel).toBe("worker");
    expect(display.reason).toBe("done");
    expect(rowDotState(row)).toBe("working");
  });

  it("reports the event reason's dot when there is no inventory state", () => {
    const [row] = buildAttentionRows([entry({ id: "w", reason: "waiting" })], [], () => null);
    expect(rowDotState(row)).toBe("waiting");
  });
});
