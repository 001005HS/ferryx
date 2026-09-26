import type { StructuredIpcError } from "./types";

/**
 * Ferryx only deletes worktrees it created (inside its managed jail). For any other worktree the
 * user gets the exact command to remove it, instead of a dead end.
 */
export function unmanagedWorktreeDeleteError(path: string): StructuredIpcError {
  return {
    code: "INVALID_NAMESPACE",
    message: `This worktree was not created by Ferryx, so Ferryx will not delete it. To remove it, run: git worktree remove "${path}"`,
    details: { path },
  };
}
