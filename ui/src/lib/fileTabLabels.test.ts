import { describe, expect, it } from "vitest";
import { disambiguateFileTabLabels } from "./fileTabLabels";

describe("disambiguateFileTabLabels", () => {
  it("returns an empty array for empty inputs", () => {
    expect(disambiguateFileTabLabels([])).toEqual([]);
  });

  it("returns basename for unique basenames", () => {
    const input = ["/a/src/index.ts", "/b/ui/app.tsx", "/c/x.md"];
    expect(disambiguateFileTabLabels(input)).toEqual(["index.ts", "app.tsx", "x.md"]);
  });

  it("disambiguates duplicate basenames with shortest trailing parent directory segments joined by slash", () => {
    const input = ["/a/src/index.ts", "/b/ui/index.ts", "/c/x.md"];
    expect(disambiguateFileTabLabels(input)).toEqual(["src/index.ts", "ui/index.ts", "x.md"]);
  });

  it("walks back multiple parent directory levels when immediate parents match", () => {
    const input = ["/r/a/b/index.ts", "/r/c/b/index.ts"];
    expect(disambiguateFileTabLabels(input)).toEqual(["a/b/index.ts", "c/b/index.ts"]);
  });

  it("handles Windows backslash separators and joins with slash", () => {
    const input = ["C:\\project\\src\\main.rs", "D:\\backup\\tests\\main.rs"];
    expect(disambiguateFileTabLabels(input)).toEqual(["src/main.rs", "tests/main.rs"]);
  });

  it("handles mixed slash and backslash separators", () => {
    const input = ["C:\\project/src\\index.ts", "/linux/repo/ui/index.ts"];
    expect(disambiguateFileTabLabels(input)).toEqual(["src/index.ts", "ui/index.ts"]);
  });

  it("assigns identical labels for identical paths", () => {
    const input = ["/repo/src/index.ts", "/repo/src/index.ts"];
    expect(disambiguateFileTabLabels(input)).toEqual(["index.ts", "index.ts"]);
  });

  it("disambiguates duplicates while giving identical paths the same disambiguated label", () => {
    const input = ["/a/src/index.ts", "/b/ui/index.ts", "/a/src/index.ts"];
    expect(disambiguateFileTabLabels(input)).toEqual(["src/index.ts", "ui/index.ts", "src/index.ts"]);
  });

  it("handles relative paths with and without dot prefixes", () => {
    const input = ["src/index.ts", "test/index.ts", "other.ts"];
    expect(disambiguateFileTabLabels(input)).toEqual(["src/index.ts", "test/index.ts", "other.ts"]);
  });
});
