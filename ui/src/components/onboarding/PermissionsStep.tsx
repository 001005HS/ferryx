import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

import {
  PERMISSION_PRIORITY,
  type PermissionKey,
  visiblePermissionKeys,
} from "../../lib/onboarding";
import {
  getSystemPermissionsStatus,
  openPermissionsSystemSettings,
  requestAccessibilityPermission,
  requestNotificationPermission,
} from "../../lib/tauri";
import type { SystemPermissionsStatus } from "../../lib/types";
import { Button } from "../ui/button";
import {
  WizardRow,
  WizardRowList,
  WizardStatus,
  type WizardStatusTone,
} from "./WizardPrimitives";

export type PermissionsStepProps = {
  initialStatus: SystemPermissionsStatus | null;
  fetchStatus?: () => Promise<SystemPermissionsStatus>;
};

const TITLES: Record<PermissionKey, string> = {
  fullDiskAccess: "Full Disk Access",
  accessibility: "Accessibility",
  notifications: "Notifications",
};

const CONSEQUENCES: Record<PermissionKey, string> = {
  fullDiskAccess:
    "Without it, agents and git can stop on macOS folder-access prompts. If the status does not change after you enable it, quit and reopen Ferryx.",
  accessibility:
    "Without it, global shortcuts and terminal focus handling are limited.",
  notifications:
    "Without it, you only see agent alerts inside the Ferryx window.",
};

export function PermissionsStep(props: PermissionsStepProps): JSX.Element {
  const [status, setStatus] = useState<SystemPermissionsStatus | null>(
    props.initialStatus,
  );
  const [requestError, setRequestError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const fetchStatusProp = props.fetchStatus;

  const fetchLatestStatus = useCallback(async () => {
    const fetcher = fetchStatusProp ?? getSystemPermissionsStatus;
    try {
      const res = await fetcher();
      if (isMountedRef.current) {
        setStatus(res);
      }
    } catch {
      void 0;
    }
  }, [fetchStatusProp]);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchLatestStatus();

    const handleFocus = () => {
      void fetchLatestStatus();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchLatestStatus();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchLatestStatus]);

  const handleOpenSettings = useCallback(
    async (target: "full_disk_access" | "accessibility" | "notifications") => {
      try {
        await openPermissionsSystemSettings(target);
      } catch {
        void 0;
      } finally {
        void fetchLatestStatus();
      }
    },
    [fetchLatestStatus],
  );

  const handleRequestAccessibility = useCallback(async () => {
    try {
      await requestAccessibilityPermission();
      void fetchLatestStatus();
    } catch {
      void 0;
    }
  }, [fetchLatestStatus]);

  const handleRequestNotifications = useCallback(async () => {
    setRequestError(null);
    try {
      const result = await requestNotificationPermission();
      if (result && "error" in result && result.error) {
        if (isMountedRef.current) {
          setRequestError(result.error);
        }
      }
      void fetchLatestStatus();
    } catch (err) {
      if (isMountedRef.current) {
        setRequestError(
          err instanceof Error
            ? err.message
            : "Notification permission request failed.",
        );
      }
    }
  }, [fetchLatestStatus]);

  const isMac = status?.platform === "macos";
  const visibleKeys = visiblePermissionKeys(status);
  const grantedCount = visibleKeys.filter(
    (key) => status?.[key]?.granted === true,
  ).length;

  return (
    <div>
      {isMac ? (
        <p
          data-testid="onboarding-permissions-count"
          className="text-[11px] text-muted-foreground mb-2"
        >
          {grantedCount} of {visibleKeys.length} granted
        </p>
      ) : null}

      {visibleKeys.length === 0 ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          No permissions need your attention on this system.
        </p>
      ) : (
        <WizardRowList>
          {visibleKeys.map((key) => {
            const item = status?.[key];
            if (!item) return null;

            let statusTone: WizardStatusTone = "neutral";
            let statusLabel = "Optional";
            if (item.granted) {
              statusTone = "success";
              statusLabel = "Granted";
            } else if (item.status === "unknown") {
              statusTone = "neutral";
              statusLabel = "Managed by OS";
            } else if (PERMISSION_PRIORITY[key] === "recommended") {
              statusTone = "warning";
              statusLabel = "Recommended";
            }

            const rowDescription = (
              <div>
                <div>
                  {item.status === "unknown" && item.description
                    ? item.description
                    : CONSEQUENCES[key]}
                </div>
                {key === "notifications" && requestError ? (
                  <p role="alert" className="mt-1 text-[11px] text-status-warning">
                    {requestError}
                  </p>
                ) : null}
              </div>
            );

            let actionSlot: JSX.Element | null = null;
            if (!item.granted) {
              if (key === "fullDiskAccess") {
                actionSlot = (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="onboarding-open-fda-settings"
                    onClick={() => handleOpenSettings("full_disk_access")}
                    className="h-7 text-[11px] gap-1.5"
                  >
                    <ExternalLink className="size-3" />
                    Open System Settings
                  </Button>
                );
              } else if (key === "accessibility") {
                if (item.canRequest) {
                  actionSlot = (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="onboarding-request-accessibility"
                      onClick={handleRequestAccessibility}
                      className="h-7 text-[11px]"
                    >
                      Request access
                    </Button>
                  );
                } else if (item.canOpenSettings) {
                  actionSlot = (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="onboarding-open-accessibility-settings"
                      onClick={() => handleOpenSettings("accessibility")}
                      className="h-7 text-[11px] gap-1.5"
                    >
                      <ExternalLink className="size-3" />
                      Open System Settings
                    </Button>
                  );
                }
              } else if (key === "notifications") {
                if (item.canRequest) {
                  actionSlot = (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="onboarding-request-notifications"
                      onClick={handleRequestNotifications}
                      className="h-7 text-[11px]"
                    >
                      Enable notifications
                    </Button>
                  );
                } else if (item.canOpenSettings) {
                  actionSlot = (
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="onboarding-open-notifications-settings"
                      onClick={() => handleOpenSettings("notifications")}
                      className="h-7 text-[11px] gap-1.5"
                    >
                      <ExternalLink className="size-3" />
                      {status?.platform === "windows"
                        ? "Open Windows Settings"
                        : "Open System Settings"}
                    </Button>
                  );
                }
              }
            }

            return (
              <WizardRow
                key={key}
                testId={`onboarding-permission-card-${key}`}
                title={TITLES[key]}
                description={rowDescription}
                status={<WizardStatus tone={statusTone} label={statusLabel} />}
                action={actionSlot}
              />
            );
          })}
        </WizardRowList>
      )}
    </div>
  );
}
