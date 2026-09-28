import { FolderPlus, Monitor } from "lucide-react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";

export function FirstProjectStep(props: {
  onAddProject: () => void;
  onConnectMachine: () => void;
}): JSX.Element {
  const { onAddProject, onConnectMachine } = props;

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        Open your first project
      </h2>

      <div className="mt-4 space-y-3">
        <Card className="border-border bg-card/60 p-4">
          <div className="flex items-center gap-2">
            <FolderPlus className="size-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-foreground">Local folder</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Pick a folder on this computer. Git repositories unlock worktrees.
          </p>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              data-testid="onboarding-add-project"
              onClick={onAddProject}
              className="gap-1.5 text-xs"
            >
              <FolderPlus className="size-3.5" />
              Add Project
            </Button>
          </div>
        </Card>

        <Card className="border-border bg-card/60 p-4">
          <div className="flex items-center gap-2">
            <Monitor className="size-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-foreground">Remote machine (optional)</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Pair another computer through your Ferryx account and work in its projects from here.
          </p>
          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              data-testid="onboarding-connect-machine"
              onClick={onConnectMachine}
              className="gap-1.5 text-xs"
            >
              <Monitor className="size-3.5" />
              Connect a machine
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
