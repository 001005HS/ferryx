// QA harness: mounts the production RemoteApp exactly as main.tsx does for the remote client.
// Account relay calls and the Noise tunnel are replaced by ./mockAccountSession (aliased only for
// imports from src/remote by scripts/qa/account-worktrees.vite.config.mjs); nothing else is faked.
import React from "react";
import ReactDOM from "react-dom/client";
import "../lib/uuid";
import "../index.css";
import "../settings-runtime.css";
import {
  QA_ACCOUNT_SESSION_TOKEN,
  clearStoredAccountSessionToken,
  installQaRecorder,
  readQaHarnessState,
  storeAccountSessionToken,
} from "./mockAccountSession";

async function boot() {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("QA harness root element #root is missing");

  const state = readQaHarnessState();
  // RemoteApp resolves the relay as the page origin when no host is saved, and only reads a
  // token whose recorded issuer is that origin, so the seed must bind to the same value.
  const relayOrigin = window.location.origin;

  // No saved hosts or device tokens: RemoteApp must start from the account-only path.
  localStorage.clear();
  clearStoredAccountSessionToken();
  storeAccountSessionToken(QA_ACCOUNT_SESSION_TOKEN, relayOrigin);
  installQaRecorder(state, relayOrigin);

  // The store was already created (and read storage) through the account module import graph.
  const { remoteHostStore } = await import("../state/remoteHostStore");
  remoteHostStore.reset();
  const { RemoteApp } = await import("../remote/RemoteApp");

  document.documentElement.dataset.qaState = state;
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <RemoteApp />
    </React.StrictMode>,
  );
}

boot().catch((error) => {
  // Surface boot failures to the runner as an uncaught page error instead of a blank page.
  queueMicrotask(() => {
    throw error;
  });
});
