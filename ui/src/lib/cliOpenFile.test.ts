import { describe, expect, it } from "vitest";

import { CLI_OPEN_FILE_EVENT, parseCliOpenFilePayload } from "./cliOpenFile";

describe("cliOpenFile", () => {
  it("exports CLI_OPEN_FILE_EVENT constant", () => {
    expect(CLI_OPEN_FILE_EVENT).toBe("ferryx:cli-open-file");
  });

  describe("parseCliOpenFilePayload", () => {
    it("parses valid payload with positive line and col", () => {
      const result = parseCliOpenFilePayload({
        path: "/path/to/file.rs",
        line: 42,
        col: 10,
      });
      expect(result).toEqual({
        path: "/path/to/file.rs",
        line: 42,
        col: 10,
      });
    });

    it("parses valid payload without line and col", () => {
      const result = parseCliOpenFilePayload({
        path: "src/main.rs",
      });
      expect(result).toEqual({
        path: "src/main.rs",
      });
    });

    it("returns null when path is missing, empty, or not a string", () => {
      expect(parseCliOpenFilePayload(null)).toBeNull();
      expect(parseCliOpenFilePayload(undefined)).toBeNull();
      expect(parseCliOpenFilePayload("not-an-object")).toBeNull();
      expect(parseCliOpenFilePayload(123)).toBeNull();
      expect(parseCliOpenFilePayload({})).toBeNull();
      expect(parseCliOpenFilePayload({ path: "" })).toBeNull();
      expect(parseCliOpenFilePayload({ path: "   " })).toBeNull();
      expect(parseCliOpenFilePayload({ path: 123 })).toBeNull();
      expect(parseCliOpenFilePayload({ line: 10, col: 5 })).toBeNull();
    });

    it("ignores bad line values (zero, negative, non-integer, string, NaN)", () => {
      expect(parseCliOpenFilePayload({ path: "foo.txt", line: 0 })).toEqual({
        path: "foo.txt",
      });
      expect(parseCliOpenFilePayload({ path: "foo.txt", line: -5 })).toEqual({
        path: "foo.txt",
      });
      expect(parseCliOpenFilePayload({ path: "foo.txt", line: 3.14 })).toEqual({
        path: "foo.txt",
      });
      expect(parseCliOpenFilePayload({ path: "foo.txt", line: "42" })).toEqual({
        path: "foo.txt",
      });
      expect(parseCliOpenFilePayload({ path: "foo.txt", line: NaN })).toEqual({
        path: "foo.txt",
      });
      expect(parseCliOpenFilePayload({ path: "foo.txt", line: Infinity })).toEqual({
        path: "foo.txt",
      });
    });

    it("handles null line and null col", () => {
      expect(
        parseCliOpenFilePayload({
          path: "foo.txt",
          line: null,
          col: null,
        }),
      ).toEqual({
        path: "foo.txt",
      });
    });

    it("parses valid col when line is null or bad", () => {
      expect(
        parseCliOpenFilePayload({
          path: "foo.txt",
          line: null,
          col: 15,
        }),
      ).toEqual({
        path: "foo.txt",
        col: 15,
      });
    });
  });
});
