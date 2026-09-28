import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAgentLogoByCommandName } from "../../lib/agentIcon";
import { loadAgentSettings, type ResolvedAgent } from "../../lib/agentsSettings";
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

const EMPTY_TITLE = "No coding agents found on your PATH.";
const EMPTY_DESCRIPTION =
  "Install one (for example Claude Code or Codex), or add a custom command in Settings > Agents.";

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
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders a default-agent radiogroup with Auto plus only the installed agents", () => {
    renderStep({
      agents: [agent("claude", true), agent("codex", false)],
      loadCliStatus: () => Promise.resolve(installedStatus),
    });

    const group = screen.getByRole("radiogroup", { name: "Default agent" });
    const options = within(group).getAllByRole("radio");

    expect(options).toHaveLength(2);
    expect(screen.getByText("Auto")).toBeDefined();
    expect(screen.getByText("Use the first available agent.")).toBeDefined();
    expect(options[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("onboarding-agent-claude")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByTestId("onboarding-agent-claude")).toHaveTextContent("claude");
    expect(screen.queryByTestId("onboarding-agent-codex")).toBeNull();
  });

  it("renders the brand icon for a known agent and no image for an unknown one", () => {
    renderStep({
      agents: [agent("claude", true), agent("mystery", true)],
      loadCliStatus: () => Promise.resolve(installedStatus),
    });

    const claudeOption = screen.getByTestId("onboarding-agent-claude");
    const claudeImg = claudeOption.querySelector("img");
    expect(claudeImg).not.toBeNull();
    expect(claudeImg?.getAttribute("src")).toBe(resolveAgentLogoByCommandName("claude"));

    const unknownOption = screen.getByTestId("onboarding-agent-mystery");
    expect(unknownOption.querySelector("img")).toBeNull();
    expect(unknownOption.querySelector("svg")).not.toBeNull();
  });

  it("persists the chosen default agent immediately", () => {
    renderStep({
      agents: [agent("claude", true)],
      loadCliStatus: () => Promise.resolve(installedStatus),
    });

    expect(loadAgentSettings().defaultAgentId).toBeNull();

    fireEvent.click(screen.getByTestId("onboarding-agent-claude"));
    expect(loadAgentSettings().defaultAgentId).toBe("claude");
    expect(screen.getByTestId("onboarding-agent-claude")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(loadAgentSettings().defaultAgentId).toBeNull();
    expect(screen.getAllByRole("radio")[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/^Not installed:/)).toBeNull();
  });

  it("moves the selection with arrow keys and keeps the roving tabindex", () => {
    renderStep({
      agents: [agent("claude", true)],
      loadCliStatus: () => Promise.resolve(installedStatus),
    });

    const autoOption = screen.getAllByRole("radio")[0];
    expect(autoOption).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(autoOption, { key: "ArrowDown" });

    const claudeOption = screen.getByTestId("onboarding-agent-claude");
    expect(claudeOption).toHaveAttribute("aria-checked", "true");
    expect(claudeOption).toHaveAttribute("tabindex", "0");
    expect(autoOption).toHaveAttribute("tabindex", "-1");
    expect(loadAgentSettings().defaultAgentId).toBe("claude");
  });

  it("lists unavailable agents in one quiet line", () => {
    renderStep({
      agents: [agent("claude", true), agent("gjc", false), agent("aider", false)],
      loadCliStatus: () => Promise.resolve(installedStatus),
    });

    expect(screen.getByText("Not installed: gjc, aider")).toBeDefined();
  });

  it("shows the empty message and opens agent settings when nothing is installed", () => {
    const onOpenAgentSettings = vi.fn();
    renderStep({ agents: [agent("codex", false)], onOpenAgentSettings });

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText(EMPTY_TITLE)).toBeDefined();
    expect(screen.getByText(EMPTY_DESCRIPTION)).toBeDefined();

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
    expect(screen.getByRole("radiogroup", { name: "Default agent" })).toBeDefined();
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
    expect(screen.getByRole("radiogroup", { name: "Default agent" })).toBeDefined();
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
