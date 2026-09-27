import React, { useMemo, useState } from "react";
import { Check, Terminal } from "lucide-react";
import { cn } from "../../lib/cn";
import { isMonochromeAgentLogo, resolveAgentLogo } from "../../lib/agentIcon";

export interface ThreadListRow {
  readonly id: string;
  readonly title: string;
  readonly worktreeLabel?: string | null;
  readonly agentLabel?: string | null;
  readonly agentType?: string | null;
  readonly status?: "working" | "waiting" | "done";
  readonly relativeTime?: string | null;
}

export interface MobileChatThreadListProps {
  readonly rows: readonly ThreadListRow[];
  readonly activeRowId?: string | null;
  readonly onSelectRow: (row: ThreadListRow) => void;
  readonly workspaceLabel?: string | null;
  readonly className?: string;
}

const STATUS_LABEL: Partial<Record<NonNullable<ThreadListRow["status"]>, string>> = {
  working: "Working",
  waiting: "Approval",
};

const STATUS_COLOR: Partial<Record<NonNullable<ThreadListRow["status"]>, string>> = {
  working: "text-[#4bb8f0]",
  waiting: "text-[#ffb900]",
};

type ThreadGroup = {
  readonly name: string;
  count: number;
  rows: ThreadListRow[];
};

function metaText(row: ThreadListRow): string {
  return [row.worktreeLabel, row.agentLabel].filter(Boolean).join(" · ");
}

function searchableText(row: ThreadListRow): string {
  const statusLabel = row.status ? STATUS_LABEL[row.status] ?? "" : "";
  return `${row.title} ${metaText(row)} ${statusLabel}`.toLowerCase();
}

export const MobileChatThreadList: React.FC<MobileChatThreadListProps> = ({
  rows,
  activeRowId,
  onSelectRow,
  className,
}) => {
  const [query, setQuery] = useState("");
  const hasQuery = query.trim().length > 0;

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => searchableText(row).includes(normalized));
  }, [query, rows]);

  const groups = useMemo(() => {
    if (hasQuery) return null;
    const ordered: ThreadGroup[] = [];
    const byName = new Map<string, ThreadGroup>();
    for (const row of filteredRows) {
      const name = row.worktreeLabel ?? "unknown";
      let group = byName.get(name);
      if (!group) {
        group = { name, count: 0, rows: [] };
        byName.set(name, group);
        ordered.push(group);
      }
      group.count += 1;
      group.rows.push(row);
    }
    return ordered;
  }, [filteredRows, hasQuery]);

  const renderRow = (row: ThreadListRow) => {
    const active = row.id === activeRowId;
    const meta = metaText(row);
    const statusLabel = row.status ? STATUS_LABEL[row.status] ?? null : null;
    const worktreeName = row.worktreeLabel ?? "unknown";
    const logoUrl = resolveAgentLogo(row.agentType ?? row.agentLabel);
    return (
      <button
        key={row.id}
        type="button"
        data-testid={`thread-row-${row.id}`}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelectRow(row)}
        className={cn(
          "flex w-full flex-col px-5 py-2.5 text-left transition-colors border-b border-[#191919] hover:bg-[#141414] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          active && "bg-[#1a1b1b] rounded-xl border-b-transparent",
        )}
      >
        <div className="flex w-full items-center gap-1.5">
          <span
            data-testid="thread-row-glyph"
            className="flex size-[15px] shrink-0 items-center justify-center rounded-[2px] border border-[#191919] bg-[#111111]"
          >
            <Terminal className="size-2.5 text-[#838383]" aria-hidden="true" />
          </span>
          <span className="flex-1 truncate text-sm font-medium text-[#838383]">
            {worktreeName}
          </span>
          {statusLabel && row.status && STATUS_COLOR[row.status] ? (
            <span
              data-testid="thread-row-status"
              data-status={row.status}
              className={cn("shrink-0 text-right text-xs tabular-nums font-medium", STATUS_COLOR[row.status])}
            >
              {statusLabel}
            </span>
          ) : row.relativeTime ? (
            <span className="shrink-0 text-right text-xs tabular-nums text-[#838383]">{row.relativeTime}</span>
          ) : null}
          {logoUrl ? (
            <img
              data-testid="thread-row-provider"
              src={logoUrl}
              alt=""
              aria-hidden="true"
              className={cn("size-4 shrink-0 rounded-full object-contain", isMonochromeAgentLogo(row.agentType ?? row.agentLabel) && "opacity-70")}
            />
          ) : null}
          {active ? (
            <Check
              data-testid="thread-row-active"
              className="size-3.5 shrink-0 text-[#838383]"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <div className="mt-1 line-clamp-2 text-base font-medium text-[#f5f5f5]">
          {row.title}
        </div>
        {meta ? (
          <div className="mt-1 flex flex-row items-center gap-2 font-mono text-xs text-[#818181]">
            {meta}
          </div>
        ) : null}
      </button>
    );
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-[#0a0a0a] text-[#f5f5f5]", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups ? (
          groups.map((group) => (
            <section key={group.name} aria-label={group.name}>
              <h2
                data-testid={`thread-group-${group.name}`}
                className="mb-1.5 mt-4 flex w-full flex-row items-center gap-2.5 px-5"
              >
                <span className="text-xs font-medium text-[#818181]">{group.name}</span>
                <span className="h-px flex-1 bg-[#191919]" aria-hidden="true" />
                <span className="text-xs font-medium text-[#818181]">{group.count}</span>
              </h2>
              {group.rows.map(renderRow)}
            </section>
          ))
        ) : filteredRows.length === 0 ? (
          <p data-testid="thread-list-empty" className="px-4 py-8 text-center text-sm text-[#838383]">
            No matching threads
          </p>
        ) : (
          filteredRows.map(renderRow)
        )}
      </div>
      <div className="shrink-0 border-t border-[#191919] bg-[#0a0a0a] p-2">
        <input
          data-testid="thread-search-input"
          placeholder="Search threads"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-xl border border-[#191919] bg-[#111111] px-3 py-2 text-sm text-[#f5f5f5] placeholder:text-[#838383] focus-visible:outline-none"
        />
      </div>
    </div>
  );
};