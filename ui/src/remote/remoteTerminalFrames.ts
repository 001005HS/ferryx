export const REMOTE_TERMINAL_FRAME_PREFIX = "\x1b]777;ferryx;";
export const REMOTE_TERMINAL_FRAME_TERMINATOR = "\x07";
export const REMOTE_TERMINAL_HARD_RESET = "\x1bc";

export function decodeRemoteTerminalFrame(raw: string): { kind: string; payload: string } | null {
  if (!raw.startsWith(REMOTE_TERMINAL_FRAME_PREFIX)) return null;
  const terminatorIndex = raw.indexOf(
    REMOTE_TERMINAL_FRAME_TERMINATOR,
    REMOTE_TERMINAL_FRAME_PREFIX.length,
  );
  if (terminatorIndex < 0) return null;
  let metadata: { kind?: string };
  try {
    metadata = JSON.parse(raw.slice(REMOTE_TERMINAL_FRAME_PREFIX.length, terminatorIndex));
  } catch {
    return null;
  }
  let payload = raw.slice(terminatorIndex + REMOTE_TERMINAL_FRAME_TERMINATOR.length);
  if (payload.startsWith(REMOTE_TERMINAL_HARD_RESET)) {
    payload = payload.slice(REMOTE_TERMINAL_HARD_RESET.length);
  }
  return { kind: metadata.kind ?? "output", payload };
}

export function collapseRepeatedLines(text: string): string {
  const lines = text.split("\n");
  const ruleChars = /^[\u2500-\u257F\-_=]+$/;
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && ruleChars.test(trimmed)) continue;
    if (trimmed.length > 0 && result.length > 0 && result[result.length - 1].trim() === trimmed) continue;
    result.push(line);
  }
  return result.join("\n");
}

export function stripTerminalControlSequences(text: string): string {
  let working = text.replace(/\r\n/g, "\n");

  const lastDisplayErase = Math.max(
    working.lastIndexOf("\x1b[2J"),
    working.lastIndexOf("\x1b[J"),
  );
  if (lastDisplayErase >= 0) {
    const eraseMatch = working.slice(lastDisplayErase).match(/^\x1b\[(?:2J|J)/);
    const eraseLen = eraseMatch ? eraseMatch[0].length : 0;
    working = working.slice(lastDisplayErase + eraseLen);
  }

  const lines = working.split("\n").map((line) => {
    const lineEraseRegex = /\x1b\[(?:2K|K)/g;
    let match: RegExpExecArray | null;
    let lastMatchIndex = -1;
    let lastMatchLength = 0;
    while ((match = lineEraseRegex.exec(line)) !== null) {
      lastMatchIndex = match.index;
      lastMatchLength = match[0].length;
    }
    if (lastMatchIndex >= 0) {
      return line.slice(lastMatchIndex + lastMatchLength);
    }
    return line;
  });

  let out = lines.join("\n");
  out = out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  out = out.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  out = out.replace(/\x1b[^\x1b]/g, "");
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

  const processed = out
    .split("\n")
    .map((line) => {
      const lastCr = line.lastIndexOf("\r");
      return lastCr >= 0 ? line.slice(lastCr + 1) : line;
    })
    .join("\n");

  return collapseRepeatedLines(processed);
}

export function isUnrenderableTransportArtifact(text: string): boolean {
  const trimmed = text.trim();
  switch (trimmed) {
    case "[object Blob]":
    case "[object ArrayBuffer]":
    case "[object Uint8Array]":
    case "[object Object]":
    case "undefined":
    case "null":
    case "NaN":
      return true;
    default:
      return false;
  }
}

export function resolveChatDisplayText(raw: string, isTextFrame: boolean): string | null {
  if (raw.startsWith(REMOTE_TERMINAL_FRAME_PREFIX)) {
    const frame = decodeRemoteTerminalFrame(raw);
    if (!frame) return null;
    if (frame.kind === "replayGap") return null;
    if (frame.kind === "output" || frame.kind === "replay") {
      return stripTerminalControlSequences(frame.payload);
    }
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (parsed.type === "output" && typeof parsed.data === "string") {
        return stripTerminalControlSequences(parsed.data);
      }
      if (parsed.type === "agentTurn" || parsed.type === "toolOutput") {
        const content = parsed.content ?? parsed.output ?? "";
        return stripTerminalControlSequences(typeof content === "string" ? content : "");
      }
      return null;
    }
  } catch {
  }

  if (!isTextFrame) {
    return null;
  }

  return stripTerminalControlSequences(raw);
}

