import { shortcutLabel } from "../../lib/shortcuts";
import { Keycap, WizardRow, WizardRowList } from "./WizardPrimitives";

const INTRO_SHORTCUTS = [
  { id: "commandPalette.open", title: "Command palette" },
  { id: "tab.newTerminal", title: "New terminal tab" },
  { id: "terminal.splitRight", title: "Split right" },
  { id: "project.add", title: "Add project" },
] as const;

export function IntroStep({ isMac }: { isMac: boolean }): JSX.Element {
  return (
    <WizardRowList>
      <WizardRow
        title="Sessions outlive the window"
        description="Terminals and agents run in the Ferryx background service. Closing a window doesn't stop them."
      />
      <WizardRow
        title="Projects, worktrees, tabs"
        description="Add a folder as a project. Git repositories get isolated worktrees, each with its own tabs and panes."
      />
      <WizardRow
        title="Keyboard first"
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
            {INTRO_SHORTCUTS.map((shortcut) => (
              <span
                key={shortcut.id}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
              >
                <span>{shortcut.title}</span>
                <Keycap>{shortcutLabel(shortcut.id, isMac)}</Keycap>
              </span>
            ))}
          </span>
        }
      />
    </WizardRowList>
  );
}
