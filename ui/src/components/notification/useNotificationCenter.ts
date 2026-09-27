import { useSyncExternalStore } from "react";
import {
  notificationCenterStore,
  type NotificationCenterStore,
} from "../../lib/notificationCenter/notificationCenterStore";

export function useNotificationCenter(store: NotificationCenterStore = notificationCenterStore) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const unreadEntries = state.entries.filter((entry) => "unread" in entry.read);
  const unreadCount = unreadEntries.length;

  return {
    state,
    entries: unreadEntries,
    /** The durable list must keep read items visible, so the merged view reads this, not `entries`. */
    allEntries: state.entries,
    unreadCount,
    markEntriesRead: store.markEntriesRead,
    markAllRead: store.markAllRead,
    dismissEntry: store.dismissEntry,
    dismissSession: store.dismissSession,
    clearAll: store.clearAll,
  };
}
