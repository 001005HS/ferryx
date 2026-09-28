import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FilePreviewNotebook } from "./FilePreviewNotebook";

describe("FilePreviewNotebook", () => {
  it("renders invalid banner when parseNotebook returns null", () => {
    render(<FilePreviewNotebook text="not json" />);
    const invalidElem = screen.getByTestId("file-preview-notebook-invalid");
    expect(invalidElem).toBeInTheDocument();
    expect(screen.queryByTestId("file-preview-notebook")).not.toBeInTheDocument();
  });

  it("renders markdown headings and content properly", () => {
    const notebook = JSON.stringify({
      cells: [
        {
          cell_type: "markdown",
          source: "# Main Notebook Title\n\nThis is a paragraph with **bold** text.",
        },
      ],
    });

    render(<FilePreviewNotebook text={notebook} />);
    const root = screen.getByTestId("file-preview-notebook");
    expect(root).toBeInTheDocument();

    const cell = screen.getAllByTestId("notebook-cell").filter((el) => el.getAttribute("data-kind") === "markdown")[0];
    expect(cell).toHaveAttribute("data-kind", "markdown");

    const heading = screen.getByRole("heading", { level: 1, name: "Main Notebook Title" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(/This is a paragraph with/)).toBeInTheDocument();
  });

  it("does not render script inside markdown as an element", () => {
    const notebook = JSON.stringify({
      cells: [
        {
          cell_type: "markdown",
          source: "# Safe markdown\n\n<script>alert('xss')</script>",
        },
      ],
    });

    const { container } = render(<FilePreviewNotebook text={notebook} />);
    const scriptTag = container.querySelector("script");
    expect(scriptTag).toBeNull();
  });

  it("renders code cells with execution count and gutter", () => {
    const notebook = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          execution_count: 42,
          source: ["def foo():\n", "    return 1"],
          outputs: [],
        },
      ],
    });

    render(<FilePreviewNotebook text={notebook} />);
    const cell = screen.getAllByTestId("notebook-cell").filter((el) => el.getAttribute("data-kind") === "code")[0];
    expect(cell).toHaveAttribute("data-kind", "code");
    expect(screen.getByText("In [42]:")).toBeInTheDocument();
    expect(screen.getByText(/def foo\(\):/)).toBeInTheDocument();
  });

  it("renders image output with data URI", () => {
    const notebook = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          execution_count: 1,
          source: "plot()",
          outputs: [
            {
              output_type: "display_data",
              data: {
                "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              },
            },
          ],
        },
      ],
    });

    render(<FilePreviewNotebook text={notebook} />);
    const img = screen.getByAltText("Cell output");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute(
      "src",
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    );
  });

  it("renders error output in a red-tinted box with ANSI stripped", () => {
    const notebook = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          execution_count: 2,
          source: "1 / 0",
          outputs: [
            {
              output_type: "error",
              ename: "\u001b[1;31mZeroDivisionError\u001b[0m",
              evalue: "integer division by zero",
              traceback: [
                "\u001b[1;31mZeroDivisionError\u001b[0m: integer division by zero",
              ],
            },
          ],
        },
      ],
    });

    render(<FilePreviewNotebook text={notebook} />);
    expect(screen.getByText("ZeroDivisionError")).toBeInTheDocument();
    expect(screen.getByText("ZeroDivisionError: integer division by zero")).toBeInTheDocument();
    expect(screen.queryByText(/\\u001b/)).not.toBeInTheDocument();
  });

  it("ignores text/html output and never renders HTML elements from it", () => {
    const notebook = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          execution_count: 3,
          source: "df.head()",
          outputs: [
            {
              output_type: "execute_result",
              data: {
                "text/html": "<table id='dangerous-table'><tr><td>Injected</td></tr></table>",
              },
            },
          ],
        },
      ],
    });

    const { container } = render(<FilePreviewNotebook text={notebook} />);
    expect(container.querySelector("#dangerous-table")).toBeNull();
    expect(screen.queryByText("Injected")).not.toBeInTheDocument();
  });
});
