import { describe, expect, it } from "vitest";
import {
  REMOTE_TERMINAL_FRAME_PREFIX,
  REMOTE_TERMINAL_FRAME_TERMINATOR,
  REMOTE_TERMINAL_HARD_RESET,
  collapseRepeatedLines,
  decodeRemoteTerminalFrame,
  isUnrenderableTransportArtifact,
  resolveChatDisplayText,
  stripTerminalControlSequences,
} from "./remoteTerminalFrames";

describe("decodeRemoteTerminalFrame", () => {
  it("decodes a real enveloped output frame to kind output with the exact payload", () => {
    const payload = "hello\r\nworld";
    const frame = `${REMOTE_TERMINAL_FRAME_PREFIX}${JSON.stringify({
      kind: "output",
      sequence: "42",
    })}${REMOTE_TERMINAL_FRAME_TERMINATOR}${payload}`;
    expect(decodeRemoteTerminalFrame(frame)).toEqual({ kind: "output", payload });
  });

  it("decodes a replayGap frame to kind replayGap", () => {
    const frame = `${REMOTE_TERMINAL_FRAME_PREFIX}${JSON.stringify({
      kind: "replayGap",
      requestedAfterSequence: "10",
      availableFromSequence: "20",
    })}${REMOTE_TERMINAL_FRAME_TERMINATOR}gap`;
    expect(decodeRemoteTerminalFrame(frame)?.kind).toBe("replayGap");
  });

  it("strips a hard reset carried before the payload", () => {
    const frame = `${REMOTE_TERMINAL_FRAME_PREFIX}${JSON.stringify({
      kind: "output",
    })}${REMOTE_TERMINAL_FRAME_TERMINATOR}${REMOTE_TERMINAL_HARD_RESET}content`;
    expect(decodeRemoteTerminalFrame(frame)).toEqual({ kind: "output", payload: "content" });
  });

  it("returns null for a malformed envelope with no terminator", () => {
    const frame = `${REMOTE_TERMINAL_FRAME_PREFIX}${JSON.stringify({ kind: "output" })}no-terminator`;
    expect(decodeRemoteTerminalFrame(frame)).toBeNull();
  });

  it("returns null for non-enveloped plain text", () => {
    expect(decodeRemoteTerminalFrame("plain text")).toBeNull();
  });
});

describe("stripTerminalControlSequences", () => {
  it("removes CSI color codes", () => {
    expect(stripTerminalControlSequences("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("removes an OSC title sequence", () => {
    expect(stripTerminalControlSequences("\x1b]0;My Title\x07hello")).toBe("hello");
  });

  it("collapses CRLF to LF", () => {
    expect(stripTerminalControlSequences("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("keeps only the post-CR segment of an in-place repaint", () => {
    expect(stripTerminalControlSequences("10%\r20%\r30%")).toBe("30%");
  });

  it("leaves plain prose intact", () => {
    expect(stripTerminalControlSequences("hello world")).toBe("hello world");
  });

  it("keeps only the new text for a line with ESC [ 2 K followed by new text", () => {
    expect(stripTerminalControlSequences("old text\x1b[2Knew text")).toBe("new text");
  });

  it("keeps only the content after ESC [ 2 J for a cleared screen chunk", () => {
    expect(stripTerminalControlSequences("stale text\x1b[2Jfresh text")).toBe("fresh text");
  });

  it("collapses three consecutive identical spinner lines to one", () => {
    const input = "── • Working (42s • esc to interrupt) ──────\n── • Working (42s • esc to interrupt) ──────\n── • Working (42s • esc to interrupt) ──────";
    expect(stripTerminalControlSequences(input)).toBe("── • Working (42s • esc to interrupt) ──────");
  });

  it("drops a line of only box-drawing rule characters and keeps lines with text", () => {
    const input = "──────\n── real text\n══════\n------\n______";
    expect(stripTerminalControlSequences(input)).toBe("── real text");
  });

  it("keeps non-consecutive duplicate lines separated by different content", () => {
    const input = "spinner line\ndifferent line\nspinner line";
    expect(stripTerminalControlSequences(input)).toBe("spinner line\ndifferent line\nspinner line");
  });
});

describe("collapseRepeatedLines", () => {
  it("collapses consecutive duplicate lines ignoring leading and trailing whitespace", () => {
    const input = "hello\n  hello  \nworld";
    expect(collapseRepeatedLines(input)).toBe("hello\nworld");
  });

  it("drops lines consisting only of box-drawing and rule characters", () => {
    const input = "───\ntext\n═══\n---\n___\n   \nfinal";
    expect(collapseRepeatedLines(input)).toBe("text\n   \nfinal");
  });
});

describe("resolveChatDisplayText", () => {
  it('returns null for {"type":"attached",...} with isTextFrame true', () => {
    const raw = JSON.stringify({
      type: "attached",
      target: { sessionId: "s1" },
      generation: 1,
      cols: 120,
      rows: 32,
      startSequence: 0,
      endSequence: 42,
      replayGap: null,
    });
    expect(resolveChatDisplayText(raw, true)).toBeNull();
  });

  it('returns null for {"type":"pong"} with isTextFrame true', () => {
    expect(resolveChatDisplayText(JSON.stringify({ type: "pong" }), true)).toBeNull();
  });

  it('returns null for {"type":"error","message":"x"} with isTextFrame true', () => {
    expect(resolveChatDisplayText(JSON.stringify({ type: "error", message: "x" }), true)).toBeNull();
  });

  it('returns null for {"type":"remoteStatus","state":"connected","generation":"1"} with isTextFrame true', () => {
    expect(
      resolveChatDisplayText(
        JSON.stringify({ type: "remoteStatus", state: "connected", generation: "1" }),
        true,
      ),
    ).toBeNull();
  });

  it('returns null for {"type":"unknownFutureShape","a":1} with isTextFrame true', () => {
    expect(
      resolveChatDisplayText(
        JSON.stringify({ type: "unknownFutureShape", a: 1 }),
        true,
      ),
    ).toBeNull();
  });

  it("returns stripped payload for a real OSC output frame", () => {
    const payload = "\x1b[32mhello world\x1b[0m";
    const frame = `${REMOTE_TERMINAL_FRAME_PREFIX}${JSON.stringify({
      kind: "output",
    })}${REMOTE_TERMINAL_FRAME_TERMINATOR}${payload}`;
    expect(resolveChatDisplayText(frame, false)).toBe("hello world");
  });

  it("returns null for a real OSC replayGap frame", () => {
    const frame = `${REMOTE_TERMINAL_FRAME_PREFIX}${JSON.stringify({
      kind: "replayGap",
      requestedAfterSequence: "10",
      availableFromSequence: "20",
    })}${REMOTE_TERMINAL_FRAME_TERMINATOR}gap`;
    expect(resolveChatDisplayText(frame, false)).toBeNull();
  });

  it('returns data text for {"type":"output","data":"hello"} with isTextFrame true', () => {
    expect(
      resolveChatDisplayText(JSON.stringify({ type: "output", data: "hello" }), true),
    ).toBe("hello");
  });

  it('returns stripped text for a plain non-JSON text frame "ls -la\\n" with isTextFrame true', () => {
    expect(resolveChatDisplayText("ls -la\n", true)).toBe("ls -la\n");
  });

  it("returns null for a binary non-envelope frame (isTextFrame false)", () => {
    expect(resolveChatDisplayText("random binary payload", false)).toBeNull();
  });
});

describe("isUnrenderableTransportArtifact", () => {
  it('returns true for "[object Blob]"', () => {
    expect(isUnrenderableTransportArtifact("[object Blob]")).toBe(true);
  });

  it('returns true for padded "  [object Blob]  "', () => {
    expect(isUnrenderableTransportArtifact("  [object Blob]  ")).toBe(true);
  });

  it('returns true for "[object Object]"', () => {
    expect(isUnrenderableTransportArtifact("[object Object]")).toBe(true);
  });

  it('returns true for "undefined"', () => {
    expect(isUnrenderableTransportArtifact("undefined")).toBe(true);
  });

  it('returns true for "null"', () => {
    expect(isUnrenderableTransportArtifact("null")).toBe(true);
  });

  it('returns false for "real terminal text"', () => {
    expect(isUnrenderableTransportArtifact("real terminal text")).toBe(false);
  });

  it('returns false for "ls -la"', () => {
    expect(isUnrenderableTransportArtifact("ls -la")).toBe(false);
  });
});


