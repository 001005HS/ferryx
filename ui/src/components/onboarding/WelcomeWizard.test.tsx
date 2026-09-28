import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedAgent } from "../../lib/agentsSettings";
import type { OnboardingStepId } from "../../lib/onboarding";
import type { SystemPermissionsStatus } from "../../lib/types";
import { WelcomeWizard, type WelcomeWizardProps } from "./WelcomeWizard";

vi.mock("./PermissionsStep", () => ({
  PermissionsStep: () => <div data-testid="mock-permissions-step" />,
}));

vi.mock("./AgentsCliStep", () => ({
  AgentsCliStep: () => <div data-testid="mock-agents-step" />,
}));

vi.mock("./CliStep", () => ({
  CliStep: () => <div data-testid="mock-cli-step" />,
}));

const mockAgents: readonly ResolvedAgent[] = [
  {
    name: "claude",
    available: true,
    enabled: true,
    command: "claude",
    args: "",
    custom: false,
  },
];

const mockPermissions: SystemPermissionsStatus = {
  platform: "macos",
  allGranted: true,
  fullDiskAccess: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Full disk access granted.",
  },
  accessibility: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Accessibility granted.",
  },
  notifications: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Notifications granted.",
  },
};

function createDefaultProps(overrides?: Partial<WelcomeWizardProps>): WelcomeWizardProps {
  return {
    steps: ["intro", "permissions", "project"] as readonly OnboardingStepId[],
    permissionsStatus: mockPermissions,
    agents: mockAgents,
    isMac: true,
    onAddProject: vi.fn(),
    onConnectMachine: vi.fn(),
    onStepCompleted: vi.fn(),
    onFinish: vi.fn(),
    onSkip: vi.fn(),
    onRemindLater: vi.fn(),
    ...overrides,
  };
}

describe("WelcomeWizard", () => {
  afterEach(() => {
    cleanup();
  });

  it('indicator shows "Step 1 of 3" for steps ["intro","permissions","project"]', () => {
    const props = createDefaultProps({
      steps: ["intro", "permissions", "project"],
    });
    render(<WelcomeWizard {...props} />);

    const indicator = screen.getByTestId("onboarding-step-indicator");
    expect(indicator.textContent).toBe("Step 1 of 3");
  });

  it('Continue calls onStepCompleted("intro") and shows the permissions step', () => {
    const onStepCompleted = vi.fn();
    const props = createDefaultProps({
      steps: ["intro", "permissions", "project"],
      onStepCompleted,
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.getByText("Set up Ferryx")).toBeDefined();
    fireEvent.click(screen.getByTestId("onboarding-next"));

    expect(onStepCompleted).toHaveBeenCalledTimes(1);
    expect(onStepCompleted).toHaveBeenCalledWith("intro");
    expect(screen.getByTestId("mock-permissions-step")).toBeDefined();
    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 2 of 3");
  });

  it("Back hidden on first step and returns to previous", () => {
    const props = createDefaultProps({
      steps: ["intro", "permissions", "project"],
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.queryByTestId("onboarding-back")).toBeNull();

    fireEvent.click(screen.getByTestId("onboarding-next"));
    expect(screen.getByTestId("onboarding-back")).toBeDefined();

    fireEvent.click(screen.getByTestId("onboarding-back"));
    expect(screen.queryByTestId("onboarding-back")).toBeNull();
    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 1 of 3");
    expect(screen.getByText("Set up Ferryx")).toBeDefined();
  });

  it("last step shows Done (not Continue) and Done calls onStepCompleted then onFinish", () => {
    const onStepCompleted = vi.fn();
    const onFinish = vi.fn();
    const props = createDefaultProps({
      steps: ["intro", "permissions", "project"],
      onStepCompleted,
      onFinish,
      initialStepIndex: 2,
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.queryByTestId("onboarding-next")).toBeNull();
    const finishButton = screen.getByTestId("onboarding-finish");
    expect(finishButton).toBeDefined();
    expect(finishButton.textContent).toBe("Done");

    const callOrder: string[] = [];
    onStepCompleted.mockImplementation(() => callOrder.push("stepCompleted"));
    onFinish.mockImplementation(() => callOrder.push("finish"));

    fireEvent.click(finishButton);

    expect(onStepCompleted).toHaveBeenCalledWith("project");
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["stepCompleted", "finish"]);
  });

  it("Skip calls onSkip", () => {
    const onSkip = vi.fn();
    const props = createDefaultProps({ onSkip });
    render(<WelcomeWizard {...props} />);

    fireEvent.click(screen.getByTestId("onboarding-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("Remind me later and Escape call onRemindLater", () => {
    const onRemindLater = vi.fn();
    const props = createDefaultProps({ onRemindLater });
    render(<WelcomeWizard {...props} />);

    fireEvent.click(screen.getByTestId("onboarding-remind-later"));
    expect(onRemindLater).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole("dialog", { name: "Welcome to Ferryx" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onRemindLater).toHaveBeenCalledTimes(2);
  });

  it('project step Add Project button calls onStepCompleted("project") then onAddProject', () => {
    const onStepCompleted = vi.fn();
    const onAddProject = vi.fn();
    const props = createDefaultProps({
      steps: ["intro", "project"],
      initialStepIndex: 1,
      onStepCompleted,
      onAddProject,
    });
    render(<WelcomeWizard {...props} />);

    const callOrder: string[] = [];
    onStepCompleted.mockImplementation(() => callOrder.push("stepCompleted"));
    onAddProject.mockImplementation(() => callOrder.push("addProject"));

    const addProjectBtn = screen.getByTestId("onboarding-add-project");
    fireEvent.click(addProjectBtn);

    expect(onStepCompleted).toHaveBeenCalledWith("project");
    expect(onAddProject).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["stepCompleted", "addProject"]);
  });

  it('project step Connect a machine button calls onStepCompleted("project") then onConnectMachine', () => {
    const onStepCompleted = vi.fn();
    const onConnectMachine = vi.fn();
    const props = createDefaultProps({
      steps: ["intro", "project"],
      initialStepIndex: 1,
      onStepCompleted,
      onConnectMachine,
    });
    render(<WelcomeWizard {...props} />);

    const callOrder: string[] = [];
    onStepCompleted.mockImplementation(() => callOrder.push("stepCompleted"));
    onConnectMachine.mockImplementation(() => callOrder.push("connectMachine"));

    const connectMachineBtn = screen.getByTestId("onboarding-connect-machine");
    fireEvent.click(connectMachineBtn);

    expect(onStepCompleted).toHaveBeenCalledWith("project");
    expect(onConnectMachine).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["stepCompleted", "connectMachine"]);
  });

  it("initialStepIndex=1 starts on the second step", () => {
    const props = createDefaultProps({
      steps: ["intro", "permissions", "project"],
      initialStepIndex: 1,
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 2 of 3");
    expect(screen.getByTestId("mock-permissions-step")).toBeDefined();
    expect(screen.getByTestId("onboarding-back")).toBeDefined();
  });

  it('root has role="dialog" with aria-label "Welcome to Ferryx"', () => {
    const props = createDefaultProps();
    render(<WelcomeWizard {...props} />);

    const dialog = screen.getByRole("dialog", { name: "Welcome to Ferryx" });
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Welcome to Ferryx");
  });

  it("clamps initialStepIndex within step range", () => {
    const propsNegative = createDefaultProps({
      steps: ["intro", "permissions", "project"],
      initialStepIndex: -5,
    });
    const { unmount } = render(<WelcomeWizard {...propsNegative} />);
    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 1 of 3");
    unmount();

    const propsOverflow = createDefaultProps({
      steps: ["intro", "permissions", "project"],
      initialStepIndex: 99,
    });
    render(<WelcomeWizard {...propsOverflow} />);
    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 3 of 3");
    expect(screen.getByTestId("onboarding-finish")).toBeDefined();
  });

  it("renders agents step mock when step is agents", () => {
    const props = createDefaultProps({
      steps: ["intro", "agents", "project"],
      initialStepIndex: 1,
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.getByTestId("mock-agents-step")).toBeDefined();
  });

  it("walks the six-step order with Continue and returns with Back", () => {
    const props = createDefaultProps({
      steps: ["intro", "features", "permissions", "agents", "cli", "project"],
    });
    render(<WelcomeWizard {...props} />);

    const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 1 of 6");
    expect(heading()).toBe("Set up Ferryx");

    const expected = [
      "What Ferryx does",
      "Grant system access",
      "Choose your default agent",
      "Install the command-line tool",
      "Open your first project",
    ];
    expected.forEach((title, index) => {
      fireEvent.click(screen.getByTestId("onboarding-next"));
      expect(heading()).toBe(title);
      expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe(
        `Step ${index + 2} of 6`,
      );
    });
    expect(screen.getByTestId("onboarding-finish")).toBeDefined();

    fireEvent.click(screen.getByTestId("onboarding-back"));
    expect(heading()).toBe("Install the command-line tool");
    expect(screen.getByTestId("mock-cli-step")).toBeDefined();
    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 5 of 6");
  });

  it("labels the agents and command-line steps separately in the rail", () => {
    const props = createDefaultProps({
      steps: ["intro", "features", "permissions", "agents", "cli", "project"],
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.getByTestId("onboarding-rail-agents").textContent).toContain("Agents");
    expect(screen.getByTestId("onboarding-rail-agents").textContent).not.toContain("CLI");
    expect(screen.getByTestId("onboarding-rail-cli").textContent).toContain("Command line");
  });

  it("lets Continue leave the optional cli step", () => {
    const onStepCompleted = vi.fn();
    const props = createDefaultProps({
      steps: ["intro", "agents", "cli", "project"],
      initialStepIndex: 2,
      onStepCompleted,
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.getByTestId("mock-cli-step")).toBeDefined();
    fireEvent.click(screen.getByTestId("onboarding-next"));

    expect(onStepCompleted).toHaveBeenCalledWith("cli");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Open your first project");
  });

  it("marks already satisfied steps done in the rail but never the current step", () => {
    const props = createDefaultProps({
      steps: ["intro", "features", "permissions", "agents", "project"],
      doneSteps: ["permissions"],
      initialStepIndex: 0,
    });
    render(<WelcomeWizard {...props} />);

    const permissionsRow = screen.getByTestId("onboarding-rail-permissions");
    const introRow = screen.getByTestId("onboarding-rail-intro");
    expect(permissionsRow.querySelector("svg")).not.toBeNull();
    expect(introRow.querySelector("svg")).toBeNull();
    expect(introRow.getAttribute("aria-current")).toBe("step");
  });

  it("initialStepIndex=2 opens on the permissions step of the five-step order", () => {
    const props = createDefaultProps({
      steps: ["intro", "features", "permissions", "agents", "project"],
      initialStepIndex: 2,
    });
    render(<WelcomeWizard {...props} />);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Grant system access");
    expect(screen.getByTestId("mock-permissions-step")).toBeDefined();
    expect(screen.getByTestId("onboarding-step-indicator").textContent).toBe("Step 3 of 5");
  });

  it("returns null when steps is empty", () => {
    const props = createDefaultProps({
      steps: [],
    });
    const { container } = render(<WelcomeWizard {...props} />);
    expect(container.firstChild).toBeNull();
  });
});
