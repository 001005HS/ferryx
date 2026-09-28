import { describe, expect, it } from "vitest";

import { resolveMarkdownDocumentPath } from "./markdownDocLink";

describe("resolveMarkdownDocumentPath", () => {
  it("resolves sibling documents in the same directory", () => {
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "b.md")).toBe("/repo/docs/b.md");
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "./b.md")).toBe("/repo/docs/b.md");
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "sub/b.md")).toBe("/repo/docs/sub/b.md");
  });

  it("resolves parent documents using ../ traversal", () => {
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "../b.md")).toBe("/repo/b.md");
    expect(resolveMarkdownDocumentPath("/repo/docs/sub/a.md", "../../b.md")).toBe("/repo/b.md");
    expect(resolveMarkdownDocumentPath("/repo/a.md", "../../../b.md")).toBe("/b.md");
  });

  it("strips fragments and query parameters from relative links", () => {
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "b.md#section-title")).toBe("/repo/docs/b.md");
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "b.md?v=123")).toBe("/repo/docs/b.md");
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "b.md?v=123#section-title")).toBe("/repo/docs/b.md");
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "b.md#section-title?v=123")).toBe("/repo/docs/b.md");
    expect(resolveMarkdownDocumentPath("/repo/docs/a.md", "../b.md#section-title")).toBe("/repo/b.md");
  });

  it("resolves Windows paths with backslash separators", () => {
    expect(resolveMarkdownDocumentPath("C:\\repo\\docs\\a.md", "b.md")).toBe("C:\\repo\\docs\\b.md");
    expect(resolveMarkdownDocumentPath("C:\\repo\\docs\\a.md", "../b.md")).toBe("C:\\repo\\b.md");
    expect(resolveMarkdownDocumentPath("C:\\repo\\docs\\a.md", "..\\b.md")).toBe("C:\\repo\\b.md");
    expect(resolveMarkdownDocumentPath("C:\\repo\\docs\\a.md", "b.md#heading")).toBe("C:\\repo\\docs\\b.md");
    expect(resolveMarkdownDocumentPath("C:\\a.md", "b.md")).toBe("C:\\b.md");
  });
});
