import { useSyncExternalStore } from "react";

/**
 * One-shot highlight for a pane reached from the inbox. Navigating acknowledges the session, which
 * drops its attention frame at once, so this is the only cue of where the user landed. It never
 * touches sibling panes.
 */
type Listener = () => void;

const tokens = new Map<string, number>();
const listeners = new Set<Listener>();
let nextToken = 1;

function emit(): void {
  for (const listener of listeners) listener();
}

export function flashPane(sessionId: string): void {
  // A fresh token restarts the animation on a repeat flash.
  tokens.set(sessionId, nextToken++);
  emit();
}

export function clearPaneFlash(sessionId: string, token: number): void {
  if (tokens.get(sessionId) !== token) return;
  tokens.delete(sessionId);
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePaneFlashToken(sessionId: string | null | undefined): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (sessionId ? tokens.get(sessionId) ?? null : null),
    () => null,
  );
}

export function resetPaneFlashForTests(): void {
  tokens.clear();
  emit();
}
