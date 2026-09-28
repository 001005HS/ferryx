import { describe, expect, it } from "vitest";
import {
  isMacPlatform,
  isTerminalLinkActionClick,
  terminalLinkOpenHint,
} from "./terminalLinkHints";

describe("terminalLinkOpenHint", () => {
  it("returns Cmd+click hints for Mac platform", () => {
    expect(terminalLinkOpenHint("file", true)).toBe("Cmd+click to open file");
    expect(terminalLinkOpenHint("directory", true)).toBe("Cmd+click to reveal folder");
    expect(terminalLinkOpenHint("url", true)).toBe("Cmd+click to open link");
  });

  it("returns Ctrl+click hints for non-Mac platforms", () => {
    expect(terminalLinkOpenHint("file", false)).toBe("Ctrl+click to open file");
    expect(terminalLinkOpenHint("directory", false)).toBe("Ctrl+click to reveal folder");
    expect(terminalLinkOpenHint("url", false)).toBe("Ctrl+click to open link");
  });
});

describe("isMacPlatform", () => {
  it("identifies Mac and iOS platforms", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "MacPPC" })).toBe(true);
    expect(isMacPlatform({ platform: "iPhone" })).toBe(true);
    expect(isMacPlatform({ platform: "iPad" })).toBe(true);
  });

  it("identifies Mac from userAgent", () => {
    expect(
      isMacPlatform({
        platform: "",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      }),
    ).toBe(true);
    expect(
      isMacPlatform({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)",
      }),
    ).toBe(true);
    expect(
      isMacPlatform({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
      }),
    ).toBe(true);
  });

  it("returns false for non-Mac platforms and userAgents", () => {
    expect(isMacPlatform({ platform: "Win32", userAgent: "Windows NT 10.0" })).toBe(false);
    expect(isMacPlatform({ platform: "Linux x86_64", userAgent: "X11; Linux x86_64" })).toBe(false);
    expect(isMacPlatform({ platform: "", userAgent: "" })).toBe(false);
    expect(isMacPlatform({})).toBe(false);
  });

  it("falls back to globalThis.navigator when no argument is provided", () => {
    const result = isMacPlatform();
    expect(typeof result).toBe("boolean");
  });
});

describe("isTerminalLinkActionClick", () => {
  it("returns true for primary click with no modifiers", () => {
    expect(
      isTerminalLinkActionClick({
        button: 0,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(true);
  });

  it("returns false if button is not 0", () => {
    expect(
      isTerminalLinkActionClick({
        button: 1,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(false);
    expect(
      isTerminalLinkActionClick({
        button: 2,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(false);
  });

  it("returns false when altKey is pressed", () => {
    expect(
      isTerminalLinkActionClick({
        button: 0,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(false);
  });

  it("returns false when shiftKey is pressed", () => {
    expect(
      isTerminalLinkActionClick({
        button: 0,
        altKey: false,
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(false);
  });

  it("returns false when metaKey is pressed", () => {
    expect(
      isTerminalLinkActionClick({
        button: 0,
        altKey: false,
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBe(false);
  });

  it("returns false when ctrlKey is pressed", () => {
    expect(
      isTerminalLinkActionClick({
        button: 0,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe(false);
  });
});
