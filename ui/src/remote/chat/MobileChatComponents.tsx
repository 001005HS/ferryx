import React, { useState } from "react";
import {
  Check,
  Terminal,
  AlertCircle,
  Loader2,
  FileText,
  Eye,
  SquarePen,
  Search,
  Globe,
  Sparkles,
  ListChecks,
  Wrench,
  Brain,
  MessageSquare,
} from "lucide-react";
import { cn } from "../../lib/cn";

export type ActivityState = "thinking" | "running_tool" | "waiting_for_input" | "idle";

export interface ActivityIndicatorProps {
  state: ActivityState;
  label?: string;
  className?: string;
}

export const ActivityIndicator: React.FC<ActivityIndicatorProps> = ({
  state,
  label,
  className,
}) => {
  if (state === "idle") return null;

  const config = {
    thinking: {
      text: label || "Thinking...",
      textColor: "text-amber-300/90",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      dotColor: "bg-amber-400",
      icon: Loader2,
      spin: true,
    },
    running_tool: {
      text: label || "Running tool...",
      textColor: "text-sky-300/90",
      bgColor: "bg-sky-500/10",
      borderColor: "border-sky-500/20",
      dotColor: "bg-sky-400",
      icon: Terminal,
      spin: false,
    },
    waiting_for_input: {
      text: label || "Waiting for input...",
      textColor: "text-emerald-300/90",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      dotColor: "bg-emerald-400",
      icon: AlertCircle,
      spin: false,
    },
  }[state];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-sm shadow-xs transition-colors",
        config.bgColor,
        config.borderColor,
        config.textColor,
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            config.dotColor
          )}
        />
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            config.dotColor
          )}
        />
      </span>
      <Icon
        className={cn("w-3.5 h-3.5", config.spin && "animate-spin")}
      />
      <span className="tracking-wide">{config.text}</span>
    </div>
  );
};

export interface ChatAttachment {
  id: string;
  name: string;
  type: "image" | "file";
  url?: string;
  size?: string;
}

export interface AttachmentListProps {
  attachments: ChatAttachment[];
  className?: string;
}

export const AttachmentList: React.FC<AttachmentListProps> = ({
  attachments,
  className,
}) => {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2 pt-1.5", className)}>
      {attachments.map((att) => {
        if (att.type === "image" && att.url) {
          return (
            <div
              key={att.id}
              className="group relative overflow-hidden rounded-lg border border-white/10 bg-[#111111]/60 shadow-xs max-w-[200px]"
            >
              <img
                src={att.url}
                alt={att.name}
                className="h-28 w-auto object-cover transition-transform duration-200 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-1 px-1.5 text-[10px] text-[#838383] truncate">
                {att.name}
              </div>
            </div>
          );
        }

        return (
          <div
            key={att.id}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#111111]/60 px-2.5 py-1.5 text-xs text-[#838383] shadow-xs backdrop-blur-sm"
          >
            <FileText className="w-3.5 h-3.5 text-[#838383] shrink-0" />
            <span className="truncate max-w-[140px] font-medium">{att.name}</span>
            {att.size && (
              <span className="text-[10px] text-[#818181] font-mono">
                {att.size}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export type ToolStatus = "running" | "success" | "error";

export interface ToolCallCardProps {
  kind?: "tool";
  toolName: string;
  /** The call's own one-line description, shown next to the tool name. */
  summary?: string;
  command?: string;
  output?: string;
  status?: "running" | "success" | "error";
  durationMs?: number;
  className?: string;
  workKey?: string;
}

export function getToolIcon(toolName: string) {
  const lower = (toolName || "").toLowerCase();
  if (["bash", "cmd", "eval", "shell", "exec"].includes(lower)) return Terminal;
  if (["read", "view", "cat", "look_at"].includes(lower)) return Eye;
  if (["edit", "write", "apply_patch", "ast_grep_replace"].includes(lower)) return SquarePen;
  if (
    ["grep", "glob", "search", "find", "ast_grep_search"].includes(lower) ||
    lower.startsWith("lsp_")
  )
    return Search;
  if (lower.startsWith("web") || lower === "fetch" || lower === "browser") return Globe;
  if (lower === "task" || lower.startsWith("agent") || lower === "workpool") return Sparkles;
  if (lower === "todo") return ListChecks;
  return Wrench;
}

export function getToolVerb(toolName: string): string {
  const lower = (toolName || "").toLowerCase();
  if (["read", "view", "cat", "look_at"].includes(lower)) return "Read";
  if (["edit", "write", "apply_patch", "ast_grep_replace"].includes(lower)) return "Edited";
  if (
    ["grep", "glob", "search", "find", "ast_grep_search"].includes(lower) ||
    lower.startsWith("lsp_")
  )
    return "Searched";
  if (lower.startsWith("web") || lower === "fetch" || lower === "browser") return "Fetched";
  if (lower === "todo") return "Updated todos";
  return `Ran ${toolName || "tool"}`;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  summary,
  command,
  output,
  status = "success",
  className,
  workKey: _workKey,
}) => {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(command || output);
  const isError = status === "error";
  const isRunning = status === "running";

  const Icon = getToolIcon(toolName);
  const verb = getToolVerb(toolName);
  const firstLine = command ? command.trim().split("\n")[0] : "";

  const rowContent = (
    <>
      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
        <Icon
          aria-hidden="true"
          className={cn("w-3.5 h-3.5", isError ? "text-[#ff6467]" : "text-[#838383]")}
          style={{ width: "14px", height: "14px" }}
        />
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 truncate text-sm leading-none",
          isError ? "text-[#ff6467]" : "text-[#838383]",
          isRunning && "work-shimmer-text"
        )}
      >
        {summary ? (
          <span>{summary}</span>
        ) : (
          <>
            <span>{verb}</span>
            {firstLine && (
              <>
                {" "}
                <span className="font-mono">{firstLine}</span>
              </>
            )}
          </>
        )}
      </div>
      {status === "error" && <span className="sr-only">Failed</span>}
      {status === "running" && <span className="sr-only">Running</span>}
    </>
  );

  return (
    <div className={cn("w-full", className)}>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="work-row"
          onClick={() => setExpanded((prev) => !prev)}
          className={cn(
            "w-full min-h-[32px] flex items-center gap-1.5 px-1 py-0.5 text-left rounded hover:bg-white/[0.04] transition-colors group",
            isError ? "text-[#ff6467]" : "text-[#838383]"
          )}
        >
          {rowContent}
        </button>
      ) : (
        <div
          data-testid="work-row"
          className={cn(
            "w-full min-h-[32px] flex items-center gap-1.5 px-1 py-0.5 text-left rounded transition-colors group",
            isError ? "text-[#ff6467]" : "text-[#838383]"
          )}
        >
          {rowContent}
        </div>
      )}

      {canExpand && expanded && (
        <div className="ml-7 border-l border-[#191919] pl-3 py-1 space-y-1.5">
          {command && (
            <pre
              data-testid="tool-call-input"
              tabIndex={0}
              className="font-mono text-[12px] text-[#838383] whitespace-pre-wrap break-words max-h-60 overflow-y-auto select-text"
            >
              {command}
            </pre>
          )}
          {output && (
            <pre
              data-testid="work-row-output"
              tabIndex={0}
              className="font-mono text-[12px] text-[#838383] whitespace-pre-wrap break-words max-h-60 overflow-y-auto select-text"
            >
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export interface ThinkingBlockProps {
  kind: "thinking";
  text: string;
  source?: "prose";
  workKey?: string;
}

/** One entry in a turn's work disclosure: a tool call or a stretch of reasoning. */
export type ChatWorkItem = ToolCallCardProps | ThinkingBlockProps;

export const ThinkingBlock: React.FC<{ text: string; source?: "prose" }> = ({
  text,
  source,
}) => {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text ? text.trim() : "";
  const firstLine = trimmed ? trimmed.split("\n")[0] : "";
  const canExpand = trimmed.length > 0;
  const isProse = source === "prose";
  const Icon = isProse ? MessageSquare : Brain;

  const rowContent = (
    <>
      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
        <Icon
          aria-hidden="true"
          className="w-3.5 h-3.5 text-[#838383]"
          style={{ width: "14px", height: "14px" }}
        />
      </div>
      <div className="min-w-0 flex-1 truncate text-sm text-[#838383] leading-none">
        {isProse ? (
          <>
            <span className="sr-only">Message: </span>
            {firstLine && <span className="italic opacity-80">{firstLine}</span>}
          </>
        ) : (
          <>
            <span className="font-medium">Thinking</span>
            {firstLine && (
              <>
                {" "}
                <span className="italic opacity-80">{firstLine}</span>
              </>
            )}
          </>
        )}
      </div>
    </>
  );

  return (
    <div data-testid="thinking-block" className="w-full">
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="work-row"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full min-h-[32px] flex items-center gap-1.5 px-1 py-0.5 text-left rounded hover:bg-white/[0.04] transition-colors group text-[#838383]"
        >
          {rowContent}
        </button>
      ) : (
        <div
          data-testid="work-row"
          className="w-full min-h-[32px] flex items-center gap-1.5 px-1 py-0.5 text-left rounded transition-colors group text-[#838383]"
        >
          {rowContent}
        </div>
      )}

      {canExpand && expanded && (
        <div className="ml-7 border-l border-[#191919] pl-3 py-1">
          <p
            tabIndex={0}
            className="font-sans text-[12px] text-[#838383] italic whitespace-pre-wrap break-words max-h-60 overflow-y-auto select-text"
          >
            {text}
          </p>
        </div>
      )}
    </div>
  );
};

export interface ApprovalActionCardProps {
  title?: string;
  description: string;
  confirmLabel?: string;
  declineLabel?: string;
  allowCustomFeedback?: boolean;
  feedbackPlaceholder?: string;
  onAccept: (feedback?: string) => void;
  onDecline: (feedback?: string) => void;
  isSubmitting?: boolean;
  className?: string;
}

export const ApprovalActionCard: React.FC<ApprovalActionCardProps> = ({
  title = "Action Required",
  description,
  confirmLabel = "Approve",
  declineLabel = "Decline",
  allowCustomFeedback = true,
  feedbackPlaceholder = "Add instructions or reason...",
  onAccept,
  onDecline,
  isSubmitting = false,
  className,
}) => {
  const [feedback, setFeedback] = useState("");
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);

  const handleConfirm = () => {
    onAccept(feedback.trim() ? feedback.trim() : undefined);
  };

  const handleDecline = () => {
    onDecline(feedback.trim() ? feedback.trim() : undefined);
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-amber-500/30 bg-[#111111]/90 shadow-md p-3.5 backdrop-blur-md my-2.5 space-y-3",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="p-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0 mt-0.5">
          <AlertCircle className="w-4 h-4" />
        </div>
        <div className="space-y-0.5 min-w-0 flex-1">
          <h4 className="text-xs font-semibold text-[#f5f5f5] tracking-tight">
            {title}
          </h4>
          <p className="text-xs text-[#838383] leading-relaxed break-words">
            {description}
          </p>
        </div>
      </div>

      {allowCustomFeedback && showFeedbackInput && (
        <div className="relative">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={feedbackPlaceholder}
            rows={2}
            disabled={isSubmitting}
            className="w-full rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs text-[#f5f5f5] placeholder-[#818181] focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-all resize-none"
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
        <div>
          {allowCustomFeedback && !showFeedbackInput && (
            <button
              type="button"
              onClick={() => setShowFeedbackInput(true)}
              className="text-[11px] text-[#838383] hover:text-[#f5f5f5] underline decoration-[#818181] underline-offset-2 transition-colors"
            >
              Add note...
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDecline}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded-lg border border-white/10 bg-[#1a1b1b] hover:bg-[#141414] active:bg-[#1a1b1b] text-xs font-medium text-[#838383] hover:text-[#f5f5f5] transition-all disabled:opacity-50"
          >
            {declineLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/20 text-xs font-medium text-amber-200 hover:text-white shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
