import { describe, expect, it } from "vitest";
import {
  createClosedTabStack,
  type ClosedBrowserTab,
  type ClosedFileTab,
} from "./closedTabStack";

describe("createClosedTabStack", () => {
  it("mixed order browser, file, browser pops in reverse", () => {
    const stack = createClosedTabStack();

    const browser1: ClosedBrowserTab = {
      kind: "browser",
      url: "https://example.com/1",
      profileId: "p1",
      worktreePath: "/path/1",
    };
    const file1: ClosedFileTab = {
      kind: "file",
      source: {
        leafId: "leaf-1",
        sessionId: "sess-1",
        backendSessionId: "backend-1",
        workspaceId: "ws-1",
      },
      request: {
        path: "src/file1.ts",
        backendSessionId: "backend-1",
        line: 10,
        col: 5,
      },
    };
    const browser2: ClosedBrowserTab = {
      kind: "browser",
      url: "https://example.com/2",
    };

    stack.push(browser1);
    stack.push(file1);
    stack.push(browser2);

    expect(stack.size()).toBe(3);
    expect(stack.pop()).toEqual(browser2);
    expect(stack.pop()).toEqual(file1);
    expect(stack.pop()).toEqual(browser1);
    expect(stack.pop()).toBeNull();
  });

  it("empty pop returns null", () => {
    const stack = createClosedTabStack();
    expect(stack.size()).toBe(0);
    expect(stack.pop()).toBeNull();
  });

  it("empty-url browser entry is skipped", () => {
    const stack = createClosedTabStack();

    const validBrowser: ClosedBrowserTab = {
      kind: "browser",
      url: "https://example.com",
    };
    const emptyUrlBrowser: ClosedBrowserTab = {
      kind: "browser",
      url: "",
    };
    const fileEntry: ClosedFileTab = {
      kind: "file",
      source: {
        leafId: "leaf-1",
        sessionId: "sess-1",
        backendSessionId: "backend-1",
        workspaceId: null,
      },
      request: {
        path: "README.md",
        backendSessionId: "backend-1",
        line: null,
        col: null,
      },
    };

    stack.push(validBrowser);
    stack.push(emptyUrlBrowser);
    stack.push(fileEntry);

    expect(stack.pop()).toEqual(fileEntry);
    expect(stack.pop()).toEqual(validBrowser);
    expect(stack.pop()).toBeNull();

    stack.push(emptyUrlBrowser);
    expect(stack.pop()).toBeNull();
  });

  it("limit drops oldest", () => {
    const stack = createClosedTabStack(2);

    const tab1: ClosedBrowserTab = { kind: "browser", url: "https://example.com/1" };
    const tab2: ClosedBrowserTab = { kind: "browser", url: "https://example.com/2" };
    const tab3: ClosedBrowserTab = { kind: "browser", url: "https://example.com/3" };

    stack.push(tab1);
    stack.push(tab2);
    expect(stack.size()).toBe(2);

    stack.push(tab3);
    expect(stack.size()).toBe(2);

    expect(stack.pop()).toEqual(tab3);
    expect(stack.pop()).toEqual(tab2);
    expect(stack.pop()).toBeNull();
  });

  it("file entry round-trips source/request unchanged", () => {
    const stack = createClosedTabStack();

    const fileTab: ClosedFileTab = {
      kind: "file",
      source: {
        leafId: "preview-leaf-99",
        sessionId: "preview-leaf-99",
        backendSessionId: "daemon-sess-xyz",
        workspaceId: "workspace-abc",
      },
      request: {
        path: "/absolute/path/to/file.tsx",
        backendSessionId: "daemon-sess-xyz",
        line: 123,
        col: 45,
      },
    };

    stack.push(fileTab);
    const popped = stack.pop();

    expect(popped).toEqual(fileTab);
    expect(popped).not.toBeNull();
    if (popped && popped.kind === "file") {
      expect(popped.source.leafId).toBe("preview-leaf-99");
      expect(popped.source.sessionId).toBe("preview-leaf-99");
      expect(popped.source.backendSessionId).toBe("daemon-sess-xyz");
      expect(popped.source.workspaceId).toBe("workspace-abc");
      expect(popped.request.path).toBe("/absolute/path/to/file.tsx");
      expect(popped.request.backendSessionId).toBe("daemon-sess-xyz");
      expect(popped.request.line).toBe(123);
      expect(popped.request.col).toBe(45);
    }
  });
});
