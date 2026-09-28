import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { shortcutLabel } from "../../lib/shortcuts";
import { FirstProjectStep } from "./FirstProjectStep";
import { IntroStep } from "./IntroStep";

const INTRO_SHORTCUT_IDS = [
  "commandPalette.open",
  "tab.newTerminal",
  "terminal.splitRight",
  "project.add",
] as const;

function renderedKbdLabels(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll("kbd")).map((kbd) => kbd.textContent);
}

describe("IntroStep", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the three points", () => {
    render(<IntroStep isMac />);

    expect(screen.getByText("Sessions outlive the window")).toBeDefined();
    expect(screen.getByText("Projects, worktrees, tabs")).toBeDefined();
    expect(screen.getByText("Keyboard first")).toBeDefined();
    expect(screen.getByText("Command palette")).toBeDefined();
    expect(screen.getByText("New terminal tab")).toBeDefined();
    expect(screen.getByText("Split right")).toBeDefined();
    expect(screen.getByText("Add project")).toBeDefined();
  });

  it("renders mac shortcut labels equal to shortcutLabel(id, true)", () => {
    const { container } = render(<IntroStep isMac />);

    const labels = renderedKbdLabels(container);
    expect(labels).toHaveLength(INTRO_SHORTCUT_IDS.length);
    expect(labels).toEqual(INTRO_SHORTCUT_IDS.map((id) => shortcutLabel(id, true)));
  });

  it("renders non-mac shortcut labels equal to shortcutLabel(id, false)", () => {
    const { container } = render(<IntroStep isMac={false} />);

    const labels = renderedKbdLabels(container);
    expect(labels).toHaveLength(INTRO_SHORTCUT_IDS.length);
    expect(labels).toEqual(INTRO_SHORTCUT_IDS.map((id) => shortcutLabel(id, false)));
    expect(labels).not.toEqual(INTRO_SHORTCUT_IDS.map((id) => shortcutLabel(id, true)));
  });
});

describe("FirstProjectStep", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders both project choices as buttons", () => {
    render(
      <FirstProjectStep onAddProject={vi.fn()} onConnectMachine={vi.fn()} />
    );

    expect(screen.getByTestId("onboarding-add-project")).toBeDefined();
    expect(screen.getByTestId("onboarding-connect-machine")).toBeDefined();
    expect(screen.getByRole("button", { name: /Add a local folder/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Connect a machine/ })).toBeDefined();
  });

  it("calls onAddProject when Add a local folder is clicked", () => {
    const onAddProject = vi.fn();
    const onConnectMachine = vi.fn();
    render(
      <FirstProjectStep onAddProject={onAddProject} onConnectMachine={onConnectMachine} />
    );

    fireEvent.click(screen.getByTestId("onboarding-add-project"));

    expect(onAddProject).toHaveBeenCalledTimes(1);
    expect(onConnectMachine).not.toHaveBeenCalled();
  });

  it("calls onConnectMachine when Connect a machine is clicked", () => {
    const onAddProject = vi.fn();
    const onConnectMachine = vi.fn();
    render(
      <FirstProjectStep onAddProject={onAddProject} onConnectMachine={onConnectMachine} />
    );

    fireEvent.click(screen.getByTestId("onboarding-connect-machine"));

    expect(onConnectMachine).toHaveBeenCalledTimes(1);
    expect(onAddProject).not.toHaveBeenCalled();
  });
});
