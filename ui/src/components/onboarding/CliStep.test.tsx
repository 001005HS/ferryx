import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CliLauncherStatus } from "../../lib/types";
import { CliStep, type CliStepProps } from "./CliStep";

const mockTauri = vi.hoisted(() => ({
  getCliLauncherStatus: vi.fn(),
  installCliLauncher: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  getCliLauncherStatus: () => mockTauri.getCliLauncherStatus(),
  installCliLauncher: () => mockTauri.installCliLauncher(),
}));

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

function renderStep(overrides: Partial<CliStepProps> = {}) {
  return render(
    <CliStep loadCliStatus={() => Promise.resolve(notInstalledStatus)} {...overrides} />
  );
}

describe("CliStep", () => {
  beforeEach(() => {
    mockTauri.getCliLauncherStatus.mockReset();
    mockTauri.installCliLauncher.mockReset();
  });

  afterEach(() => {
    cleanup();
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

    expect(screen.getByTestId("onboarding-cli-installed")).toBeDefined();
    expect(screen.getByText("Installed at /usr/local/bin/ferryx")).toBeDefined();
    expect(screen.getByText("Installed")).toBeDefined();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
    expect(installCli).toHaveBeenCalledTimes(1);
  });

  it("shows the installed state without an install button when already installed", async () => {
    renderStep({ loadCliStatus: () => Promise.resolve(installedStatus) });

    expect(await screen.findByTestId("onboarding-cli-installed")).toBeDefined();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
    expect(screen.queryByTestId("onboarding-cli-unavailable")).toBeNull();
  });

  it("shows the install error in an alert when installation fails", async () => {
    const installCli = vi.fn(() => Promise.reject(new Error("write protected path")));
    renderStep({ installCli });

    fireEvent.click(await screen.findByTestId("onboarding-install-cli"));

    const errorLine = await screen.findByRole("alert");
    expect(errorLine.textContent).toBe("write protected path");
    expect(screen.queryByTestId("onboarding-cli-installed")).toBeNull();
    expect(
      (screen.getByTestId("onboarding-install-cli") as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("renders no launcher row while the status is loading", () => {
    renderStep({ loadCliStatus: () => new Promise<CliLauncherStatus>(() => {}) });

    expect(screen.queryByText("Ferryx CLI")).toBeNull();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
    expect(screen.queryByTestId("onboarding-cli-unavailable")).toBeNull();
  });

  it("shows a neutral unavailable line when the launcher is unsupported", async () => {
    const loadCliStatus = vi.fn(() => Promise.resolve(unsupportedStatus));
    renderStep({ loadCliStatus });

    expect(await screen.findByTestId("onboarding-cli-unavailable")).toBeDefined();
    expect(loadCliStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ferryx CLI")).toBeNull();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the default tauri loaders when no overrides are provided", async () => {
    mockTauri.getCliLauncherStatus.mockResolvedValue(notInstalledStatus);
    mockTauri.installCliLauncher.mockResolvedValue(installedStatus);

    render(<CliStep />);

    fireEvent.click(await screen.findByTestId("onboarding-install-cli"));

    expect(mockTauri.getCliLauncherStatus).toHaveBeenCalledTimes(1);
    expect(mockTauri.installCliLauncher).toHaveBeenCalledTimes(1);

    expect(await screen.findByTestId("onboarding-cli-installed")).toBeDefined();
    expect(screen.getByText("Installed at /usr/local/bin/ferryx")).toBeDefined();
    expect(screen.queryByTestId("onboarding-install-cli")).toBeNull();
  });

  it("shows the unavailable line instead of an error when the status load fails", async () => {
    const loadCliStatus = vi.fn(() => Promise.reject(new Error("ipc unavailable")));
    renderStep({ loadCliStatus });

    expect(await screen.findByTestId("onboarding-cli-unavailable")).toBeDefined();
    expect(loadCliStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Ferryx CLI")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
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
