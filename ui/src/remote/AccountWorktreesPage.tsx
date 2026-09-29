import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  allocateSession,
  listMachines,
  openTunnel,
  redeemInTunnel,
  requestGrant,
  type AccountMachineView,
} from "./accountSession";
import { getOrCreateAttachKey, type AttachKeyPair } from "./accountAttach";
import type { TunnelTransport } from "./attachTunnel";
import { suggestDeviceName } from "./deviceIdentity";
import { getOrCreateInstallationId } from "../lib/storageKeys";
import { normalizeRemoteWorkspaceState } from "./RemoteSessionList";

export interface DirectWorktreeConnection {
  transport: TunnelTransport;
  close: () => void;
  machine: AccountMachineView;
  deviceToken: string;
  target: {
    workspaceId: string;
    worktreeSlug: string | null;
    worktreeLabel: string | null;
  };
}

export interface AccountWorktreesPageProps {
  relayUrl: string;
  accountSessionToken: string;
  onSelectWorktree: (connection: DirectWorktreeConnection) => void;
  onLogout: () => void;
}

interface MachineTunnelState {
  transport: TunnelTransport;
  close: () => void;
  deviceToken: string;
}

interface WorktreeRowItem {
  machine: AccountMachineView;
  workspaceId: string;
  worktreeSlug: string | null;
  worktreeLabel: string | null;
}

interface MachineInventoryItem {
  machine: AccountMachineView;
  status: "idle" | "tunneling" | "ready" | "offline" | "error";
  error?: string;
  worktrees?: WorktreeRowItem[];
}

export const AccountWorktreesPage: React.FC<AccountWorktreesPageProps> = ({
  relayUrl,
  accountSessionToken,
  onSelectWorktree,
  onLogout,
}) => {
  const [machines, setMachines] = useState<AccountMachineView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [machineInventories, setMachineInventories] = useState<Record<string, MachineInventoryItem>>({});
  const tunnelsRef = useRef<Map<string, MachineTunnelState>>(new Map());
  const selectedRef = useRef<boolean>(false);
  const activeGenerationRef = useRef<number>(0);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);

  const closeAllTunnels = useCallback(() => {
    tunnelsRef.current.forEach((t) => {
      try {
        t.close();
      } catch {}
    });
    tunnelsRef.current.clear();
  }, []);

  const probeMachineInventory = useCallback(
    async (
      machine: AccountMachineView,
      attachKey: AttachKeyPair,
      isGenerationAlive: () => boolean,
    ) => {
      const isOnline = machine.online !== false;
      if (!isOnline) {
        if (isGenerationAlive()) {
          setMachineInventories((prev) => ({
            ...prev,
            [machine.machineId]: { machine, status: "offline", worktrees: [] },
          }));
        }
        return;
      }

      if (isGenerationAlive()) {
        setMachineInventories((prev) => ({
          ...prev,
          [machine.machineId]: { machine, status: "tunneling" },
        }));
      }

      let localTunnel: { transport: TunnelTransport; close: () => void } | null = null;
      let tunnelRetainedState: MachineTunnelState | null = null;

      try {
        const grant = await requestGrant(
          relayUrl,
          accountSessionToken,
          machine,
          attachKey.publicKey,
          { grantScope: "machine" },
        );
        if (!isGenerationAlive()) return;

        const session = await allocateSession(
          relayUrl,
          accountSessionToken,
          machine.machineId,
        );
        if (!isGenerationAlive()) return;

        localTunnel = await openTunnel({
          relayOrigin: grant.relayOrigin || relayUrl,
          machineId: machine.machineId,
          enrollmentEpoch: machine.enrollmentEpoch,
          machineAttachPublicKey: grant.machineAttachPublicKey,
          localKeyPair: attachKey,
          sessionId: session.sessionId,
        });
        if (!isGenerationAlive()) return;

        const pair = await redeemInTunnel(
          localTunnel.transport,
          grant.pairingToken,
          suggestDeviceName(),
          getOrCreateInstallationId(),
        );
        if (!isGenerationAlive()) return;

        const state: MachineTunnelState = {
          transport: localTunnel.transport,
          close: localTunnel.close,
          deviceToken: pair.token,
        };
        tunnelsRef.current.set(machine.machineId, state);
        tunnelRetainedState = state;

        const res = await localTunnel.transport.fetchLike("/api/v1/workspace/state", {
          headers: { Authorization: `Bearer ${pair.token}` },
        });

        if (res.status >= 200 && res.status < 300) {
          const text = new TextDecoder().decode(res.body);
          const raw = JSON.parse(text);

          const projectRows: any[] = Array.isArray(raw?.projects)
            ? raw.projects
            : Array.isArray(raw?.workspaces)
            ? raw.workspaces
            : [];

          const isolatedProjectState = {
            projects: projectRows,
          };
          const normalized = normalizeRemoteWorkspaceState(isolatedProjectState);

          const collected: WorktreeRowItem[] = [];
          const seen = new Set<string>();

          for (const opt of normalized.options) {
            const workspaceId = opt.workspaceId;
            if (!workspaceId) continue;
            const slug = opt.worktreeSlug ?? null;
            const label = opt.worktreeLabel ?? null;
            const dedupeKey = `${workspaceId}:${slug ?? ""}`;
            if (!seen.has(dedupeKey)) {
              seen.add(dedupeKey);
              collected.push({
                machine,
                workspaceId,
                worktreeSlug: slug,
                worktreeLabel: label,
              });
            }
          }

          if (isGenerationAlive()) {
            setMachineInventories((prev) => ({
              ...prev,
              [machine.machineId]: { machine, status: "ready", worktrees: collected },
            }));
          }
        } else {
          throw new Error(`Failed to load workspace state (HTTP ${res.status})`);
        }
      } catch (err) {
        if (tunnelRetainedState) {
          if (tunnelsRef.current.get(machine.machineId) === tunnelRetainedState) {
            tunnelsRef.current.delete(machine.machineId);
          }
          tunnelRetainedState = null;
        }
        if (isGenerationAlive()) {
          setMachineInventories((prev) => ({
            ...prev,
            [machine.machineId]: {
              machine,
              status: "error",
              error: err instanceof Error ? err.message : "Inventory tunnel failed",
            },
          }));
        }
      } finally {
        if (localTunnel && !tunnelRetainedState) {
          try {
            localTunnel.close();
          } catch {}
        }
      }
    },
    [accountSessionToken, relayUrl],
  );

  useEffect(() => {
    activeGenerationRef.current += 1;
    const currentGeneration = activeGenerationRef.current;
    let effectCancelled = false;

    selectedRef.current = false;
    closeAllTunnels();
    setMachineInventories({});
    setLoading(true);
    setError(null);

    const isGenerationAlive = () =>
      !effectCancelled &&
      activeGenerationRef.current === currentGeneration &&
      !selectedRef.current;

    listMachines(relayUrl, accountSessionToken)
      .then(async (data) => {
        if (!isGenerationAlive()) return;
        setMachines(data);
        setLoading(false);

        const attachKey = await getOrCreateAttachKey();
        if (!attachKey) {
          throw new Error("Failed to prepare initiator attach key");
        }

        const onlineMachines = data.filter((m) => m.online !== false);
        const offlineMachines = data.filter((m) => m.online === false);

        if (offlineMachines.length > 0 && isGenerationAlive()) {
          setMachineInventories((prev) => {
            const next = { ...prev };
            for (const off of offlineMachines) {
              next[off.machineId] = { machine: off, status: "offline", worktrees: [] };
            }
            return next;
          });
        }

        await Promise.allSettled(
          onlineMachines.map((m) => probeMachineInventory(m, attachKey, isGenerationAlive)),
        );
      })
      .catch((err) => {
        if (!isGenerationAlive()) return;
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "UNAUTHORIZED") {
          onLogout();
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load account machines");
        setLoading(false);
      });

    return () => {
      effectCancelled = true;
      if (!selectedRef.current) {
        closeAllTunnels();
      }
    };
  }, [accountSessionToken, closeAllTunnels, onLogout, probeMachineInventory, relayUrl]);

  const handleSelectWorktree = (
    machine: AccountMachineView,
    workspaceId: string,
    worktreeSlug: string | null,
    worktreeLabel: string | null,
  ) => {
    const tunnelState = tunnelsRef.current.get(machine.machineId);
    if (!tunnelState) {
      setError(`Cannot connect to ${machine.displayName || machine.machineId}: secure tunnel is not active. Please retry.`);
      return;
    }

    selectedRef.current = true;
    setConnectingKey(`${machine.machineId}:${workspaceId}:${worktreeSlug ?? ""}`);

    tunnelsRef.current.forEach((t, mid) => {
      if (mid !== machine.machineId) {
        try {
          t.close();
        } catch {}
      }
    });
    tunnelsRef.current.clear();

    onSelectWorktree({
      transport: tunnelState.transport,
      close: tunnelState.close,
      machine,
      deviceToken: tunnelState.deviceToken,
      target: {
        workspaceId,
        worktreeSlug,
        worktreeLabel,
      },
    });
  };

  const handleRetryMachine = async (machine: AccountMachineView) => {
    const retryGeneration = activeGenerationRef.current;
    const isRetryAlive = () =>
      activeGenerationRef.current === retryGeneration && !selectedRef.current;

    const inv = machineInventories[machine.machineId];
    if (inv?.status === "tunneling") return;

    try {
      const attachKey = await getOrCreateAttachKey();
      if (!attachKey || !isRetryAlive()) return;
      await probeMachineInventory(machine, attachKey, isRetryAlive);
    } catch (err) {
      if (isRetryAlive()) {
        setMachineInventories((prev) => ({
          ...prev,
          [machine.machineId]: {
            machine,
            status: "error",
            error: err instanceof Error ? err.message : "Retry failed",
          },
        }));
      }
    }
  };

  const collectedTargets: WorktreeRowItem[] = [];

  for (const m of machines) {
    const inv = machineInventories[m.machineId];
    if (inv?.status === "ready" && inv.worktrees) {
      for (const wt of inv.worktrees) {
        collectedTargets.push(wt);
      }
    }
  }

  const isProbingAny = Object.values(machineInventories).some(
    (inv) => inv.status === "tunneling",
  );

  return (
    <div
      data-testid="account-worktrees-container"
      className="flex min-h-dvh flex-col items-center justify-start p-4 sm:p-6 text-foreground bg-background"
    >
      <div className="w-full max-w-lg bg-card border border-border rounded-xl p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Worktrees
            </h2>
            <p className="text-xs text-muted-foreground">
              Select a worktree to resume your terminal workspace
            </p>
          </div>
          <button
            type="button"
            data-testid="account-logout-btn"
            onClick={onLogout}
            className="shrink-0 min-h-11 px-3 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none whitespace-nowrap"
          >
            Sign Out
          </button>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="worktree-list-error"
            className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg space-y-1"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div
            className="py-12 text-center text-xs text-muted-foreground space-y-2"
            data-testid="worktrees-loading"
          >
            <p>Discovering account worktrees...</p>
          </div>
        ) : machines.length === 0 ? (
          <div
            className="py-12 text-center text-xs text-muted-foreground"
            data-testid="worktrees-empty"
          >
            No enrolled machines found on this account.
          </div>
        ) : (
          <div className="space-y-6">
            {machines.map((machine) => {
              const inv = machineInventories[machine.machineId];
              const machineTargets = collectedTargets.filter(
                (t) => t.machine.machineId === machine.machineId,
              );
              const isOffline = machine.online === false || inv?.status === "offline";
              const isTunneling = inv?.status === "tunneling";
              const isError = inv?.status === "error";

              return (
                <div
                  key={machine.machineId}
                  data-testid={`machine-group-${machine.machineId}`}
                  className="space-y-2.5"
                >
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-foreground">
                        {machine.displayName || machine.machineId}
                      </span>
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {machine.platform || "remote"}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {isOffline ? (
                        <span
                          data-testid={`machine-status-${machine.machineId}`}
                          className="px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded"
                        >
                          offline
                        </span>
                      ) : isTunneling ? (
                        <span
                          data-testid={`machine-status-${machine.machineId}`}
                          className="px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded animate-pulse"
                        >
                          connecting...
                        </span>
                      ) : isError ? (
                        <div className="flex items-center space-x-1.5">
                          <span
                            data-testid={`machine-status-${machine.machineId}`}
                            className="px-2 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive rounded"
                          >
                            unreachable
                          </span>
                          <button
                            type="button"
                            data-testid={`retry-machine-${machine.machineId}`}
                            onClick={() => handleRetryMachine(machine)}
                            className="min-h-11 px-2 text-[10px] text-muted-foreground hover:text-foreground underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none flex items-center"
                          >
                            Retry
                          </button>
                        </div>
                      ) : (
                        <span
                          data-testid={`machine-status-${machine.machineId}`}
                          className="px-2 py-0.5 text-[10px] font-medium bg-muted text-foreground rounded"
                        >
                          online
                        </span>
                      )}
                    </div>
                  </div>

                  {isOffline ? (
                    <div className="p-3 text-xs text-muted-foreground bg-muted/20 border border-border/50 rounded-lg text-center">
                      Machine is currently offline.
                    </div>
                  ) : isTunneling ? (
                    <div className="p-4 text-xs text-muted-foreground bg-muted/10 border border-border/50 rounded-lg text-center animate-pulse">
                      Loading worktrees over secure tunnel...
                    </div>
                  ) : isError ? (
                    <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg space-y-1">
                      <p>{inv.error || "Failed to query workspace inventory"}</p>
                    </div>
                  ) : machineTargets.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground bg-muted/20 border border-border/50 rounded-lg text-center">
                      No open worktrees found on this machine.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {machineTargets.map((target) => {
                        const targetSlug = target.worktreeSlug ?? "default";
                        const rowKey = `${target.machine.machineId}-${target.workspaceId}-${targetSlug}`;
                        const isSelected = connectingKey === `${target.machine.machineId}:${target.workspaceId}:${target.worktreeSlug ?? ""}`;
                        const displayName = target.worktreeLabel || target.worktreeSlug || "default worktree";

                        return (
                          <div
                            key={rowKey}
                            data-testid={`worktree-item-${target.machine.machineId}-${target.workspaceId}-${targetSlug}`}
                            className="flex items-center justify-between p-3 border border-border rounded-lg bg-background/60 hover:bg-background hover:border-border/80 transition-colors"
                          >
                            <div className="space-y-0.5 min-w-0 pr-3 flex-1">
                              <span className="text-xs font-medium text-foreground break-words">
                                {displayName}
                              </span>
                              <p className="text-[11px] text-muted-foreground break-words">
                                {target.workspaceId}
                              </p>
                            </div>

                            <button
                              type="button"
                              data-testid={`select-worktree-${target.machine.machineId}-${target.workspaceId}-${targetSlug}`}
                              disabled={Boolean(connectingKey)}
                              onClick={() =>
                                handleSelectWorktree(
                                  target.machine,
                                  target.workspaceId,
                                  target.worktreeSlug,
                                  target.worktreeLabel,
                                )
                              }
                              className="shrink-0 min-h-11 px-4 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none flex items-center justify-center"
                            >
                              {isSelected ? "Opening..." : "Select"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {!isProbingAny && collectedTargets.length === 0 && (
              <div
                className="py-6 text-center text-xs text-muted-foreground"
                data-testid="worktrees-empty"
              >
                No active worktrees available across your online machines.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
