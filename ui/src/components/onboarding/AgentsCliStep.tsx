import { useEffect, useRef, useState } from "react";

import type { ResolvedAgent } from "../../lib/agentsSettings";
import { getCliLauncherStatus, installCliLauncher } from "../../lib/tauri";
import type { CliLauncherStatus } from "../../lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export type AgentsCliStepProps = {
  agents: ReadonlyArray<ResolvedAgent>;
  onOpenAgentSettings: () => void;
  loadCliStatus?: () => Promise<CliLauncherStatus>; // default getCliLauncherStatus
  installCli?: () => Promise<CliLauncherStatus>; // default installCliLauncher
};

const EMERALD_BADGE_CLASS = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
const INSTALL_FAILED_MESSAGE = "Installing the Ferryx CLI failed.";

export function AgentsCliStep(props: AgentsCliStepProps): JSX.Element {
  const { agents, onOpenAgentSettings } = props;

  const [cliStatus, setCliStatus] = useState<CliLauncherStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const loadCliStatusRef = useRef(props.loadCliStatus ?? getCliLauncherStatus);
  const installCli = props.installCli ?? installCliLauncher;

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    loadCliStatusRef.current().then(
      (status) => {
        if (!cancelled) setCliStatus(status);
      },
      () => {
        if (!cancelled) setCliStatus(null);
      }
    );

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  async function handleInstall(): Promise<void> {
    setInstalling(true);
    setInstallError(null);
    try {
      const next = await installCli();
      if (mountedRef.current) setCliStatus(next);
    } catch (err) {
      if (mountedRef.current) {
        setInstallError(err instanceof Error ? err.message : INSTALL_FAILED_MESSAGE);
      }
    } finally {
      if (mountedRef.current) setInstalling(false);
    }
  }

  const anyAgentAvailable = agents.some((agent) => agent.available);
  const cli = cliStatus;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Coding agents and CLI
        </h2>
      </div>

      <Card className="p-4 bg-card/60 border-border">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">Detected agents</span>
        </div>

        <ul className="mt-3 space-y-2">
          {agents.map((agent) => (
            <li
              key={agent.name}
              data-testid={`onboarding-agent-${agent.name}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm text-foreground">{agent.name}</span>
              {agent.available ? (
                <Badge variant="secondary" className={EMERALD_BADGE_CLASS}>
                  Found
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground border-border">
                  Not found
                </Badge>
              )}
            </li>
          ))}
        </ul>

        {!anyAgentAvailable ? (
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            No coding agents were found on your PATH. Install one (for example Claude Code or
            Codex), or register a custom command.
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            data-testid="onboarding-open-agent-settings"
            onClick={onOpenAgentSettings}
            className="gap-1.5 text-xs"
          >
            Agent settings
          </Button>
        </div>
      </Card>

      {cli && cli.isSupported ? (
        <Card className="p-4 bg-card/60 border-border">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground">Ferryx CLI</span>
            {cli.isInstalled ? (
              <Badge variant="secondary" className={EMERALD_BADGE_CLASS}>
                Installed
              </Badge>
            ) : null}
          </div>

          {cli.isInstalled ? (
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              {`Installed at ${cli.launcherPath}`}
            </p>
          ) : (
            <>
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  data-testid="onboarding-install-cli"
                  disabled={installing}
                  onClick={() => void handleInstall()}
                  className="gap-1.5 text-xs"
                >
                  Install CLI
                </Button>
              </div>
              {installError ? (
                <p role="alert" className="mt-2 text-xs text-amber-400">
                  {installError}
                </p>
              ) : null}
              <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
                {`Ferryx does not change your shell profile. Make sure the folder that contains ${cli.launcherPath} is on your PATH, then open a new terminal.`}
              </p>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
