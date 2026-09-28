import { describe, expect, it } from "vitest";
import { stitchHardWrappedLine, type WrappedRow } from "./hardWrappedPath";

describe("stitchHardWrappedLine", () => {
  it("does not stitch when rows are shorter than cols", () => {
    const prev: WrappedRow = { text: "src/short/" };
    const current: WrappedRow = { text: "index.ts" };
    const next: WrappedRow = { text: ":42" };

    const result = stitchHardWrappedLine(prev, current, next, 3, 80);
    expect(result).toEqual({
      text: "index.ts",
      col: 3,
    });
  });

  it("stitches with next continuation when current row length >= cols and boundaries have no whitespace", () => {
    const current: WrappedRow = {
      text: "https://example.com/very/long/path/that/reaches/terminal/width/and/keeps/going/",
    };
    const next: WrappedRow = { text: "target_file.rs:120:5" };
    const cols = current.text.length;

    const result = stitchHardWrappedLine(null, current, next, 10, cols);
    expect(result).toEqual({
      text: `${current.text}${next.text}`,
      col: 10,
    });
  });

  it("stitches with prev continuation and shifts col by prev.text.length", () => {
    const prev: WrappedRow = {
      text: "src/components/extremely_long_directory_name_that_wraps_across_the_line/",
    };
    const current: WrappedRow = { text: "SubComponent.tsx:15" };
    const cols = prev.text.length;

    const result = stitchHardWrappedLine(prev, current, null, 4, cols);
    expect(result).toEqual({
      text: `${prev.text}${current.text}`,
      col: 4 + prev.text.length,
    });
  });

  it("stitches both prev and next continuation when both meet wrap criteria", () => {
    const prev: WrappedRow = {
      text: "https://git.example.internal/org/very_long_repo_name/blob/main/packages/core/",
    };
    const current: WrappedRow = {
      text: "src/subsystem/very_long_nested_path_that_is_also_wrapping_across_terminal/",
    };
    const next: WrappedRow = { text: "index.ts#L42" };
    const cols = 70;

    expect(prev.text.length).toBeGreaterThanOrEqual(cols);
    expect(current.text.length).toBeGreaterThanOrEqual(cols);

    const result = stitchHardWrappedLine(prev, current, next, 7, cols);
    expect(result).toEqual({
      text: `${prev.text}${current.text}${next.text}`,
      col: 7 + prev.text.length,
    });
  });

  it("does not stitch across whitespace boundary at end of prev row", () => {
    const prev: WrappedRow = {
      text: "cargo test --manifest-path src-tauri/Cargo.toml ".padEnd(80, " "),
    };
    const current: WrappedRow = { text: "some_file.rs" };

    const result = stitchHardWrappedLine(prev, current, null, 2, 80);
    expect(result).toEqual({
      text: "some_file.rs",
      col: 2,
    });
  });

  it("does not stitch across whitespace boundary at start of current row", () => {
    const prev: WrappedRow = { text: "a".repeat(80) };
    const current: WrappedRow = { text: " indented_continuation.ts" };

    const result = stitchHardWrappedLine(prev, current, null, 5, 80);
    expect(result).toEqual({
      text: current.text,
      col: 5,
    });
  });

  it("does not stitch across whitespace boundary at end of current row", () => {
    const current: WrappedRow = { text: "const x = 123; ".padEnd(80, " ") };
    const next: WrappedRow = { text: "next_line.ts" };

    const result = stitchHardWrappedLine(null, current, next, 0, 80);
    expect(result).toEqual({
      text: current.text,
      col: 0,
    });
  });

  it("does not stitch across whitespace boundary at start of next row", () => {
    const current: WrappedRow = { text: "a".repeat(80) };
    const next: WrappedRow = { text: " trailing_output" };

    const result = stitchHardWrappedLine(null, current, next, 10, 80);
    expect(result).toEqual({
      text: current.text,
      col: 10,
    });
  });

  it("handles null prev and next cleanly", () => {
    const current: WrappedRow = { text: "isolated_line.ts:1" };
    const result = stitchHardWrappedLine(null, current, null, 5, 80);
    expect(result).toEqual({
      text: "isolated_line.ts:1",
      col: 5,
    });
  });

  it("handles empty current or sibling rows without throwing", () => {
    const emptyRow: WrappedRow = { text: "" };
    const validRow: WrappedRow = { text: "valid_path.ts" };

    expect(stitchHardWrappedLine(emptyRow, validRow, null, 2, 80)).toEqual({
      text: "valid_path.ts",
      col: 2,
    });

    expect(stitchHardWrappedLine(null, validRow, emptyRow, 2, 80)).toEqual({
      text: "valid_path.ts",
      col: 2,
    });
  });
});
