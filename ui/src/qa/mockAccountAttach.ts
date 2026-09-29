// QA-only stand-in for ./accountAttach (aliased by scripts/qa/account-worktrees.vite.config.mjs).
// Everything except key creation is the real module; the fixed key keeps the harness off IndexedDB/WebCrypto.
import type { AttachKeyPair } from "../remote/accountAttach";

export * from "../remote/accountAttach";

export const QA_ATTACH_KEY: AttachKeyPair = {
  publicKey: "qa-initiator-attach-public-key",
  privateKey: "qa-initiator-attach-private-key",
};

export async function getOrCreateAttachKey(): Promise<AttachKeyPair> {
  return QA_ATTACH_KEY;
}
