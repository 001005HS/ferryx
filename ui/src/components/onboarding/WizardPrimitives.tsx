import type { ReactNode } from "react";
import { AlertCircle, Check, Minus } from "lucide-react";

import { cn } from "../../lib/cn";

export type WizardStatusTone = "success" | "warning" | "neutral";

export type WizardStatusProps = {
  tone: WizardStatusTone;
  label: string;
};

const GLYPHS = {
  success: Check,
  warning: AlertCircle,
  neutral: Minus,
} as const;

const TONE_CLASSES: Record<WizardStatusTone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  neutral: "text-muted-foreground",
};

export function WizardStatus({ tone, label }: WizardStatusProps): JSX.Element {
  const Icon = GLYPHS[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        TONE_CLASSES[tone],
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export type WizardRowProps = {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
  testId?: string;
};

export function WizardRow({
  title,
  description,
  status,
  action,
  testId,
}: WizardRowProps): JSX.Element {
  return (
    <li
      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3"
      data-testid={testId}
    >
      <div className="min-w-0 sm:flex-1">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {status || action ? (
        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          {status ? <div className="shrink-0">{status}</div> : <span />}
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
    </li>
  );
}

export function WizardRowList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <ul
      className={cn(
        "divide-y divide-border/40 border-y border-border",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function Keycap({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="rounded border border-border bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}
