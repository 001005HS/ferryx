import { AlertTriangle } from "lucide-react";

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
      className="flex items-start justify-between gap-4 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-amber-100">{title}</div>
          <div className="text-xs text-amber-200/90">{body}</div>
          <div className="font-mono text-[11px] text-amber-300/70">
            {error.code}
          </div>
        </div>
      </div>
      <div className="shrink-0">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="daemon-connection-retry"
          className="border-amber-500/40 bg-amber-500/20 text-xs font-medium text-amber-100 hover:bg-amber-500/30 hover:text-amber-50"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    </div>
  );
}
