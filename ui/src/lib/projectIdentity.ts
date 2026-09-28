import type { RegisteredProject, Worktree } from "./types";

/** Persisted data is untrusted: invalid remote targets must never become local. */
export function hasValidProjectTarget(project: { workspaceId: string; target?: unknown; remoteWorkspaceId?: unknown }): boolean {
  const target = project.target;
  const pairedId = project.workspaceId.startsWith("daemon:");
  if (target === undefined) return !pairedId && !project.workspaceId.startsWith("ssh:");
  if (!target || typeof target !== "object" || !("kind" in target)) return false;
  switch (target.kind) {
    case "local": return !pairedId && !project.workspaceId.startsWith("ssh:");
    case "ssh": return !pairedId && "hostId" in target &&
      typeof target.hostId === "string" && target.hostId.trim().length > 0;
    case "pairedDaemon": return /^daemon:[a-f0-9]{64}$/.test(project.workspaceId) &&
      "hostId" in target && typeof target.hostId === "string" && target.hostId.trim().length > 0 &&
      typeof project.remoteWorkspaceId === "string" && project.remoteWorkspaceId.trim().length > 0;
    default: return false;
  }
}

export function projectRootWorktree(project: RegisteredProject, hostLabel?: string): Worktree {
  const isRemote = project.target?.kind === "ssh" || project.target?.kind === "pairedDaemon";
  const withinParentGit = project.target?.kind === "ssh" && project.gitRoot !== null &&
    project.gitRoot !== undefined &&
    project.gitRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() !==
      project.repoRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const branch = withinParentGit ? null : project.gitBranch !== undefined ? project.gitBranch : null;
  const head = withinParentGit ? "" : project.gitHead ?? "";
  const detached = Boolean(head && !branch);
  const resolvedHostLabel = hostLabel ?? project.hostLabel;
  return {
    ...(isRemote ? { workspaceId: project.workspaceId, hostLabel: resolvedHostLabel } : {}),
    path: project.repoRoot,
    head,
    branch,
    bare: false,
    detached,
    locked: null,
    prunable: null,
  };
}

export function sshProjectWorktrees(project: RegisteredProject, listed: readonly Worktree[]): Worktree[] {
  const root = project.repoRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const within = listed.filter((row) => {
    const path = row.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    return path === root || path.startsWith(`${root}/`);
  });
  const rootRow = within.find((row) => row.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === root);
  return [
    rootRow ? { ...rootRow, workspaceId: project.workspaceId, path: project.repoRoot } : projectRootWorktree(project),
    ...within.filter((row) => row !== rootRow).map((row) => ({ ...row, workspaceId: project.workspaceId })),
  ];
}
