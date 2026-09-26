import React from "react";
import {
  GitBranch,
  Play,
  HelpCircle,
  FileCode,
  Square,
  Terminal,
} from "lucide-react";
import { cn } from "../../lib/cn";

export interface QuickActionItem {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly icon?: React.ComponentType<{ className?: string }>;
  readonly isDestructive?: boolean;
}

export const DEFAULT_QUICK_ACTIONS: readonly QuickActionItem[] = [
  {
    id: "git-status",
    label: "Git status",
    prompt: "Show git status and summarize recent branch changes",
    icon: GitBranch,
  },
  {
    id: "run-tests",
    label: "Run tests",
    prompt: "Run project tests and diagnose any failures",
    icon: Play,
  },
  {
    id: "explain",
    label: "Explain",
    prompt: "Explain the code or system currently in focus",
    icon: HelpCircle,
  },
  {
    id: "review-diff",
    label: "Review diff",
    prompt: "Review uncommitted git diff for bugs, edge cases, and regressions",
    icon: FileCode,
  },
  {
    id: "stop",
    label: "Stop",
    prompt: "Stop current task execution",
    icon: Square,
    isDestructive: true,
  },
];

export interface MobileChatQuickActionsProps {
  readonly onSelectAction: (action: QuickActionItem) => void;
  readonly isRunning?: boolean;
  readonly actions?: readonly QuickActionItem[];
  readonly className?: string;
  readonly disabled?: boolean;
}

export const MobileChatQuickActions: React.FC<MobileChatQuickActionsProps> = ({
  onSelectAction,
  isRunning = false,
  actions = DEFAULT_QUICK_ACTIONS,
  className,
  disabled = false,
}) => {
  return (
    <div
      data-testid="mobile-chat-quick-actions"
      className={cn(
        "flex w-full items-center gap-1.5 overflow-x-auto py-1 px-2.5 no-scrollbar touch-pan-x select-none",
        className
      )}
    >
      {actions.map((action) => {
        const isStopAction = action.id === "stop" || action.isDestructive;
        const Icon = action.icon ?? (isStopAction ? Square : Terminal);

        return (
          <button
            key={action.id}
            type="button"
            data-testid={`quick-action-${action.id}`}
            disabled={disabled}
            onClick={() => onSelectAction(action)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50",
              isStopAction && isRunning
                ? "bg-[#ff6467]/15 text-[#ff6467] border border-[#ff6467]/30 hover:bg-[#ff6467]/25 active:bg-[#ff6467]/35"
                : isStopAction
                ? "bg-[#1a1b1b]/80 text-[#838383] border border-[#191919] hover:bg-[#1a1b1b] active:bg-[#141414]"
                : "bg-[#1a1b1b]/90 text-[#f5f5f5] border border-[#191919] hover:bg-[#141414] hover:text-[#f5f5f5] active:bg-[#111111]"
            )}
          >
            <Icon className={cn("size-3.5 shrink-0", isStopAction && isRunning ? "text-[#ff6467] animate-pulse" : "text-[#838383]")} />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
};
