import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MobileChatThreadList, type ThreadListRow } from "./MobileChatThreadList";

const baseRows: ThreadListRow[] = [
  { id: "row-1", title: "Fix ferryx relay", worktreeLabel: "main", agentLabel: "claude", status: "working" },
  { id: "row-2", title: "Bump version", worktreeLabel: "main", agentLabel: "opus", status: "waiting", relativeTime: "2m" },
  { id: "row-3", title: "Write docs", worktreeLabel: "docs", agentLabel: "gpt", status: "done" },
];

describe("MobileChatThreadList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("1. renders one row per supplied row with the title text", () => {
    render(<MobileChatThreadList rows={baseRows} onSelectRow={vi.fn()} />);

    expect(screen.getByTestId("thread-row-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("thread-row-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("thread-row-row-3")).toBeInTheDocument();
    expect(screen.getByText("Fix ferryx relay")).toBeInTheDocument();
    expect(screen.getByText("Bump version")).toBeInTheDocument();
    expect(screen.getByText("Write docs")).toBeInTheDocument();
    expect(screen.getByTestId("thread-group-main")).toHaveTextContent("main2");
    expect(screen.getByTestId("thread-group-docs")).toHaveTextContent("docs1");
  });

  it("2. renders the monospace meta line joined as worktree · agent", () => {
    render(<MobileChatThreadList rows={baseRows} onSelectRow={vi.fn()} />);

    const meta = screen.getByText("main · claude");
    expect(meta).toBeInTheDocument();
    expect(meta).toHaveClass("font-mono");
  });

  it("3. renders the status label for working and waiting, but no label for done", () => {
    render(
      <MobileChatThreadList
        rows={[
          { id: "s1", title: "One", status: "working" },
          { id: "s2", title: "Two", status: "waiting" },
          { id: "s3", title: "Three", status: "done" },
        ]}
        onSelectRow={vi.fn()}
      />,
    );

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Approval")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();

    const labels = screen.getAllByTestId("thread-row-status");
    expect(labels).toHaveLength(2);
    expect(labels.map((label) => label.getAttribute("data-status"))).toEqual(["working", "waiting"]);
  });

  it("4. marks exactly one active row", () => {
    render(<MobileChatThreadList rows={baseRows} activeRowId="row-2" onSelectRow={vi.fn()} />);

    expect(screen.getAllByTestId("thread-row-active")).toHaveLength(1);
    expect(screen.getByTestId("thread-row-row-2")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("thread-row-row-1")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("thread-row-row-3")).not.toHaveAttribute("aria-current");
  });

  it("5. clicking a row calls onSelectRow with that exact row object", () => {
    const handleSelect = vi.fn();
    render(<MobileChatThreadList rows={baseRows} onSelectRow={handleSelect} />);

    fireEvent.click(screen.getByTestId("thread-row-row-3"));

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(baseRows[2]);
  });

  it("6. typing into the search input filters rows and shows the empty state", () => {
    render(<MobileChatThreadList rows={baseRows} onSelectRow={vi.fn()} />);
    const input = screen.getByTestId("thread-search-input");

    fireEvent.change(input, { target: { value: "docs" } });
    expect(screen.getByTestId("thread-row-row-3")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-row-row-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thread-row-row-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thread-group-main")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thread-list-empty")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "does-not-exist" } });
    expect(screen.getByTestId("thread-list-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-row-row-3")).not.toBeInTheDocument();
  });

  it("7. clearing the query restores all rows", () => {
    render(<MobileChatThreadList rows={baseRows} onSelectRow={vi.fn()} />);
    const input = screen.getByTestId("thread-search-input");

    fireEvent.change(input, { target: { value: "relay" } });
    expect(screen.getByTestId("thread-row-row-1")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-row-row-2")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("thread-row-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("thread-row-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("thread-row-row-3")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-list-empty")).not.toBeInTheDocument();
  });

  it("8. renders provider glyph when agentType is supplied and omits it when absent", () => {
    render(
      <MobileChatThreadList
        rows={[
          { id: "with-agent", title: "With OMO", agentType: "omo" },
          { id: "without-agent", title: "Without agent" },
        ]}
        onSelectRow={vi.fn()}
      />,
    );

    const withAgentRow = screen.getByTestId("thread-row-with-agent");
    const withoutAgentRow = screen.getByTestId("thread-row-without-agent");

    expect(within(withAgentRow).getByTestId("thread-row-provider")).toBeInTheDocument();
    expect(within(withoutAgentRow).queryByTestId("thread-row-provider")).not.toBeInTheDocument();
  });
});