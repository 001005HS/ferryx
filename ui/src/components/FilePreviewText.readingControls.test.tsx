import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilePreviewText } from "./FilePreviewText";
import type {
  FilePreviewChildAsset,
  FilePreviewMarkdownCapability,
  FilePreviewPayload,
  FilePreviewTextProps,
} from "../lib/filePreviewTypes";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function payloadOf(over: Partial<FilePreviewPayload> = {}): FilePreviewPayload {
  const text = over.text ?? "hello\nworld\n";
  return {
    handle: "h-1",
    displayName: "notes.txt",
    kind: "text",
    byteLength: new TextEncoder().encode(text).length,
    encoding: "utf-8",
    mediaType: null,
    mediaUrl: null,
    text,
    lineCount: text.split("\n").length,
    target: null,
    resolvedPath: null,
    ...over,
  };
}

function capabilityOf(over: Partial<FilePreviewMarkdownCapability> = {}): FilePreviewMarkdownCapability {
  return {
    requestImage: vi.fn(async () => childAsset()),
    requestDocument: vi.fn(),
    openExternalUrl: vi.fn(),
    remainingChildHandles: 32,
    ...over,
  };
}

function childAsset(over: Partial<FilePreviewChildAsset> = {}): FilePreviewChildAsset {
  return {
    handle: "child-1",
    displayName: "logo.png",
    kind: "image",
    byteLength: 1024,
    mediaType: "image/png",
    mediaUrl: "http://127.0.0.1:53211/asset/child-1",
    ...over,
  };
}

function propsOf(over: Partial<FilePreviewTextProps> = {}): FilePreviewTextProps {
  return {
    payload: payloadOf(),
    generation: 1,
    onReload: vi.fn(),
    onExternalOpen: vi.fn(),
    onFailure: vi.fn(),
    target: null,
    sourceMode: false,
    onSourceModeChange: vi.fn(),
    markdown: null,
    ...over,
  };
}

function markdownProps(source: string, over: Partial<FilePreviewTextProps> = {}): FilePreviewTextProps {
  return propsOf({
    payload: payloadOf({ kind: "markdown", displayName: "README.md", text: source }),
    markdown: capabilityOf(),
    ...over,
  });
}

describe("FilePreviewText reading controls", () => {
  it("wrap toggle flips class and persists", () => {
    const text = "A long line of text that tests wrapping behaviour across source preview lines";
    render(<FilePreviewText {...propsOf({ payload: payloadOf({ text }) })} />);

    const lineContent = screen.getByText(text);
    expect(lineContent).toHaveClass("whitespace-pre-wrap");
    expect(lineContent).toHaveClass("break-words");

    const toggle = screen.getByTestId("file-preview-wrap-toggle");
    fireEvent.click(toggle);

    expect(lineContent).toHaveClass("whitespace-pre");
    expect(lineContent).not.toHaveClass("break-words");
    expect(localStorage.getItem("ferryx.filePreview.wordWrap")).toBe("0");

    fireEvent.click(toggle);

    expect(lineContent).toHaveClass("whitespace-pre-wrap");
    expect(lineContent).toHaveClass("break-words");
    expect(localStorage.getItem("ferryx.filePreview.wordWrap")).toBe("1");
  });

  it("honors persisted word wrap false on mount", () => {
    localStorage.setItem("ferryx.filePreview.wordWrap", "0");
    const text = "Another line with pre-saved wrap toggle off";
    render(<FilePreviewText {...propsOf({ payload: payloadOf({ text }) })} />);

    const lineContent = screen.getByText(text);
    expect(lineContent).toHaveClass("whitespace-pre");
    expect(lineContent).not.toHaveClass("break-words");
  });

  it("font inc changes style fontSize to 15px", () => {
    render(<FilePreviewText {...markdownProps("# Test Title\n\nContent paragraph")} />);

    const container = screen.getByTestId("file-preview-markdown");
    expect(container.style.fontSize).toBe("14px");

    const incBtn = screen.getByTestId("file-preview-md-font-inc");
    fireEvent.click(incBtn);

    expect(container.style.fontSize).toBe("15px");
    expect(localStorage.getItem("ferryx.filePreview.markdownFontSize")).toBe("15");

    const decBtn = screen.getByTestId("file-preview-md-font-dec");
    fireEvent.click(decBtn);

    expect(container.style.fontSize).toBe("14px");
    expect(localStorage.getItem("ferryx.filePreview.markdownFontSize")).toBe("14");
  });

  it("width toggle switches prose container between max-w-[72ch] mx-auto and full width", () => {
    render(<FilePreviewText {...markdownProps("# Test Title\n\nContent paragraph")} />);

    const container = screen.getByTestId("file-preview-markdown");
    expect(container).toHaveClass("max-w-[72ch]");
    expect(container).toHaveClass("mx-auto");

    const widthToggle = screen.getByTestId("file-preview-md-width-toggle");
    fireEvent.click(widthToggle);

    expect(container).toHaveClass("w-full");
    expect(container).not.toHaveClass("max-w-[72ch]");
    expect(localStorage.getItem("ferryx.filePreview.markdownWide")).toBe("1");

    fireEvent.click(widthToggle);

    expect(container).toHaveClass("max-w-[72ch]");
    expect(container).toHaveClass("mx-auto");
    expect(localStorage.getItem("ferryx.filePreview.markdownWide")).toBe("0");
  });

  it("TOC lists headings and clicking calls scrollIntoView", () => {
    const scrollMock = vi.fn();
    Element.prototype.scrollIntoView = scrollMock;

    const md = [
      "# Overview",
      "Introductory text",
      "## Installation",
      "Install details",
      "### Advanced Config",
      "Config details",
    ].join("\n\n");

    render(<FilePreviewText {...markdownProps(md)} />);

    expect(screen.queryByTestId("file-preview-md-toc")).toBeNull();

    const tocToggle = screen.getByTestId("file-preview-md-toc-toggle");
    fireEvent.click(tocToggle);

    const toc = screen.getByTestId("file-preview-md-toc");
    expect(toc).toBeInTheDocument();

    const headingItem1 = within(toc).getByText("Overview");
    const headingItem2 = within(toc).getByText("Installation");
    const headingItem3 = within(toc).getByText("Advanced Config");

    expect(headingItem1).toBeInTheDocument();
    expect(headingItem2).toBeInTheDocument();
    expect(headingItem3).toBeInTheDocument();

    const renderedHeading2 = document.getElementById("installation");
    expect(renderedHeading2).not.toBeNull();
    expect(renderedHeading2?.tagName.toLowerCase()).toBe("h2");

    fireEvent.click(headingItem2);
    expect(scrollMock).toHaveBeenCalledWith({ block: "start" });
  });
});
