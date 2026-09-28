import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceTab } from "../../lib/types";
import { SortableTab } from "./SortableTab";

afterEach(() => {
  cleanup();
});

function renderSortableTab({
  tab,
  groupId = "group-1",
  index = 0,
  active = true,
  unread = false,
  onClose = vi.fn(),
  onActivate = vi.fn(),
}: {
  tab: WorkspaceTab;
  groupId?: string;
  index?: number;
  active?: boolean;
  unread?: boolean;
  onClose?: (tabId: string) => void;
  onActivate?: (tabId: string) => void;
}) {
  return render(
    <DndContext>
      <SortableContext items={[`tab:${tab.id}`]} strategy={horizontalListSortingStrategy}>
        <SortableTab
          tab={tab}
          groupId={groupId}
          index={index}
          active={active}
          unread={unread}
          isRenaming={false}
          renameValue=""
          onRenameValueChange={vi.fn()}
          onCommitRename={vi.fn()}
          onCancelRename={vi.fn()}
          onActivate={onActivate}
          onClose={onClose}
          onContextMenu={vi.fn()}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe("SortableTab file extras and middle-click", () => {
  it('renders data-file-icon="image" for a file tab with path "/r/a.png"', () => {
    const fileTab: WorkspaceTab = {
      kind: "file",
      id: "tab-file-1",
      label: "a.png",
      path: "/r/a.png",
      backendSessionId: "session-file-1",
      line: null,
      col: null,
      workspaceId: null,
      previewId: "preview-file-1",
    };

    renderSortableTab({ tab: fileTab });

    const icon = screen.getByTestId("tab-file-icon");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("data-file-icon", "image");
  });

  it("calls onClose once when middle-clicking an unpinned tab", () => {
    const onClose = vi.fn();
    const tab: WorkspaceTab = {
      id: "tab-1",
      label: "terminal tab",
      sessionId: "session-1",
      pinned: false,
    } as WorkspaceTab;

    renderSortableTab({ tab, onClose });

    const tabElement = screen.getByRole("tab");
    fireEvent(tabElement, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("tab-1");
  });

  it("does not call onClose when middle-clicking a pinned tab", () => {
    const onClose = vi.fn();
    const tab: WorkspaceTab = {
      id: "tab-pinned-1",
      label: "pinned tab",
      sessionId: "session-pinned-1",
      pinned: true,
    } as WorkspaceTab;

    renderSortableTab({ tab, onClose });

    const tabElement = screen.getByRole("tab");
    fireEvent(tabElement, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose once when middle-clicking an unpinned file tab", () => {
    const onClose = vi.fn();
    const fileTab: WorkspaceTab = {
      kind: "file",
      id: "tab-file-code",
      label: "index.ts",
      path: "/src/index.ts",
      backendSessionId: "session-file-code",
      line: null,
      col: null,
      workspaceId: null,
      previewId: "preview-file-code",
      pinned: false,
    };

    renderSortableTab({ tab: fileTab, onClose });

    const tabElement = screen.getByRole("tab");
    fireEvent(tabElement, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("tab-file-code");
  });

  it("does not call onClose when middle-clicking a pinned file tab", () => {
    const onClose = vi.fn();
    const fileTab: WorkspaceTab = {
      kind: "file",
      id: "tab-file-pinned",
      label: "README.md",
      path: "/README.md",
      backendSessionId: "session-file-pinned",
      line: null,
      col: null,
      workspaceId: null,
      previewId: "preview-file-pinned",
      pinned: true,
    };

    renderSortableTab({ tab: fileTab, onClose });

    const tabElement = screen.getByRole("tab");
    fireEvent(tabElement, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("prevents default on mousedown with button 1 to suppress autoscroll", () => {
    const tab: WorkspaceTab = {
      id: "tab-mouse-test",
      label: "tab",
      sessionId: "session-mouse-test",
    } as WorkspaceTab;

    renderSortableTab({ tab });

    const tabElement = screen.getByRole("tab");
    const mousedownEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
    fireEvent(tabElement, mousedownEvent);

    expect(mousedownEvent.defaultPrevented).toBe(true);
  });

  it("renders expected data-file-icon attributes for different file extensions", () => {
    const cases = [
      { path: "/src/app.tsx", expectedKind: "code" },
      { path: "/data/table.csv", expectedKind: "table" },
      { path: "/notes/spec.md", expectedKind: "markdown" },
      { path: "/assets/clip.mp4", expectedKind: "video" },
      { path: "/audio/theme.mp3", expectedKind: "audio" },
      { path: "/docs/paper.pdf", expectedKind: "pdf" },
      { path: "/nb/analysis.ipynb", expectedKind: "notebook" },
      { path: "/docs/notes.txt", expectedKind: "text" },
    ];

    for (const { path, expectedKind } of cases) {
      const fileTab: WorkspaceTab = {
        kind: "file",
        id: `tab-${expectedKind}`,
        label: path.split("/").pop() ?? path,
        path,
        backendSessionId: `session-${expectedKind}`,
        line: null,
        col: null,
        workspaceId: null,
        previewId: `preview-${expectedKind}`,
      };

      const { unmount } = renderSortableTab({ tab: fileTab });
      const icon = screen.getByTestId("tab-file-icon");
      expect(icon).toHaveAttribute("data-file-icon", expectedKind);
      unmount();
    }
  });
});
