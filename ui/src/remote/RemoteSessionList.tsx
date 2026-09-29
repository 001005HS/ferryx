import {
  Check,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Inbox,
  LoaderCircle,
  Plus,
  Server,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconButton } from "../components/ui/IconButton";
import { AttentionInbox } from "../features/ferryx/attention/AttentionInbox";
import { buildRemoteAttentionRows, type AttentionRow } from "../features/ferryx/attention/attentionModel";
import { isMonochromeAgentLogo, resolveAgentLogo } from "../lib/agentIcon";

export type RemoteTerminalTabInfo = {
  id: string;
  label: string;
  activityState?: "working" | "waiting" | "done";
  agentType?: string;
  worktreeSlug?: string;
  worktreeLabel?: string;
  sessionId?: string;
};

export type RemoteTerminalItem = {
  sessionId: string;
  running?: boolean;
  title?: string | null;
  workspaceId?: string | null;
  worktreeLabel?: string | null;
};

export type RemoteContext = {
  workspaceId: string | null;
  worktreeSlug: string | null;
  worktreeLabel: string | null;
  activeTerminal: RemoteTerminalItem | null;
  activeTabId?: string | null;
  terminalTabs?: RemoteTerminalTabInfo[];
};

export type RemoteContextOption = {
  workspaceId: string;
  worktreeSlug: string | null;
  worktreeLabel: string | null;
  tabId?: string | null;
  sessionId?: string | null;
  sessionLabel?: string;
  attention?: "working" | "waiting" | "done";
  /** Account inventory only: the machine that owns this option. workspaceId stays raw. */
  machineId?: string;
  machineDisplayName?: string;
};

export type RemoteWorkspaceModel = {
  context: RemoteContext;
  options: RemoteContextOption[];
};

type UnknownRecord = Record<string, unknown>;

function focusTerminalInput(): void {
  if (typeof document === "undefined") return;
  const sink = document.querySelector<HTMLTextAreaElement>(
    'textarea[data-testid="remote-terminal-input-sink"]'
  );
  sink?.focus({ preventScroll: true });
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is UnknownRecord => item !== null) : [];
}

function safeContextText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^(?:~[/\\]|[/\\]|[a-zA-Z]:[/\\]|file:)/.test(text)) return null;
  if (/(?:^|\s)(?:~[/\\]|[/\\](?:Users|Volumes|home|private|tmp|var|opt|etc)\b|[a-zA-Z]:[/\\])/.test(text)) {
    return null;
  }
  return text;
}

function terminal(value: unknown): RemoteTerminalItem | null {
  const item = record(value);
  const sessionId = safeContextText(item?.sessionId);
  if (!item || !sessionId || item.running === false) return null;
  return {
    sessionId,
    running: item.running !== false,
    title: safeContextText(item.title ?? item.label),
    workspaceId: safeContextText(item.workspaceId),
    worktreeLabel: safeContextText(item.worktreeLabel),
  };
}

function parseActivityState(value: unknown): "working" | "waiting" | "done" | undefined {
  if (value === "working" || value === "waiting" || value === "done") {
    return value;
  }
  return undefined;
}

function attentionRank(state?: "working" | "waiting" | "done"): number {
  if (state === "waiting") return 3;
  if (state === "done") return 2;
  if (state === "working") return 1;
  return 0;
}

function tabItem(value: unknown): RemoteTerminalTabInfo | null {
  const item = record(value);
  const id = safeContextText(item?.id ?? item?.tabId);
  const rawLabel = item?.label ?? item?.tabLabel ?? item?.title;
  const label = safeContextText(rawLabel) ?? "Terminal";
  if (!id) return null;
  const activityState = parseActivityState(item?.activityState ?? item?.activity_state ?? item?.state);
  const agentType = safeContextText(item?.agentType ?? item?.agent_type) ?? undefined;
  const worktreeSlug = safeContextText(item?.worktreeSlug ?? item?.worktree_slug) ?? undefined;
  const worktreeLabel = safeContextText(item?.worktreeLabel ?? item?.worktree_label) ?? undefined;
  const sessionId = safeContextText(item?.sessionId ?? item?.session_id) ?? undefined;
  return {
    id,
    label,
    ...(activityState ? { activityState } : {}),
    ...(agentType ? { agentType } : {}),
    ...(worktreeSlug ? { worktreeSlug } : {}),
    ...(worktreeLabel ? { worktreeLabel } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

function tabItems(value: unknown): RemoteTerminalTabInfo[] {
  return Array.isArray(value)
    ? value.map(tabItem).filter((item): item is RemoteTerminalTabInfo => item !== null)
    : [];
}

function contextOption(value: unknown, fallbackWorkspaceId: string | null): RemoteContextOption | null {
  const item = record(value);
  if (!item) return null;
  const workspaceId = safeContextText(item.workspaceId) ?? fallbackWorkspaceId;
  if (!workspaceId) return null;
  const worktreeSlug = safeContextText(item.worktreeSlug ?? item.slug);
  const worktreeLabel = safeContextText(item.worktreeLabel ?? item.label ?? item.branch);
  const tabId = safeContextText(item.tabId ?? item.tab_id);
  const sessionId = safeContextText(item.sessionId ?? item.session_id);
  const attention = parseActivityState(item.attention ?? item.activityState ?? item.activity_state);
  return {
    workspaceId,
    worktreeSlug,
    worktreeLabel: worktreeLabel ?? worktreeSlug,
    ...(tabId ? { tabId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(attention ? { attention } : {}),
  };
}

function appendOption(options: RemoteContextOption[], option: RemoteContextOption | null) {
  if (!option) return;
  const key = `${option.workspaceId}\u0000${option.worktreeSlug ?? ""}\u0000${option.worktreeLabel ?? ""}`;
  const existing = options.find((candidate) =>
    `${candidate.workspaceId}\u0000${candidate.worktreeSlug ?? ""}\u0000${candidate.worktreeLabel ?? ""}` === key
  );
  if (!existing) {
    options.push(option);
  } else if (option.attention && (!existing.attention || attentionRank(option.attention) > attentionRank(existing.attention))) {
    existing.attention = option.attention;
  }
}

function optionFromGitWorktree(value: unknown, workspaceId: string): RemoteContextOption | null {
  const item = record(value);
  if (!item) return null;

  const explicitSlug = safeContextText(item.worktreeSlug ?? item.slug);
  const explicitLabel = safeContextText(item.worktreeLabel ?? item.label);
  const attention = parseActivityState(item.attention ?? item.activityState ?? item.activity_state);
  if (explicitSlug || explicitLabel) {
    return {
      workspaceId,
      worktreeSlug: explicitSlug,
      worktreeLabel: explicitLabel ?? explicitSlug,
      ...(attention ? { attention } : {}),
    };
  }

  const branch = safeContextText(item.branch)?.replace(/^refs\/heads\//, "") ?? null;
  if (!branch) return { workspaceId, worktreeSlug: null, worktreeLabel: null, ...(attention ? { attention } : {}) };
  const prefix = `orca/${workspaceId}/`;
  const slug = branch.startsWith(prefix) ? branch.slice(prefix.length) : null;
  return {
    workspaceId,
    worktreeSlug: safeContextText(slug),
    worktreeLabel: safeContextText(slug ?? branch),
    ...(attention ? { attention } : {}),
  };
}

/**
 * Accepts the current typed contract plus older state shapes. Explicit active
 * terminal fields always win. A legacy sessions array is used only when it has
 * exactly one entry; ambiguous/malformed arrays never become a session switcher.
 */
export function normalizeRemoteWorkspaceState(value: unknown): RemoteWorkspaceModel {
  const state = record(value) ?? {};
  const declaredContext =
    record(state.activeContext) ??
    record(state.activeSelection) ??
    record(state.selection) ??
    {};

  const workspaceId = safeContextText(
    declaredContext.workspaceId ?? state.activeWorkspaceId ?? state.workspaceId,
  );
  const worktreeSlug = safeContextText(
    declaredContext.worktreeSlug ?? declaredContext.slug ?? state.activeWorktreeSlug,
  );
  const worktreeLabel = safeContextText(
    declaredContext.worktreeLabel ?? declaredContext.label ?? state.activeWorktreeLabel,
  );

  const sessionRows = records(state.sessions);
  const hasExplicitTerminalDeclaration =
    "activeTerminal" in declaredContext ||
    "terminal" in declaredContext ||
    "activeTerminal" in state ||
    "focusedTerminal" in state;
  const explicitTerminal =
    terminal(declaredContext.activeTerminal) ??
    terminal(declaredContext.terminal) ??
    terminal(state.activeTerminal) ??
    terminal(state.focusedTerminal);
  const declaredSessionId = safeContextText(
    declaredContext.sessionId ?? state.activeSessionId ?? state.focusedSessionId,
  );
  const declaredSession = declaredSessionId
    ? terminal(sessionRows.find((item) => item.sessionId === declaredSessionId)) ?? {
        sessionId: declaredSessionId,
        running: true,
      }
    : null;
  const legacySingleSession =
    !hasExplicitTerminalDeclaration && sessionRows.length === 1 ? terminal(sessionRows[0]) : null;
  const activeTerminal = explicitTerminal ?? declaredSession ?? legacySingleSession;
  const activeTabId = safeContextText(
    declaredContext.tabId ?? declaredContext.activeTabId ?? state.activeTabId ?? state.tabId,
  );
  const terminalTabs = tabItems(
    declaredContext.terminalTabs ?? declaredContext.tabs ?? state.terminalTabs ?? state.tabs,
  );
  const activeWorkspaceId = workspaceId ?? safeContextText(activeTerminal?.workspaceId);
  const activeWorktreeSlug = worktreeSlug;
  const activeWorktreeLabel =
    worktreeLabel ?? safeContextText(activeTerminal?.worktreeLabel) ?? activeWorktreeSlug;

  const options: RemoteContextOption[] = [];
  for (const item of records(state.contexts ?? state.contextOptions ?? state.selections)) {
    appendOption(options, contextOption(item, null));
  }

  const projectRows = records(state.projects ?? state.workspaces);
  for (const project of projectRows) {
    const projectId = safeContextText(project.workspaceId ?? project.id);
    if (!projectId) continue;
    const projectWorktrees = records(project.worktrees ?? project.contexts);
    if (projectWorktrees.length === 0) {
      appendOption(options, { workspaceId: projectId, worktreeSlug: null, worktreeLabel: null });
      continue;
    }
    for (const item of projectWorktrees) appendOption(options, contextOption(item, projectId));
  }

  if (activeWorkspaceId) {
    for (const item of records(state.worktrees)) {
      appendOption(options, optionFromGitWorktree(item, activeWorkspaceId));
    }
    appendOption(options, {
      workspaceId: activeWorkspaceId,
      worktreeSlug: activeWorktreeSlug,
      worktreeLabel: activeWorktreeLabel,
    });
  }

  for (const project of projectRows) {
    const projectId = safeContextText(project.workspaceId ?? project.id);
    if (!projectId?.startsWith("ssh:")) continue;
    const sessions = sessionRows.map(terminal)
      .filter((session) => session?.workspaceId === projectId);
    sessions.forEach((session, index) => {
      if (!session) return;
      options.push({
        workspaceId: projectId,
        worktreeSlug: null,
        worktreeLabel: session.worktreeLabel ?? null,
        sessionId: session.sessionId,
        sessionLabel: session.title ?? `Terminal ${index + 1}`,
      });
    });
  }

  return {
    context: {
      workspaceId: activeWorkspaceId,
      worktreeSlug: activeWorktreeSlug,
      worktreeLabel: activeWorktreeLabel,
      activeTerminal,
      activeTabId,
      terminalTabs,
    },
    options,
  };
}

export function contextName(context: Pick<RemoteContext, "workspaceId" | "worktreeLabel" | "worktreeSlug">) {
  const workspace = context.workspaceId ?? "No workspace selected";
  const worktree = context.worktreeLabel ?? context.worktreeSlug;
  return worktree ? `${workspace} / ${worktree}` : workspace;
}

function optionRowKey(option: RemoteContextOption) {
  return `${option.machineId ?? ""}\u0000${option.workspaceId}:${option.sessionId ?? option.worktreeSlug ?? option.worktreeLabel ?? "workspace"}`;
}

function optionGroupKey(option: RemoteContextOption) {
  return `${option.machineId ?? ""}\u0000${option.workspaceId}`;
}

function optionGroupLabel(option: RemoteContextOption) {
  const machine = option.machineId ? option.machineDisplayName || option.machineId : null;
  return machine ? `${machine} / ${option.workspaceId}` : option.workspaceId;
}

function optionName(option: RemoteContextOption) {
  const machine = option.machineId ? option.machineDisplayName || option.machineId : null;
  const name = `${machine ? `${machine} / ` : ""}${contextName(option)}${option.sessionLabel ? ` / ${option.sessionLabel}` : ""}`;
  return option.attention ? `${name} (${option.attention})` : name;
}

function isOtherMachine(option: RemoteContextOption, activeMachineId: string | null) {
  return Boolean(option.machineId) && option.machineId !== activeMachineId;
}

function isCurrentOption(option: RemoteContextOption, context: RemoteContext, activeMachineId: string | null) {
  if (isOtherMachine(option, activeMachineId)) return false;
  if (option.workspaceId !== context.workspaceId) return false;
  if (option.sessionId) return option.sessionId === context.activeTerminal?.sessionId;
  const optionWorktree = option.worktreeSlug ?? option.worktreeLabel;
  const activeWorktree = context.worktreeSlug ?? context.worktreeLabel;
  return optionWorktree ? optionWorktree === activeWorktree : activeWorktree === null;
}

export function getRemoteDocumentTitle(model: RemoteWorkspaceModel): string {
  if (!model.context.activeTerminal && (!model.context.terminalTabs || model.context.terminalTabs.length === 0)) {
    return "Ferryx";
  }
  const activeTab = model.context.terminalTabs?.find(
    (tab) => tab.id === model.context.activeTabId,
  );
  const title =
    activeTab?.label ??
    model.context.activeTerminal?.title ??
    model.context.terminalTabs?.[0]?.label ??
    (model.context.activeTerminal ? "Terminal" : null);

  return title ? `${title} - Ferryx` : "Ferryx";
}

type RemoteWorkspaceMirrorProps = {
  model: RemoteWorkspaceModel;
  pending: RemoteContextOption | null;
  selectorOpen: boolean;
  onSelectorOpenChange: (open: boolean) => void;
  onOpenHosts?: () => void;
  onSelect: (option: RemoteContextOption) => void;
  onCreateTerminal?: () => void;
  onCreateWorktree?: () => void;
  creationError?: string | null;
  /** Machine that owns model.context; account options from other machines are never current. */
  activeMachineId?: string | null;
  /** Inventory loading/offline/error rows, rendered only inside the opened picker. */
  pickerStatus?: ReactNode;
  children?: ReactNode;
};

export const RemoteWorkspaceMirror: React.FC<RemoteWorkspaceMirrorProps> = ({
  model,
  pending,
  selectorOpen,
  onSelectorOpenChange,
  onOpenHosts,
  onSelect,
  onCreateTerminal,
  onCreateWorktree,
  creationError,
  activeMachineId = null,
  pickerStatus,
  children,
}) => {
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, { label: string; options: RemoteContextOption[] }>();
    for (const option of model.options) {
      const key = optionGroupKey(option);
      const group = groups.get(key) ?? { label: optionGroupLabel(option), options: [] };
      group.options.push(option);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [model.options]);

  const paneTabs = model.context.terminalTabs ?? [];
  const activePaneIdx = paneTabs.findIndex((tab) => tab.id === model.context.activeTabId);
  const currentPaneIndex = activePaneIdx >= 0 ? activePaneIdx : 0;
  const currentPaneOrdinal = paneTabs.length ? currentPaneIndex + 1 : 0;
  const selectPane = (tab: (typeof paneTabs)[number]) => {
    if (!model.context.workspaceId) return;
    onSelect({
      workspaceId: model.context.workspaceId,
      worktreeSlug: tab.worktreeSlug ?? model.context.worktreeSlug,
      worktreeLabel: tab.worktreeLabel ?? model.context.worktreeLabel,
      tabId: tab.id,
      sessionId: tab.sessionId,
    });
    focusTerminalInput();
  };

  // Panes are grouped under the worktree they belong to; a pane whose worktree is not in the
  // option list (a foreign worktree the desktop has focused) still needs a home.
  const claimedPaneIds = new Set<string>();
  const panesByOption = new Map<string, typeof paneTabs>();
  for (const option of model.options) {
    if (option.sessionId || isOtherMachine(option, activeMachineId)) continue;
    const matches = paneTabs.filter((tab) => {
      if (claimedPaneIds.has(tab.id)) return false;
      const tabSlug = tab.worktreeSlug ?? model.context.worktreeSlug;
      const tabLabel = tab.worktreeLabel ?? model.context.worktreeLabel;
      if (option.worktreeSlug && tabSlug) return tabSlug === option.worktreeSlug;
      return (tabLabel ?? null) === (option.worktreeLabel ?? option.worktreeSlug ?? null);
    });
    panesByOption.set(optionRowKey(option), matches);
    for (const tab of matches) claimedPaneIds.add(tab.id);
  }
  const orphanPanes = paneTabs.filter((tab) => !claimedPaneIds.has(tab.id));
  const attentionRows = model.context.workspaceId
    ? buildRemoteAttentionRows(model.context.workspaceId, model.context.workspaceId, paneTabs, model.context.activeTabId)
    : [];
  const openAttentionRow = (row: AttentionRow) => {
    const tab = paneTabs.find((candidate) => candidate.id === row.id);
    if (!tab) return;
    selectPane(tab);
    onSelectorOpenChange(false);
  };
  // The worktree list is the sheet's default; the inbox is a sub view the header icon opens.
  const [inboxOpen, setInboxOpen] = useState(false);
  useEffect(() => {
    if (!selectorOpen) setInboxOpen(false);
  }, [selectorOpen]);

  const renderPaneRow = (tab: (typeof paneTabs)[number], siblingWorktreeLabel: string | null | undefined) => {
    const logo = resolveAgentLogo(tab.agentType);
    const monochrome = isMonochromeAgentLogo(tab.agentType);
    const paneActive = tab.id === model.context.activeTabId;
    // The worktree disambiguates same-named panes, exactly as the old tab strip did.
    const foreignWorktree =
      tab.worktreeLabel && tab.worktreeLabel !== siblingWorktreeLabel ? tab.worktreeLabel : null;
    const tabDescription = foreignWorktree ? `${tab.label} - ${foreignWorktree}` : tab.label;
    const tabAriaLabel = tab.activityState
      ? `${tabDescription} (${tab.activityState})`
      : tabDescription;
    return (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={paneActive}
        aria-label={tabAriaLabel}
        disabled={pending !== null}
        onClick={() => selectPane(tab)}
        className={`flex min-h-[24px] w-full items-center gap-1.5 rounded-md py-0.5 pl-6 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 ${
          paneActive ? "bg-white/[0.06] text-foreground" : "text-worktree-sidebar-foreground/85 hover:bg-white/[0.04]"
        }`}
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            data-testid="tab-agent-icon"
            data-agent-type={tab.agentType}
            className={`size-3 shrink-0 ${monochrome ? "agent-tab-logo--monochrome opacity-80" : ""}`}
          />
        ) : (
          <TerminalIcon data-testid="tab-terminal-icon" className="size-3 shrink-0 opacity-70" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] leading-tight">{tab.label}</span>
        {tab.activityState === "working" ? (
          <LoaderCircle
            aria-hidden="true"
            data-testid="tab-working-indicator"
            className="size-2.5 shrink-0 animate-spin text-status-working motion-reduce:animate-none"
          />
        ) : tab.activityState === "waiting" ? (
          <span
            aria-hidden="true"
            data-testid="tab-waiting-indicator"
            className="size-1.5 shrink-0 rounded-full bg-status-warning ring-2 ring-status-warning/20"
          />
        ) : tab.activityState === "done" ? (
          <span
            aria-hidden="true"
            data-testid="tab-done-indicator"
            className="size-1.5 shrink-0 rounded-full bg-status-success"
          />
        ) : null}
      </button>
    );
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {selectorOpen ? (
        <div className="absolute inset-x-2 top-1.5 z-20 flex max-h-full min-w-0 flex-col rounded-lg border border-border bg-worktree-sidebar text-worktree-sidebar-foreground shadow-xl" role="dialog" aria-label="Workspace context">
          <div className="flex h-8 items-center justify-between border-b border-worktree-sidebar-border px-1.5">
            <button
              type="button"
              aria-label={attentionRows.length > 0 ? `Inbox (${attentionRows.length})` : "Inbox"}
              aria-pressed={inboxOpen}
              onClick={() => setInboxOpen((open) => !open)}
              className={`relative flex size-6 items-center justify-center rounded-md transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                inboxOpen ? "bg-white/[0.08] text-worktree-sidebar-foreground" : "text-muted-foreground"
              }`}
            >
              <Inbox className="size-3.5" aria-hidden="true" />
              {attentionRows.length > 0 ? (
                <span
                  data-testid="remote-attention-count"
                  className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-warning px-1 text-[9px] font-semibold leading-none text-black"
                >
                  {attentionRows.length > 9 ? "9+" : attentionRows.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              aria-label="Close worktree list"
              onClick={() => onSelectorOpenChange(false)}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          {inboxOpen ? (
            <div data-testid="remote-attention-inbox" className="flex max-h-96 min-h-0 flex-col">
              <AttentionInbox rows={attentionRows} onOpen={openAttentionRow} compact />
            </div>
          ) : (<>
          <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-worktree-sidebar-border px-1">
            <button
              type="button"
              aria-label="Previous terminal tab"
              disabled={pending !== null || currentPaneIndex <= 0}
              onClick={() => {
                const prevTab = paneTabs[currentPaneIndex - 1];
                if (prevTab) selectPane(prevTab);
              }}
              className="relative flex size-6 touch-manipulation items-center justify-center rounded text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
            </button>
            <span
              className="px-1 text-[11px] font-mono font-medium text-muted-foreground select-none"
              aria-label={`Terminal position: Tab ${currentPaneOrdinal} of ${paneTabs.length}`}
            >
              {currentPaneOrdinal} / {paneTabs.length}
            </span>
            <button
              type="button"
              aria-label="Next terminal tab"
              disabled={pending !== null || currentPaneIndex >= paneTabs.length - 1}
              onClick={() => {
                const nextTab = paneTabs[currentPaneIndex + 1];
                if (nextTab) selectPane(nextTab);
              }}
              className="relative flex size-6 touch-manipulation items-center justify-center rounded text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <div
            role="tablist"
            aria-label="Terminal tabs"
            className="min-h-0 max-h-96 overflow-y-auto overflow-x-hidden p-1.5 scrollbar-sleek"
          >
            {pickerStatus}
            {groupedOptions.length === 0 ? (
              pickerStatus ? null : (
                <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                  No selectable desktop worktrees are available.
                </p>
              )
            ) : (
              groupedOptions.map(([groupKey, { label: groupLabel, options }]) => {
                const projectAttention = options.reduce<"working" | "waiting" | "done" | undefined>((acc, opt) => {
                  if (!opt.attention) return acc;
                  if (!acc || attentionRank(opt.attention) > attentionRank(acc)) return opt.attention;
                  return acc;
                }, undefined);

                return (
                  <section key={groupKey} className="mb-0.5 last:mb-0" aria-label={groupLabel}>
                    <div className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-worktree-sidebar-foreground/65">
                      <h3 className="min-w-0 flex-1 truncate" title={groupLabel}>{groupLabel}</h3>
                      {projectAttention === "working" ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="size-3 animate-spin text-status-working motion-reduce:animate-none"
                        />
                      ) : projectAttention === "waiting" ? (
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full bg-status-warning ring-2 ring-status-warning/20"
                        />
                      ) : projectAttention === "done" ? (
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full bg-status-success"
                        />
                      ) : null}
                    </div>
                    <div>
                      {options.map((option) => {
                        const active = isCurrentOption(option, model.context, activeMachineId);
                        const loading = pending
                          ? (pending.machineId ?? null) === (option.machineId ?? null) &&
                            pending.workspaceId === option.workspaceId &&
                            pending.worktreeSlug === option.worktreeSlug &&
                            pending.worktreeLabel === option.worktreeLabel &&
                            pending.sessionId === option.sessionId
                          : false;
                        const worktree = option.worktreeLabel ?? option.worktreeSlug;
                        const panes = panesByOption.get(optionRowKey(option)) ?? [];
                        return (
                          <div key={optionRowKey(option)}>
                            <button
                              type="button"
                              aria-current={active ? "true" : undefined}
                              aria-label={optionName(option)}
                              disabled={pending !== null}
                              onClick={() => {
                                onSelectorOpenChange(false);
                                onSelect(option);
                                focusTerminalInput();
                              }}
                              className={`flex min-h-[28px] w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 ${
                                active ? "bg-worktree-sidebar-accent text-foreground" : "text-worktree-sidebar-foreground hover:bg-white/[0.04]"
                              }`}
                            >
                              {loading ? (
                                <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                              ) : option.attention === "working" ? (
                                <LoaderCircle
                                  aria-hidden="true"
                                  data-testid="worktree-working-indicator"
                                  className="size-3 shrink-0 animate-spin text-status-working motion-reduce:animate-none"
                                />
                              ) : option.attention === "waiting" ? (
                                <span
                                  aria-hidden="true"
                                  data-testid="worktree-waiting-indicator"
                                  className="size-2 shrink-0 rounded-full bg-status-warning ring-2 ring-status-warning/20"
                                />
                              ) : option.attention === "done" ? (
                                <span
                                  aria-hidden="true"
                                  data-testid="worktree-done-indicator"
                                  className="size-2 shrink-0 rounded-full bg-status-success"
                                />
                              ) : option.sessionId ? (
                                <TerminalIcon className="size-3 shrink-0 opacity-70" aria-hidden="true" />
                              ) : (
                                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-status-idle" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight">
                                {option.sessionLabel ?? worktree ?? "Primary worktree"}
                              </span>
                              {active ? <Check className="size-3 shrink-0" aria-label="Active" /> : null}
                            </button>
                            {panes.length > 0 ? (
                              <div className="mt-px">{panes.map((tab) => renderPaneRow(tab, model.context.worktreeLabel))}</div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          {orphanPanes.length > 0 ? (
            <section className="mb-0.5 last:mb-0" aria-label="Other panes">
              <div className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-worktree-sidebar-foreground/65">
                <h3 className="min-w-0 flex-1 truncate">Other panes</h3>
              </div>
              <div>{orphanPanes.map((tab) => renderPaneRow(tab, model.context.worktreeLabel))}</div>
            </section>
          ) : null}
          </div>
          </>)}
          <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-t border-worktree-sidebar-border px-1.5">
            {onOpenHosts ? (
              <IconButton label="Machines" onClick={onOpenHosts}>
                <Server className="size-3.5" aria-hidden="true" />
              </IconButton>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1">
              {onCreateWorktree ? (
                <IconButton
                  label="New worktree"
                  disabled={pending !== null || !model.context.workspaceId}
                  onClick={onCreateWorktree}
                >
                  <GitBranch className="size-3.5" aria-hidden="true" />
                </IconButton>
              ) : null}
              {onCreateTerminal ? (
                <IconButton
                  label="New terminal tab"
                  disabled={pending !== null || !model.context.workspaceId}
                  onClick={onCreateTerminal}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {creationError ? <p role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">{creationError}</p> : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {children ? (
          children
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-lg border border-border bg-input text-muted-foreground">
                <TerminalIcon className="size-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-sm font-semibold text-foreground">No focused terminal</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {model.context.terminalTabs && model.context.terminalTabs.length > 0
                  ? "Pick a terminal from the list above to mirror it here. Browser tabs stay private."
                  : "Open a terminal in Ferryx Desktop to mirror it here. Browser tabs stay private."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
