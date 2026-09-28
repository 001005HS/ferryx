import { FolderPlus, ListChecks, Monitor } from "lucide-react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";

export function GettingStartedChecklist(props: {
  onAddProject: () => void;
  onConnectMachine: () => void;
  onOpenWelcome: () => void;
  permissionsSummary: { granted: number; total: number } | null;
}): JSX.Element {
  const { onAddProject, onConnectMachine, onOpenWelcome, permissionsSummary } = props;

  const permissionsLine =
    permissionsSummary !== null && permissionsSummary.total > 0
      ? `${permissionsSummary.granted} of ${permissionsSummary.total} permissions granted`
      : "Permissions, agents, and CLI";

  return (
    <div
      data-testid="no-projects-view"
      className="flex h-full flex-1 flex-col items-center justify-center gap-4 overflow-y-auto bg-background py-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-1 px-4 text-center">
        <p className="text-sm font-semibold text-foreground">No projects</p>
        <p className="text-xs text-muted-foreground">
          Add a project to open a terminal workspace.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-2 px-4">
        <Card data-testid="checklist-add-project" className="border-border bg-card/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FolderPlus className="size-4 shrink-0 text-primary" />
              <span className="text-sm font-medium text-foreground">Add a local project</span>
            </div>
            <Button type="button" size="sm" onClick={onAddProject}>
              Add Project
            </Button>
          </div>
        </Card>

        <Card data-testid="checklist-connect-machine" className="border-border bg-card/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Monitor className="size-4 shrink-0 text-primary" />
              <span className="text-sm font-medium text-foreground">
                Connect a remote machine (optional)
              </span>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={onConnectMachine}>
              Connect machine
            </Button>
          </div>
        </Card>

        <Card data-testid="checklist-review-setup" className="border-border bg-card/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <ListChecks className="size-4 shrink-0 text-primary" />
                <span className="text-sm font-medium text-foreground">Review setup</span>
              </div>
              <p className="text-xs text-muted-foreground">{permissionsLine}</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={onOpenWelcome}>
              Open Welcome Setup
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
