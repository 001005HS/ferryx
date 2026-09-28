import { useEffect, useRef, useState } from "react";
import { Check, TerminalSquare } from "lucide-react";

import {
  isMonochromeAgentLogoByCommandName,
  resolveAgentLogoByCommandName,
} from "../../lib/agentIcon";
import {
  loadAgentSettings,
  saveAgentSettings,
  type ResolvedAgent,
} from "../../lib/agentsSettings";
import { getCliLauncherStatus, installCliLauncher } from "../../lib/tauri";
import type { CliLauncherStatus } from "../../lib/types";
import { Button } from "../ui/button";
import {
  WizardRow,
  WizardRowList,
  WizardStatus,
} from "./WizardPrimitives";

export type AgentsCliStepProps = {
  agents: ReadonlyArray<ResolvedAgent>;
  onOpenAgentSettings: () => void;
  loadCliStatus?: () => Promise<CliLauncherStatus>;
  installCli?: () => Promise<CliLauncherStatus>;
};

const INSTALL_FAILED_MESSAGE = "Installing the Ferryx CLI failed.";

const AUTO_VALUE = "__auto__";

const OPTION_CLASS =
  "flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type AgentOption = {
  value: string | null;
  label: string;
  description?: string;
  agent?: ResolvedAgent;
};

function AgentBrandIcon({ name }: { name: string }): JSX.Element {
  const logo = resolveAgentLogoByCommandName(name);
  if (!logo) {
    return (
      <TerminalSquare
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    );
  }
  const monochrome = isMonochromeAgentLogoByCommandName(name);
  return (
    <img
      src={logo}
      alt=""
      aria-hidden="true"
      className={`size-4 shrink-0${monochrome ? " agent-tab-logo--monochrome" : ""}`}
    />
  );
}

export function AgentsCliStep(props: AgentsCliStepProps): JSX.Element {
  const { agents, onOpenAgentSettings } = props;

  const [cliStatus, setCliStatus] = useState<CliLauncherStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(
    () => loadAgentSettings().defaultAgentId,
  );

  const mountedRef = useRef(true);
  const loadCliStatusRef = useRef(props.loadCliStatus ?? getCliLauncherStatus);
  const groupRef = useRef<HTMLDivElement>(null);
  const installCli = props.installCli ?? installCliLauncher;

  const availableAgents = agents.filter((agent) => agent.available);
  const unavailableNames = agents
    .filter((agent) => !agent.available)
    .map((agent) => agent.name);

  const options: AgentOption[] = [
    {
      value: null,
      label: "Auto",
      description: "Use the first available agent.",
    },
    ...availableAgents.map((agent) => ({
      value: agent.name,
      label: agent.name,
      agent,
    })),
  ];

  const selectedIndex = options.findIndex(
    (option) => option.value === defaultAgentId,
  );
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    loadCliStatusRef.current().then(
      (status) => {
        if (!cancelled) setCliStatus(status);
      },
      () => {
        if (!cancelled) setCliStatus(null);
      },
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
        setInstallError(
          err instanceof Error ? err.message : INSTALL_FAILED_MESSAGE,
        );
      }
    } finally {
      if (mountedRef.current) setInstalling(false);
    }
  }

  function selectOption(value: string | null): void {
    setDefaultAgentId(value);
    const settings = loadAgentSettings();
    saveAgentSettings({ ...settings, defaultAgentId: value });
  }

  function handleOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const radios = groupRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    if (!radios || radios.length === 0) return;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + delta + radios.length) % radios.length;
    radios[nextIndex].focus();
    selectOption(options[nextIndex].value);
  }

  const cli = cliStatus;

  return (
    <div>
      {availableAgents.length > 0 ? (
        <>
          <div
            ref={groupRef}
            role="radiogroup"
            aria-label="Default agent"
            className="grid gap-1"
          >
            {options.map((option, index) => {
              const checked = option.value === defaultAgentId;
              return (
                <button
                  key={option.value ?? AUTO_VALUE}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={index === focusIndex ? 0 : -1}
                  data-testid={
                    option.agent
                      ? `onboarding-agent-${option.agent.name}`
                      : undefined
                  }
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  onClick={() => selectOption(option.value)}
                  className={`${OPTION_CLASS}${checked ? " bg-accent" : ""}`}
                >
                  {option.agent ? (
                    <AgentBrandIcon name={option.agent.name} />
                  ) : (
                    <div className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground">
                      {option.label}
                    </div>
                    <div
                      className={
                        option.agent
                          ? "mt-0.5 font-mono text-[11px] text-muted-foreground"
                          : "mt-0.5 text-[12px] leading-relaxed text-muted-foreground"
                      }
                    >
                      {option.agent ? option.agent.command : option.description}
                    </div>
                  </div>
                  {checked ? (
                    <Check
                      aria-hidden="true"
                      className="ml-auto size-4 shrink-0 text-status-success"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          {unavailableNames.length > 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {`Not installed: ${unavailableNames.join(", ")}`}
            </p>
          ) : null}
        </>
      ) : (
        <WizardRowList>
          <WizardRow
            title="No coding agents found on your PATH."
            description="Install one (for example Claude Code or Codex), or add a custom command in Settings > Agents."
          />
        </WizardRowList>
      )}

      <div className="mt-3">
        <Button
          variant="link"
          size="sm"
          data-testid="onboarding-open-agent-settings"
          onClick={onOpenAgentSettings}
          className="h-auto p-0 text-[12px] text-foreground hover:underline"
        >
          Agent settings
        </Button>
      </div>

      {cli && cli.isSupported ? (
        <div className="mt-6">
          <div className="text-[11px] font-medium text-muted-foreground mb-2">
            Command-line launcher
          </div>

          <WizardRowList>
            <WizardRow
              title="Ferryx CLI"
              description={
                cli.isInstalled
                  ? `Installed at ${cli.launcherPath}`
                  : `Ferryx does not change your shell profile. Make sure the folder that contains ${cli.launcherPath} is on your PATH, then open a new terminal.`
              }
              status={
                cli.isInstalled ? (
                  <WizardStatus tone="success" label="Installed" />
                ) : (
                  <WizardStatus tone="neutral" label="Not installed" />
                )
              }
              action={
                !cli.isInstalled ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 text-[11px]"
                    data-testid="onboarding-install-cli"
                    disabled={installing}
                    onClick={() => void handleInstall()}
                  >
                    {installing ? "Installing…" : "Install CLI"}
                  </Button>
                ) : null
              }
            />
          </WizardRowList>

          {installError ? (
            <p role="alert" className="mt-2 text-[12px] text-status-warning">
              {installError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
