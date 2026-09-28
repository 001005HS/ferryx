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
import type { PermissionItemStatus, SystemPermissionsStatus } from "../../lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

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

function renderBadge(key: PermissionKey, item: PermissionItemStatus) {
  if (item.granted) {
    return (
      <Badge
        variant="secondary"
        className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      >
        Granted
      </Badge>
    );
  }
  if (item.status === "unknown") {
    return (
      <Badge variant="outline" className="text-muted-foreground border-border">
        Managed by OS
      </Badge>
    );
  }
  const priority = PERMISSION_PRIORITY[key];
  if (priority === "recommended") {
    return (
      <Badge
        variant="destructive"
        className="bg-amber-500/15 text-amber-400 border-amber-500/30"
      >
        Recommended
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground border-border">
      Optional
    </Badge>
  );
}

export function PermissionsStep(props: PermissionsStepProps): JSX.Element {
  const [status, setStatus] = useState<SystemPermissionsStatus | null>(
    props.initialStatus
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

    const interval = setInterval(() => {
      void fetchLatestStatus();
    }, 2000);

    const handleFocus = () => {
      void fetchLatestStatus();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchLatestStatus]);

  const handleOpenSettings = useCallback(
    async (target: "full_disk_access" | "accessibility" | "notifications") => {
      try {
        await openPermissionsSystemSettings(target);
      } catch {
        void 0;
      }
    },
    []
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
            : "Notification permission request failed."
        );
      }
    }
  }, [fetchLatestStatus]);

  const isMac = status?.platform === "macos";
  const visibleKeys = visiblePermissionKeys(status);
  const grantedCount = visibleKeys.filter(
    (key) => status?.[key]?.granted === true
  ).length;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Permissions
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {isMac
            ? "Grant these so agents, file access, and alerts work without interruptions. You can change them later in Settings > Permissions."
            : "Your operating system manages notification access for Ferryx."}
        </p>
      </div>

      {isMac ? (
        <p
          data-testid="onboarding-permissions-count"
          className="text-xs font-medium text-muted-foreground"
        >
          {grantedCount} of {visibleKeys.length} granted
        </p>
      ) : null}

      {visibleKeys.length === 0 ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          No permissions need your attention on this system.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleKeys.map((key) => {
            const item = status?.[key];
            if (!item) return null;

            return (
              <Card
                key={key}
                data-testid={`onboarding-permission-card-${key}`}
                className="p-4 bg-card/60 border-border"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">
                      {TITLES[key]}
                    </span>
                    {renderBadge(key, item)}
                  </div>
                </div>

                {item.description ? (
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                ) : null}

                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {CONSEQUENCES[key]}
                </p>

                {key === "notifications" && requestError ? (
                  <p role="alert" className="mt-1.5 text-xs text-amber-400">
                    {requestError}
                  </p>
                ) : null}

                {!item.granted ? (
                  <div className="mt-3 flex justify-end gap-2">
                    {key === "fullDiskAccess" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="onboarding-open-fda-settings"
                        onClick={() => handleOpenSettings("full_disk_access")}
                        className="gap-1.5 text-xs"
                      >
                        <ExternalLink className="size-3.5" />
                        Open System Settings
                      </Button>
                    ) : null}

                    {key === "accessibility" ? (
                      item.canRequest ? (
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="onboarding-request-accessibility"
                          onClick={handleRequestAccessibility}
                          className="gap-1.5 text-xs"
                        >
                          Request Access
                        </Button>
                      ) : item.canOpenSettings ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid="onboarding-open-accessibility-settings"
                          onClick={() => handleOpenSettings("accessibility")}
                          className="gap-1.5 text-xs"
                        >
                          <ExternalLink className="size-3.5" />
                          Open System Settings
                        </Button>
                      ) : null
                    ) : null}

                    {key === "notifications" ? (
                      item.canRequest ? (
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="onboarding-request-notifications"
                          onClick={handleRequestNotifications}
                          className="gap-1.5 text-xs"
                        >
                          Enable Notifications
                        </Button>
                      ) : item.canOpenSettings ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid="onboarding-open-notifications-settings"
                          onClick={() => handleOpenSettings("notifications")}
                          className="gap-1.5 text-xs"
                        >
                          <ExternalLink className="size-3.5" />
                          {status?.platform === "windows"
                            ? "Open Windows Settings"
                            : "Open System Settings"}
                        </Button>
                      ) : null
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
