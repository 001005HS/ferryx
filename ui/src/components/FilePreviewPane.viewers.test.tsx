import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilePreviewPane } from "./FilePreviewPane";
import type { FilePreviewController, FilePreviewState } from "../lib/filePreview";

afterEach(() => {
  cleanup();
});

let activeController: FilePreviewController;

vi.mock("../lib/filePreviewTabRegistry", () => ({
  getFilePreview: () => activeController,
  retainFilePreview: vi.fn(),
  subscribeFilePreviews: () => () => undefined,
}));

vi.mock("../lib/filePreviewCommands", () => ({
  checkFilePreviewChanged: vi.fn(async () => false),
}));

function createReadyController(displayName: string, text: string): FilePreviewController {
  const readyState: FilePreviewState = {
    status: "ready",
    generation: 1,
    source: {
      leafId: "preview-1",
      sessionId: "preview-1",
      backendSessionId: "back-1",
      workspaceId: null,
    },
    request: {
      path: displayName,
      backendSessionId: "back-1",
      line: null,
      col: null,
    },
    payload: {
      handle: `h-${displayName}`,
      displayName,
      kind: "text",
      byteLength: text.length,
      encoding: "utf-8",
      mediaType: null,
      mediaUrl: null,
      text,
      lineCount: text.split("\n").length,
      target: null,
      resolvedPath: `/repo/${displayName}`,
    },
    remainingChildHandles: 32,
    notice: null,
  };

  return {
    getState: () => readyState,
    subscribe: () => () => undefined,
    reload: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    reportFailure: vi.fn(),
    markdownCapability: () => null,
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } satisfies FilePreviewController;
}

describe("FilePreviewPane viewers", () => {
  it("renders csv viewer for data.csv", () => {
    activeController = createReadyController("data.csv", "a,b\n1,2");
    render(
      <FilePreviewPane
        previewId="preview-1"
        path="data.csv"
        backendSessionId="back-1"
        line={null}
        col={null}
        workspaceId={null}
      />,
    );

    expect(screen.getByTestId("file-preview-csv")).toBeInTheDocument();
    expect(screen.queryByTestId("file-preview-notebook")).not.toBeInTheDocument();
  });

  it("renders notebook viewer for nb.ipynb", () => {
    activeController = createReadyController("nb.ipynb", '{"cells":[],"metadata":{}}');
    render(
      <FilePreviewPane
        previewId="preview-2"
        path="nb.ipynb"
        backendSessionId="back-1"
        line={null}
        col={null}
        workspaceId={null}
      />,
    );

    expect(screen.getByTestId("file-preview-notebook")).toBeInTheDocument();
    expect(screen.queryByTestId("file-preview-csv")).not.toBeInTheDocument();
  });

  it("renders default text preview for a.txt without csv or notebook viewers", () => {
    activeController = createReadyController("a.txt", "hello text");
    render(
      <FilePreviewPane
        previewId="preview-3"
        path="a.txt"
        backendSessionId="back-1"
        line={null}
        col={null}
        workspaceId={null}
      />,
    );

    expect(screen.queryByTestId("file-preview-csv")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-preview-notebook")).not.toBeInTheDocument();
  });
});
