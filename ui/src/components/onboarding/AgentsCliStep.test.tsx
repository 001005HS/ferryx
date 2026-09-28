import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedAgent } from "../../lib/agentsSettings";
import type { CliLauncherStatus } from "../../lib/types";
import { AgentsCliStep, type AgentsCliStepProps } from "./AgentsCliStep";

const mockTauri = vi.hoisted(() => ({
  getCliLauncherStatus: vi.fn(),
  installCliLauncher: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  getCliLauncherStatus: () => mockTauri.getCliLauncherStatus(),
  installCliLauncher: () => mockTauri.installCliLauncher(),
}));

const EMPTY_AGENT_COPY =
  "No coding agents were found on your PATH. Install one (for example Claude Code or Codex), or register a custom command.";

function agent(name: string, available: boolean): ResolvedAgent {
  return { name, available, enabled: true, command: name, args: "", custom: false };
}

const installedStatus: CliLauncherStatus = {
  launcherPath: "/usr/local/bin/ferryx",
  isInstalled: true,
  isSymlink: false,
  currentTarget: null,
  activeExecutable: "/Applications/Ferryx.app/Contents/MacOS/ferryx",
  isSupported: true,
};

const notInstalledStatus: CliLauncherStatus = {
  launcherPath: "/usr/local/bin/ferryx",
  isInstalled: false,
  isSymlink: false,
  currentTarget: null,
  activeExecutable: null,
  isSupported: true,
};

const unsupportedStatus: CliLauncherStatus = {
  ...notInstalledStatus,
  isSupported: false,
};

function renderStep(overrides: Partial<AgentsCliStepProps> = {}) {
  return render(
    <AgentsCliStep
      agents={[agent("claude", true)]}
      onOpenAgentSettings={vi.fn()}
      loadCliStatus={() => Promise.resolve(notInstalledStatus)}
      {...overrides}
    />
  );
}

describe("AgentsCliStep", () => {
  beforeEach(() => {
    mockTauri.getCliLauncherStatus.mockReset();
    mockTauri.installCliLauncher.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the heading and found / not-found agent rows", () => {
    renderStep({
      agents: [agent("claude", true), agent("codex", false)],
      loadCliStatus: () => Promise.resolve(installedStatus),
    });

    expect(screen.getByText("Coding agents and CLI")).toBeDefined();
    expect(screen.getByTestId("onboarding-agent-claude")).toBeDefined();
    expect(screen.getByTestId("onboarding-agent-codex")).toBeDefined();
    expect(screen.getByText("Found")).toBeDefined();
    expect(screen.getByText("Not found")).toBeDefined();
  });

  it("shows the empty-agent copy and opens agent settings", () => {
    const onOpenAgentSettings = vi.fn();
    renderStep({ agents: [agent("codex", false)], onOpenAgentSettings });

    expect(screen.getByText(EMPTY_AGENT_COPY)).toBeDefined();

    fireEvent.click(screen.getByTestId("onboarding-open-agent-settings"));
    expect(onOpenAgentSettings).toHaveBeenCalledTimes(1);
  });

  it("disables the install button while installing and shows the installed state", async () => {
    let resolveInstall!: (status: CliLauncherStatus) => void;
    const installCli = vi.fn(
      () =>
        new Promise<CliLauncherStatus>((resolve) => {
          resolveInstall = resolve;
        })
    );

    renderStep({ installCli });

    const installButton = await screen.findByTestId("onboarding-install-cli");
    fireEvent.click(installButton);
    expect((installButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveInstall(installedStatus);
    });

    expect(screen.getByText("Installed at /usr/local/bin/ferryx")).toBeDefined();
    expect(screen.getByText("Installed")).toBeDefined();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
    expect(installCli).toHaveBeenCalledTimes(1);
  });

  it("shows the install error in an alert when installation fails", async () => {
    const installCli = vi.fn(() => Promise.reject(new Error("write protected path")));
    renderStep({ installCli });

    fireEvent.click(await screen.findByTestId("onboarding-install-cli"));

    const errorLine = await screen.findByRole("alert");
    expect(errorLine.textContent).toBe("write protected path");
    expect(screen.queryByText("Installed at /usr/local/bin/ferryx")).toBeNull();
    expect(
      (screen.getByTestId("onboarding-install-cli") as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("hides the CLI card while the status is loading", () => {
    renderStep({ loadCliStatus: () => new Promise<CliLauncherStatus>(() => {}) });

    expect(screen.queryByText("Ferryx CLI")).toBeNull();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
    expect(screen.getByText("Coding agents and CLI")).toBeDefined();
  });

  it("hides the CLI card when the launcher is unsupported", async () => {
    const loadCliStatus = vi.fn(() => Promise.resolve(unsupportedStatus));
    renderStep({ loadCliStatus });

    await act(async () => {});

    expect(loadCliStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ferryx CLI")).toBeNull();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
  });

  it("uses the default tauri loaders when no overrides are provided", async () => {
    mockTauri.getCliLauncherStatus.mockResolvedValue(notInstalledStatus);
    mockTauri.installCliLauncher.mockResolvedValue(installedStatus);

    render(<AgentsCliStep agents={[agent("claude", true)]} onOpenAgentSettings={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("onboarding-install-cli"));

    expect(mockTauri.getCliLauncherStatus).toHaveBeenCalledTimes(1);
    expect(mockTauri.installCliLauncher).toHaveBeenCalledTimes(1);

    await act(async () => {});

    expect(screen.getByText("Installed at /usr/local/bin/ferryx")).toBeDefined();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
  });

  it("keeps the CLI card hidden when the status load fails", async () => {
    const loadCliStatus = vi.fn(() => Promise.reject(new Error("ipc unavailable")));
    renderStep({ loadCliStatus });

    await act(async () => {});

    expect(loadCliStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ferryx CLI")).toBeNull();
    expect(screen.getByText("Coding agents and CLI")).toBeDefined();
  });

  it("does not throw when the install promise rejects after unmount", async () => {
    const installCli = vi.fn(() => Promise.reject(new Error("late failure")));
    const view = renderStep({ installCli });

    fireEvent.click(await screen.findByTestId("onboarding-install-cli"));
    view.unmount();

    await act(async () => {});

    expect(installCli).toHaveBeenCalledTimes(1);
  });
});
