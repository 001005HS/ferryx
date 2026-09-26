import { describe, it, expect } from "vitest";
import { InventoryClientState, targetKey, type Agent } from "./client";
const agent = (hostId: string): Agent => ({target: {hostId, ownerId: "owner", epoch: "1", backendSessionId: "same"}, workspaceId: hostId, label: hostId, state: "waiting", revision: 1, source: {kind: "lifecycle"}});
describe("global inventory", () => {
  it("rejects stale deltas and requires reset on gaps", () => {
    const s = new InventoryClientState();
    s.bootstrap({revision: 4, items: [agent("a")], completeness: "complete", unavailableHosts: []});
    expect(s.delta({sequence: 3, revision: 3, target: agent("a").target, type: "working", data: {...agent("a"), state: "working"}})).toBe(false);
    expect(s.snapshot.items[0].state).toBe("waiting");
    expect(s.delta({sequence: 6, revision: 6, target: agent("a").target, type: "working", data: agent("a")})).toBe(false);
  });
  it("selects and acknowledges one host without touching another client", () => {
    const a = new InventoryClientState(), b = new InventoryClientState();
    a.bootstrap({revision: 1, items: [agent("a"), agent("b")], completeness: "partial", unavailableHosts: ["offline"]});
    a.selected = agent("b").target;
    a.acknowledge(agent("b").target);
    expect(targetKey(a.selected!)).toBe(targetKey(agent("b").target));
    expect(b.selected).toBeNull();
    expect(a.unread(agent("a"))).toBe(true);
    expect(a.unread(agent("b"))).toBe(false);
  });
});
