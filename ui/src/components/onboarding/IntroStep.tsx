import { FolderTree, Keyboard, Server } from "lucide-react";

import { shortcutLabel } from "../../lib/shortcuts";
import { Card } from "../ui/card";

const INTRO_SHORTCUTS = [
  { id: "commandPalette.open", title: "Command palette" },
  { id: "tab.newTerminal", title: "New terminal tab" },
  { id: "terminal.splitRight", title: "Split right" },
  { id: "project.add", title: "Add project" },
] as const;

export function IntroStep(props: { isMac: boolean }): JSX.Element {
  const { isMac } = props;

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">How Ferryx works</h2>

      <div className="mt-4 space-y-3">
        <Card className="border-border bg-card/60 p-4">
          <div className="flex items-center gap-2">
            <Server className="size-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-foreground">Sessions outlive the window</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Terminals and agents run in the Ferryx background service, not in the window.
            Reloading or closing a window does not stop them.
          </p>
        </Card>

        <Card className="border-border bg-card/60 p-4">
          <div className="flex items-center gap-2">
            <FolderTree className="size-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-foreground">Projects, worktrees, tabs</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Add a folder as a project. In Git repositories Ferryx can create isolated worktrees,
            each with its own tabs and split panes.
          </p>
        </Card>

        <Card className="border-border bg-card/60 p-4">
          <div className="flex items-center gap-2">
            <Keyboard className="size-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-foreground">Keyboard first</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {INTRO_SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.id}
                className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
              >
                <span>{shortcut.title}</span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  {shortcutLabel(shortcut.id, isMac)}
                </kbd>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
