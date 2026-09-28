export const CLI_OPEN_FILE_EVENT = "ferryx:cli-open-file";

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return undefined;
}

export function parseCliOpenFilePayload(
  p: unknown,
): { path: string; line?: number; col?: number } | null {
  if (!p || typeof p !== "object") {
    return null;
  }
  const candidate = p as Record<string, unknown>;
  if (typeof candidate.path !== "string" || candidate.path.trim().length === 0) {
    return null;
  }

  const line = parsePositiveInteger(candidate.line);
  const col = parsePositiveInteger(candidate.col);

  const result: { path: string; line?: number; col?: number } = {
    path: candidate.path,
  };
  if (line !== undefined) {
    result.line = line;
  }
  if (col !== undefined) {
    result.col = col;
  }
  return result;
}
