import { toast } from "sonner";
import { NOTIFICATION_PERMISSION_HINT_STORAGE_KEY } from "./storageKeys";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function showNotificationPermissionHint(
  openSettings: () => void,
  storage?: Storage | null
): boolean {
  const targetStorage = storage !== undefined ? storage : browserStorage();

  if (targetStorage) {
    try {
      const existing = targetStorage.getItem(NOTIFICATION_PERMISSION_HINT_STORAGE_KEY);
      if (existing !== null) {
        return false;
      }
    } catch {}
  }

  toast("Desktop notifications are off", {
    description: "Turn them on to hear when agents finish or need your input.",
    action: {
      label: "Open settings",
      onClick: openSettings,
    },
  });

  if (targetStorage) {
    try {
      targetStorage.setItem(NOTIFICATION_PERMISSION_HINT_STORAGE_KEY, "shown");
    } catch {}
  }

  return true;
}
