import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerPushSubscription, SERVICE_WORKER_PATH } from "./pushSubscription";

const SHIPPED_SERVICE_WORKER = "/sw.js";
/** jsdom replaces the global URL class, so fs checks need a plain string path. */
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");

const restorers: Array<() => void> = [];

function stubProperty(target: object, key: string, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  restorers.push(() => {
    if (original) {
      Object.defineProperty(target, key, original);
      return;
    }
    Reflect.deleteProperty(target, key);
  });
}

/** jsdom exposes neither a Secure Context flag nor Service Worker globals. */
function installPushCapableBrowser(register: (path: string) => Promise<unknown>, ready: Promise<never>): void {
  stubProperty(window, "isSecureContext", true);
  stubProperty(window, "PushManager", class PushManager {});
  stubProperty(navigator, "serviceWorker", { ready, register });
}

afterEach(() => {
  while (restorers.length > 0) {
    restorers.pop()?.();
  }
  vi.unstubAllGlobals();
});

describe("pushSubscription service worker registration", () => {
  it("names the service worker the app ships", () => {
    expect(SERVICE_WORKER_PATH).toBe(SHIPPED_SERVICE_WORKER);
    expect(existsSync(join(PUBLIC_DIR, SERVICE_WORKER_PATH.replace(/^\//, "")))).toBe(true);
  });

  it("registers the shipped service worker when serviceWorker.ready rejects", async () => {
    const registration = {
      pushManager: {
        getSubscription: async () => ({
          toJSON: () => ({
            endpoint: "https://push.example.test/subscription",
            keys: { p256dh: "p256dh-key", auth: "auth-key" },
          }),
        }),
      },
    };
    const register = vi.fn(async () => registration);
    installPushCapableBrowser(register, Promise.reject(new Error("no active service worker")));
    stubProperty(globalThis, "fetch", vi.fn(async () => ({ ok: true })));

    await expect(registerPushSubscription("https://gateway.example.test")).resolves.toBe(true);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(SHIPPED_SERVICE_WORKER);
  });
});
