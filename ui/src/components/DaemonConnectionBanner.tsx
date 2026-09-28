import { AlertCircle } from "lucide-react";

import { Button } from "./ui/button";

export type ProjectConnectionError = { code: string; message: string };

export function DaemonConnectionBanner(props: {
  error: ProjectConnectionError;
  onRetry: () => void;
}): JSX.Element {
  const { error, onRetry } = props;

  let title = "Couldn't open this project";
  let body = error.message;

  if (error.code === "DAEMON_UNAVAILABLE") {
    title = "Ferryx can't reach its background service";
    body =
      "Your saved tabs and panes are kept. Retry, or quit and reopen Ferryx if this keeps happening.";
  } else if (error.code === "DAEMON_PROTOCOL_MISMATCH") {
    title = "The background service is from a different Ferryx version";
    body =
      "Running terminals are kept. Quit and reopen Ferryx to finish the update.";
  }

  return (
    <div
      role="alert"
      data-testid="daemon-connection-banner"
      className="flex items-start gap-3 border-b border-border bg-card px-4 py-3"
    >
      <AlertCircle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-status-warning"
      />

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {body}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {error.code}
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 shrink-0 text-[11px]"
        data-testid="daemon-connection-retry"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}
