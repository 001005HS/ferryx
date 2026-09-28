import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GettingStartedChecklist } from "./GettingStartedChecklist";

type PermissionsSummary = { granted: number; total: number };

function renderChecklist(permissionsSummary: PermissionsSummary | null = null) {
  const onAddProject = vi.fn();
  const onConnectMachine = vi.fn();
  const onOpenWelcome = vi.fn();

  render(
    <GettingStartedChecklist
      onAddProject={onAddProject}
      onConnectMachine={onConnectMachine}
      onOpenWelcome={onOpenWelcome}
      permissionsSummary={permissionsSummary}
    />
  );

  return { onAddProject, onConnectMachine, onOpenWelcome };
}

describe("GettingStartedChecklist", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the root view, exact title, and subtitle", () => {
    renderChecklist();

    expect(screen.getByTestId("no-projects-view")).toBeDefined();
    expect(screen.getByText("No projects")).toBeDefined();
    expect(screen.getByText("Add a project to open a terminal workspace.")).toBeDefined();
  });

  it("renders the three checklist rows", () => {
    renderChecklist();

    expect(screen.getByTestId("checklist-add-project")).toBe(
      screen.getByRole("button", { name: "Add Project" })
    );
    expect(screen.getByTestId("checklist-connect-machine")).toBe(
      screen.getByRole("button", { name: "Connect machine" })
    );
    expect(screen.getByTestId("checklist-review-setup").contains(
      screen.getByRole("button", { name: "Open Welcome Setup" })
    )).toBe(true);
  });

  it("calls onAddProject from the primary Add Project button", () => {
    const { onAddProject, onConnectMachine, onOpenWelcome } = renderChecklist();

    fireEvent.click(screen.getByRole("button", { name: "Add Project" }));

    expect(onAddProject).toHaveBeenCalledTimes(1);
    expect(onConnectMachine).not.toHaveBeenCalled();
    expect(onOpenWelcome).not.toHaveBeenCalled();
  });

  it("calls onConnectMachine from the Connect machine button", () => {
    const { onAddProject, onConnectMachine, onOpenWelcome } = renderChecklist();

    fireEvent.click(screen.getByRole("button", { name: "Connect machine" }));

    expect(onConnectMachine).toHaveBeenCalledTimes(1);
    expect(onAddProject).not.toHaveBeenCalled();
    expect(onOpenWelcome).not.toHaveBeenCalled();
  });

  it("calls onOpenWelcome from the Open Welcome Setup button", () => {
    const { onAddProject, onConnectMachine, onOpenWelcome } = renderChecklist();

    fireEvent.click(screen.getByRole("button", { name: "Open Welcome Setup" }));

    expect(onOpenWelcome).toHaveBeenCalledTimes(1);
    expect(onAddProject).not.toHaveBeenCalled();
    expect(onConnectMachine).not.toHaveBeenCalled();
  });

  it("shows the permissions summary when one is provided", () => {
    renderChecklist({ granted: 2, total: 3 });

    expect(screen.getByText("2 of 3 permissions granted")).toBeDefined();
    expect(screen.queryByText("Permissions, agents, and CLI")).toBeNull();
  });

  it("falls back to generic setup copy when the summary is null", () => {
    renderChecklist(null);

    expect(screen.getByText("Permissions, agents, and CLI")).toBeDefined();
    expect(screen.queryByText(/permissions granted/)).toBeNull();
  });

  it("falls back to generic setup copy when the summary total is zero", () => {
    renderChecklist({ granted: 0, total: 0 });

    expect(screen.getByText("Permissions, agents, and CLI")).toBeDefined();
    expect(screen.queryByText(/permissions granted/)).toBeNull();
  });
});
