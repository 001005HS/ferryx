import { useEffect, useRef, useState } from "react";

import { getCliLauncherStatus, installCliLauncher } from "../../lib/tauri";
import type { CliLauncherStatus } from "../../lib/types";
import { Button } from "../ui/button";
import {
  WizardRow,
  WizardRowList,
  WizardStatus,
} from "./WizardPrimitives";

export type CliStepProps = {
  loadCliStatus?: () => Promise<CliLauncherStatus>;
  installCli?: () => Promise<CliLauncherStatus>;
};

const INSTALL_FAILED_MESSAGE = "Installing the Ferryx CLI failed.";

const EXAMPLES: ReadonlyArray<{ command: string; description: string }> = [
  {
    command: "ferryx open src/main.rs:42",
    description: "Open a file in Ferryx, optionally at a line and column.",
  },
  {
    command: "ferryx browser list",
    description: "List built-in browser tabs; scripts and agents drive them with ferryx browser.",
  },
];

export function CliStep(props: CliStepProps): JSX.Element {
  const [cliStatus, setCliStatus] = useState<CliLauncherStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
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
        if (cancelled) return;
        setCliStatus(status);
        setLoaded(true);
      },
      () => {
        if (cancelled) return;
        setCliStatus(null);
        setLoaded(true);
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

  const cli = cliStatus;

  return (
    <div>
      <p className="mb-3 text-[13px] leading-relaxed text-foreground">
        The <code className="font-mono text-[12px]">ferryx</code> command lets you, your
        scripts, and your agents open files in Ferryx and drive its built-in browser from
        any terminal.
      </p>

      <ul className="mb-4 grid gap-2" aria-label="Examples">
        {EXAMPLES.map((example) => (
          <li key={example.command}>
            <code className="block rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
              {example.command}
            </code>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {example.description}
            </p>
          </li>
        ))}
      </ul>

      {!loaded ? null : cli && cli.isSupported ? (
        <>
          <WizardRowList>
            <WizardRow
              testId={cli.isInstalled ? "onboarding-cli-installed" : undefined}
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
        </>
      ) : (
        <p
          data-testid="onboarding-cli-unavailable"
          className="text-[12px] text-muted-foreground"
        >
          {cli
            ? "The command-line launcher can't be installed from here on this system. You can continue without it."
            : "The launcher status isn't available right now. You can install it later from Settings > General."}
        </p>
      )}
    </div>
  );
}
