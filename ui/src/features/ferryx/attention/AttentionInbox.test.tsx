import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AttentionInbox } from "./AttentionInbox";
import type { AttentionRow } from "./attentionModel";

const NOW = 1_000_000_000;

function row(overrides: Partial<AttentionRow> & Pick<AttentionRow, "id" | "state">): AttentionRow {
  return {
    revision: 1,
    workspaceId: "ws-1",
    sessionId: overrides.id,
    who: "Claude Code",
    location: "ferryx / main",
    at: NOW - 2 * 60_000,
    ...overrides,
  };
}

const waiting = row({ id: "w", state: "needs-you", who: "omo", text: "Auth method — Which library should we use?" });
const finished = row({ id: "d", state: "done", who: "Codex", location: "ferryx / feat-inbox", text: "Fix login bug" });

afterEach(cleanup);

describe("AttentionInbox", () => {
  it("shows the two states with who, where, and the actual question", () => {
    render(<AttentionInbox rows={[waiting, finished]} onOpen={vi.fn()} now={NOW} />);

    const needsYou = screen.getByRole("region", { name: "유저 인풋 요구" });
    const done = screen.getByRole("region", { name: "작업 종료" });
    expect(within(needsYou).getByText("omo")).toBeInTheDocument();
    expect(within(needsYou).getByText("입력 대기")).toBeInTheDocument();
    expect(within(needsYou).getByTestId("attention-row-text")).toHaveTextContent("Auth method — Which library should we use?");
    expect(within(done).getByText("Codex")).toBeInTheDocument();
    expect(within(done).getByText("ferryx / feat-inbox")).toBeInTheDocument();
    expect(within(done).getByText("완료")).toBeInTheDocument();
    expect(screen.getAllByText("2분 전")).toHaveLength(2);
  });

  it("puts requests above completions", () => {
    render(<AttentionInbox rows={[waiting, finished]} onOpen={vi.fn()} now={NOW} />);
    expect(screen.getAllByTestId("attention-row").map((el) => el.dataset.attentionState)).toEqual(["needs-you", "done"]);
  });

  it("opens the row's session when clicked", () => {
    const onOpen = vi.fn();
    render(<AttentionInbox rows={[waiting]} onOpen={onOpen} now={NOW} />);
    fireEvent.click(screen.getByTestId("attention-row"));
    expect(onOpen).toHaveBeenCalledWith(waiting);
  });

  it("dismissing a row does not also open it", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<AttentionInbox rows={[waiting]} onOpen={onOpen} onDismiss={onDismiss} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "omo 알림 지우기" }));
    expect(onDismiss).toHaveBeenCalledWith(waiting);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("removes a handled row from the list at once instead of leaving it disabled", () => {
    function Harness() {
      const [rows, setRows] = useState<AttentionRow[]>([waiting, finished]);
      const drop = (target: AttentionRow) => setRows((current) => current.filter((candidate) => candidate.id !== target.id));
      return <AttentionInbox rows={rows} onOpen={drop} onDismiss={drop} now={NOW} />;
    }
    render(<Harness />);

    fireEvent.click(screen.getAllByTestId("attention-row")[0]);
    expect(screen.queryByText("omo")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("attention-row")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Codex 알림 지우기" }));
    expect(screen.queryAllByTestId("attention-row")).toHaveLength(0);
    expect(screen.getByTestId("attention-inbox-empty")).toBeInTheDocument();
    expect(document.querySelectorAll("button:disabled")).toHaveLength(0);
  });

  it("offers state filters only when both states are present", () => {
    const { rerender } = render(<AttentionInbox rows={[waiting, finished]} onOpen={vi.fn()} now={NOW} />);
    const filters = screen.getByRole("group", { name: "상태 필터" });
    expect(within(filters).getAllByRole("button").map((button) => button.textContent)).toEqual(["전체2", "인풋 요구1", "종료1"]);
    fireEvent.click(within(filters).getByRole("button", { name: /인풋 요구/ }));
    expect(screen.getAllByTestId("attention-row").map((el) => el.dataset.attentionState)).toEqual(["needs-you"]);
    fireEvent.click(within(filters).getByRole("button", { name: /전체/ }));
    expect(screen.getAllByTestId("attention-row")).toHaveLength(2);

    rerender(<AttentionInbox rows={[finished]} onOpen={vi.fn()} now={NOW} />);
    expect(screen.queryByRole("group", { name: "상태 필터" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("attention-row")).toHaveLength(1);
  });

  it("does not stay stuck on a filter whose rows are gone", () => {
    const { rerender } = render(<AttentionInbox rows={[waiting, finished]} onOpen={vi.fn()} now={NOW} />);
    fireEvent.click(within(screen.getByRole("group", { name: "상태 필터" })).getByRole("button", { name: /종료/ }));
    rerender(<AttentionInbox rows={[waiting]} onOpen={vi.fn()} now={NOW} />);
    expect(screen.getAllByTestId("attention-row").map((el) => el.dataset.attentionState)).toEqual(["needs-you"]);
  });

  it("says nobody is waiting and how many sessions are open when empty", () => {
    render(<AttentionInbox rows={[]} onOpen={vi.fn()} openSessionCount={4} now={NOW} />);
    const empty = screen.getByTestId("attention-inbox-empty");
    expect(empty).toHaveTextContent("지금은 아무도 기다리지 않습니다.");
    expect(empty).toHaveTextContent("열린 세션 4개");
  });
});
