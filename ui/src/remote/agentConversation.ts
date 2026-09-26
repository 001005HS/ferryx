import { remoteApiUrl } from "./remoteClient";
import type { MobileChatMessageProps } from "./chat/MobileChatMessage";
import type { ToolCallCardProps, ToolStatus } from "./chat/MobileChatComponents";

export interface ConversationMessage {
  ordinal: number;
  role: string;
  text: string;
  id?: string | null;
  timestamp?: number | string | null;
  toolName?: string | null;
  command?: string | null;
  status?: string | null;
  durationMs?: number | null;
}

export function formatWorkedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function isToolRole(role: string): boolean {
  const normalized = role.toLowerCase().replace(/[-_]/g, "");
  return (
    normalized === "toolresult" ||
    normalized === "tooluse" ||
    normalized === "toolcall" ||
    normalized === "tool"
  );
}

export function extractToolName(item: ConversationMessage): string {
  if (item.toolName) return item.toolName;
  if (item.id) {
    const stripped = item.id.replace(/^(?:call_|tool_|tool-)/, "");
    const match = /^([a-zA-Z0-9_-]+?)(?:[-_]\d+)?$/.exec(stripped);
    if (match && match[1] && !/^\d+$/.test(match[1])) {
      return match[1];
    }
  }
  return "tool";
}

export function parseTimestamp(ts: unknown): number | null {
  if (typeof ts === "number") {
    return ts < 1e11 ? ts * 1000 : ts;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return parsed;
    const num = Number(ts);
    if (!Number.isNaN(num)) return num < 1e11 ? num * 1000 : num;
  }
  return null;
}

export interface MapConversationOptions {
  activeTurnStartedAt?: number | null;
  previousMessages?: MobileChatMessageProps[];
  turnDurationsMap?: Map<string, string>;
}

export function mapAgentConversation(
  items: ConversationMessage[],
  options?: MapConversationOptions,
): MobileChatMessageProps[] {
  const sorted = [...items].sort((a, b) => a.ordinal - b.ordinal);
  const mapped: MobileChatMessageProps[] = [];
  let pendingTools: ToolCallCardProps[] = [];
  let pendingTimestamps: number[] = [];
  let pendingToolStartOrdinal: number | null = null;

  const prevById = new Map<string, MobileChatMessageProps>();
  if (options?.previousMessages) {
    for (const msg of options.previousMessages) {
      prevById.set(msg.id, msg);
    }
  }

  function resolveDuration(
    assistantId: string,
    toolCalls: ToolCallCardProps[],
    timestamps: number[],
  ): string {
    if (options?.turnDurationsMap?.has(assistantId)) {
      return options.turnDurationsMap.get(assistantId)!;
    }
    const prevMsg = prevById.get(assistantId);
    if (prevMsg?.durationLabel) {
      return prevMsg.durationLabel;
    }
    const sumMs = toolCalls.reduce((acc, tc) => acc + (tc.durationMs ?? 0), 0);
    if (sumMs > 0) {
      const label = formatWorkedDuration(sumMs);
      options?.turnDurationsMap?.set(assistantId, label);
      return label;
    }
    if (timestamps.length >= 2) {
      const min = Math.min(...timestamps);
      const max = Math.max(...timestamps);
      const diff = Math.max(0, max - min);
      const label = formatWorkedDuration(diff);
      options?.turnDurationsMap?.set(assistantId, label);
      return label;
    }
    if (options?.activeTurnStartedAt) {
      const elapsed = Math.max(0, Date.now() - options.activeTurnStartedAt);
      return formatWorkedDuration(elapsed);
    }
    const label = formatWorkedDuration(0);
    options?.turnDurationsMap?.set(assistantId, label);
    return label;
  }

  for (const item of sorted) {
    if (item.role === "user") {
      if (pendingTools.length > 0) {
        const fallbackId = `assistant-${pendingToolStartOrdinal ?? (item.ordinal - 1)}`;
        const durationLabel = resolveDuration(fallbackId, pendingTools, pendingTimestamps);
        mapped.push({
          id: fallbackId,
          role: "assistant",
          content: "",
          toolCalls: pendingTools,
          durationLabel,
          timestamp: pendingTimestamps[pendingTimestamps.length - 1] ?? Date.now(),
        });
        pendingTools = [];
        pendingTimestamps = [];
        pendingToolStartOrdinal = null;
      }
      mapped.push({
        id: `user-${item.ordinal}`,
        role: "user",
        content: item.text,
        timestamp: parseTimestamp(item.timestamp) ?? Date.now(),
      });
      continue;
    }

    if (isToolRole(item.role)) {
      pendingTools.push({
        toolName: item.toolName || extractToolName(item),
        command: item.command || undefined,
        output: item.text,
        status: (item.status as ToolStatus) || "success",
        durationMs: item.durationMs ?? undefined,
        initiallyExpanded: true,
      });
      const ts = parseTimestamp(item.timestamp);
      if (ts !== null) pendingTimestamps.push(ts);
      if (pendingToolStartOrdinal === null) pendingToolStartOrdinal = item.ordinal;
      continue;
    }

    if (item.role === "assistant") {
      const hasProse = Boolean(item.text && item.text.trim().length > 0);
      const ts = parseTimestamp(item.timestamp);
      if (ts !== null) pendingTimestamps.push(ts);

      if (!hasProse) {
        // Drop empty/whitespace assistant records from creating bubbles
        continue;
      }

      const msgId = `assistant-${item.ordinal}`;
      const hasTools = pendingTools.length > 0;
      const durationLabel = hasTools
        ? resolveDuration(msgId, pendingTools, pendingTimestamps)
        : undefined;

      mapped.push({
        id: msgId,
        role: "assistant",
        content: item.text,
        ...(hasTools ? { toolCalls: pendingTools, durationLabel } : {}),
        timestamp: ts ?? Date.now(),
      });
      pendingTools = [];
      pendingTimestamps = [];
      pendingToolStartOrdinal = null;
      continue;
    }

    // Any other role (e.g. system)
    mapped.push({
      id: `system-${item.ordinal}`,
      role: "system",
      content: item.text,
      timestamp: parseTimestamp(item.timestamp) ?? Date.now(),
    });
  }

  if (pendingTools.length > 0) {
    const lastOrdinal = pendingToolStartOrdinal ?? sorted[sorted.length - 1].ordinal;
    const fallbackId = `assistant-${lastOrdinal}`;
    const durationLabel = resolveDuration(fallbackId, pendingTools, pendingTimestamps);
    mapped.push({
      id: fallbackId,
      role: "assistant",
      content: "",
      toolCalls: pendingTools,
      durationLabel,
      timestamp: pendingTimestamps[pendingTimestamps.length - 1] ?? Date.now(),
    });
  }

  return mapped;
}

export interface ConversationPage {
  sessionId: string;
  items: ConversationMessage[];
  nextCursor: number | null;
  partial: boolean;
  warnings: string[];
}

export class ConversationFetchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConversationFetchError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toMessage(raw: unknown): ConversationMessage {
  const entry = isRecord(raw) ? raw : {};
  const rawId = entry.id;
  let id: string | null | undefined;
  if (rawId === undefined) {
    id = undefined;
  } else if (typeof rawId === "string") {
    id = rawId;
  } else {
    id = null;
  }
  const timestamp =
    typeof entry.timestamp === "number" || typeof entry.timestamp === "string"
      ? entry.timestamp
      : undefined;
  return {
    ordinal: Number(entry.ordinal),
    role: String(entry.role),
    text: String(entry.text),
    ...(id !== undefined ? { id } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(typeof entry.toolName === "string" ? { toolName: entry.toolName } : {}),
    ...(typeof entry.command === "string" ? { command: entry.command } : {}),
    ...(typeof entry.status === "string" ? { status: entry.status } : {}),
    ...(typeof entry.durationMs === "number" ? { durationMs: entry.durationMs } : {}),
  };
}

function toPage(body: unknown): ConversationPage {
  if (!isRecord(body)) {
    throw new ConversationFetchError("MALFORMED_RESPONSE", "Agent history response body is not an object");
  }
  if (!Array.isArray(body.items)) {
    throw new ConversationFetchError("MALFORMED_RESPONSE", "Agent history response items is not an array");
  }
  if (typeof body.sessionId !== "string") {
    throw new ConversationFetchError("MALFORMED_RESPONSE", "Agent history response sessionId is not a string");
  }
  if (body.nextCursor !== null && typeof body.nextCursor !== "number") {
    throw new ConversationFetchError("MALFORMED_RESPONSE", "Agent history response nextCursor is not a number or null");
  }
  if (typeof body.partial !== "boolean") {
    throw new ConversationFetchError("MALFORMED_RESPONSE", "Agent history response partial is not a boolean");
  }
  if (!Array.isArray(body.warnings) || !body.warnings.every((warning) => typeof warning === "string")) {
    throw new ConversationFetchError("MALFORMED_RESPONSE", "Agent history response warnings is not a string array");
  }
  return {
    sessionId: body.sessionId,
    items: body.items.map(toMessage),
    nextCursor: body.nextCursor,
    partial: body.partial,
    warnings: body.warnings,
  };
}

export async function fetchAgentConversation(args: {
  baseUrl: string;
  sessionId: string;
  token: string;
  limit?: number;
  cursor?: number | null;
  signal?: AbortSignal;
}): Promise<ConversationPage> {
  const { baseUrl, sessionId, token, cursor, signal } = args;
  const limit = args.limit ?? 200;
  let path = `/api/v1/agent-history/${encodeURIComponent(sessionId)}?limit=${limit}`;
  if (typeof cursor === "number") {
    path += `&cursor=${cursor}`;
  }
  let response: Response;
  try {
    response = await fetch(remoteApiUrl(baseUrl, path), {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ConversationFetchError("NETWORK_ERROR", error instanceof Error ? error.message : String(error));
  }
  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ConversationFetchError("MALFORMED_RESPONSE", "Agent history response body is not valid JSON");
    }
    return toPage(body);
  }
  let errorCode: string | null = null;
  try {
    const text = await response.text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && typeof parsed.error === "string") {
        errorCode = parsed.error;
      }
    } catch {}
  } catch {}
  if (errorCode !== null) {
    throw new ConversationFetchError(errorCode, `Agent history request failed with status ${response.status}`);
  }
  if (response.status === 404) {
    throw new ConversationFetchError("TRANSCRIPT_NOT_FOUND", `Agent history transcript not found for session ${sessionId}`);
  }
  if (response.status === 400) {
    throw new ConversationFetchError("INVALID_SESSION_ID", `Invalid agent history session id ${sessionId}`);
  }
  throw new ConversationFetchError("REQUEST_FAILED", `Agent history request failed with status ${response.status}`);
}