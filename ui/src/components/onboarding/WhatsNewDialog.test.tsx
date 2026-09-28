import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsNewDialog } from "./WhatsNewDialog";

const NOTES = "## Faster sessions\n\n- Tabs restore instantly\n- Crash recovery for split panes";

describe("WhatsNewDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the dialog label, title, and markdown heading with a list", () => {
    render(<WhatsNewDialog version="2026.9.28.1" notes={NOTES} onClose={vi.fn()} />);

    expect(
      screen.getByRole("dialog", { name: "What's new in Ferryx 2026.9.28.1" }),
    ).toBeDefined();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("heading", { name: "What's new in Ferryx 2026.9.28.1" }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { name: "Faster sessions" })).toBeDefined();
    expect(screen.getByRole("list")).toBeDefined();
    expect(screen.getByText("Tabs restore instantly")).toBeDefined();
    expect(screen.getByText("Crash recovery for split panes")).toBeDefined();
  });

  it("focuses the primary close button on mount", () => {
    render(<WhatsNewDialog version="2026.9.28.1" notes={NOTES} onClose={vi.fn()} />);

    expect(screen.getByTestId("whats-new-close")).toHaveFocus();
  });

  it("calls onClose when the Got it button is clicked", () => {
    const onClose = vi.fn();

    render(<WhatsNewDialog version="2026.9.28.1" notes={NOTES} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("whats-new-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed on the dialog panel", () => {
    const onClose = vi.fn();

    render(<WhatsNewDialog version="2026.9.28.1" notes={NOTES} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
