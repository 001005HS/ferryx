import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffect } from "react";
import {
  listMachines,
  AccountSessionError,
  storeAccountSessionToken,
  getStoredAccountSessionToken,
  clearStoredAccountSessionToken,
  setAccountPreferredSessionId,
  getAccountPreferredSessionId,
} from "./accountSession";
import { useAccountWorktrees } from "./useAccountWorktrees";

function boundedSignal<T>(timeoutMs = 3000) {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(() => {
    reject(new Error(`Signal timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    promise: promise.finally(() => clearTimeout(timer)),
    resolve,
    reject,
  };
}

describe("Account Worktrees Auth Classification & Session Retention Regressions", () => {
  const originalFetch = globalThis.fetch;
  const relayUrl = "https://relay.ferryx.dev";

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("Scenario (a): untyped HTML 403 is classified as LIST_MACHINES_FAILED, surfaces hook error, and PRESERVES account credentials and preferred sessions", async () => {
    storeAccountSessionToken("valid-active-session-token", relayUrl);
    setAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1", "sess1");

    expect(getStoredAccountSessionToken(relayUrl)).toBe("valid-active-session-token");
    expect(getAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1")).toBe("sess1");

    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response("<html><head><title>403 Forbidden</title></head><body>Cloudflare WAF Block</body></html>", {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "text/html" },
      })
    );

    let directError: AccountSessionError | null = null;
    try {
      await listMachines(relayUrl, "valid-active-session-token");
    } catch (err) {
      if (err instanceof AccountSessionError) {
        directError = err;
      }
    }
    expect(directError).toBeInstanceOf(AccountSessionError);
    expect(directError?.status).toBe(403);
    expect(directError?.code).toBe("LIST_MACHINES_FAILED");

    const errorSignal = boundedSignal<string>();
    const onUnauthorized = vi.fn(() => {
      clearStoredAccountSessionToken();
    });

    const { unmount } = renderHook(() => {
      const hook = useAccountWorktrees(relayUrl, "valid-active-session-token", true, onUnauthorized);
      useEffect(() => {
        if (hook.error) {
          errorSignal.resolve(hook.error);
        }
      }, [hook.error]);
      return hook;
    });

    try {
      await errorSignal.promise;
      expect(onUnauthorized).not.toHaveBeenCalled();

      expect(getStoredAccountSessionToken(relayUrl)).toBe("valid-active-session-token");
      expect(localStorage.getItem("ferryx.account.tokenOrigin")).toBe(relayUrl);
      expect(getAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1")).toBe("sess1");
    } finally {
      unmount();
    }
  });

  it("Scenario (a2): untyped plain text 401 is classified as LIST_MACHINES_FAILED and PRESERVES credentials and issuer origin", async () => {
    storeAccountSessionToken("valid-active-session-token", relayUrl);
    setAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1", "sess1");

    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response("Unauthorized Gateway Proxy", {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "text/plain" },
      })
    );

    let directError: AccountSessionError | null = null;
    try {
      await listMachines(relayUrl, "valid-active-session-token");
    } catch (err) {
      if (err instanceof AccountSessionError) {
        directError = err;
      }
    }
    expect(directError).toBeInstanceOf(AccountSessionError);
    expect(directError?.status).toBe(401);
    expect(directError?.code).toBe("LIST_MACHINES_FAILED");

    const errorSignal = boundedSignal<string>();
    const onUnauthorized = vi.fn(() => {
      clearStoredAccountSessionToken();
    });

    const { unmount } = renderHook(() => {
      const hook = useAccountWorktrees(relayUrl, "valid-active-session-token", true, onUnauthorized);
      useEffect(() => {
        if (hook.error) {
          errorSignal.resolve(hook.error);
        }
      }, [hook.error]);
      return hook;
    });

    try {
      await errorSignal.promise;
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(getStoredAccountSessionToken(relayUrl)).toBe("valid-active-session-token");
      expect(localStorage.getItem("ferryx.account.tokenOrigin")).toBe(relayUrl);
      expect(getAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1")).toBe("sess1");
    } finally {
      unmount();
    }
  });

  it("Scenario (a3): structured 403 with code UNAUTHORIZED is reclassified as LIST_MACHINES_FAILED and PRESERVES credentials", async () => {
    storeAccountSessionToken("valid-active-session-token", relayUrl);
    setAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1", "sess1");

    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "Forbidden proxy override" }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "application/json" },
      })
    );

    let directError: AccountSessionError | null = null;
    try {
      await listMachines(relayUrl, "valid-active-session-token");
    } catch (err) {
      if (err instanceof AccountSessionError) {
        directError = err;
      }
    }
    expect(directError).toBeInstanceOf(AccountSessionError);
    expect(directError?.status).toBe(403);
    expect(directError?.code).toBe("LIST_MACHINES_FAILED");

    const errorSignal = boundedSignal<string>();
    const onUnauthorized = vi.fn(() => {
      clearStoredAccountSessionToken();
    });

    const { unmount } = renderHook(() => {
      const hook = useAccountWorktrees(relayUrl, "valid-active-session-token", true, onUnauthorized);
      useEffect(() => {
        if (hook.error) {
          errorSignal.resolve(hook.error);
        }
      }, [hook.error]);
      return hook;
    });

    try {
      await errorSignal.promise;
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(getStoredAccountSessionToken(relayUrl)).toBe("valid-active-session-token");
      expect(localStorage.getItem("ferryx.account.tokenOrigin")).toBe(relayUrl);
      expect(getAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1")).toBe("sess1");
    } finally {
      unmount();
    }
  });

  it("Scenario (a4): structured 500 with code UNAUTHORIZED is reclassified as LIST_MACHINES_FAILED and PRESERVES credentials", async () => {
    storeAccountSessionToken("valid-active-session-token", relayUrl);
    setAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1", "sess1");

    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "Internal server error" }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      })
    );

    let directError: AccountSessionError | null = null;
    try {
      await listMachines(relayUrl, "valid-active-session-token");
    } catch (err) {
      if (err instanceof AccountSessionError) {
        directError = err;
      }
    }
    expect(directError).toBeInstanceOf(AccountSessionError);
    expect(directError?.status).toBe(500);
    expect(directError?.code).toBe("LIST_MACHINES_FAILED");

    const errorSignal = boundedSignal<string>();
    const onUnauthorized = vi.fn(() => {
      clearStoredAccountSessionToken();
    });

    const { unmount } = renderHook(() => {
      const hook = useAccountWorktrees(relayUrl, "valid-active-session-token", true, onUnauthorized);
      useEffect(() => {
        if (hook.error) {
          errorSignal.resolve(hook.error);
        }
      }, [hook.error]);
      return hook;
    });

    try {
      await errorSignal.promise;
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(getStoredAccountSessionToken(relayUrl)).toBe("valid-active-session-token");
      expect(localStorage.getItem("ferryx.account.tokenOrigin")).toBe(relayUrl);
      expect(getAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1")).toBe("sess1");
    } finally {
      unmount();
    }
  });

  it("Scenario (b): structured account 401 UNAUTHORIZED invokes onUnauthorized and erases credentials and preferred session", async () => {
    storeAccountSessionToken("expired-session-token", relayUrl);
    setAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1", "sess1");

    globalThis.fetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "unknown or expired session" }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      })
    );

    let directError: AccountSessionError | null = null;
    try {
      await listMachines(relayUrl, "expired-session-token");
    } catch (err) {
      if (err instanceof AccountSessionError) {
        directError = err;
      }
    }
    expect(directError).toBeInstanceOf(AccountSessionError);
    expect(directError?.status).toBe(401);
    expect(directError?.code).toBe("UNAUTHORIZED");

    const unauthorizedSignal = boundedSignal<void>();
    const onUnauthorized = vi.fn(() => {
      clearStoredAccountSessionToken();
      unauthorizedSignal.resolve();
    });

    const { unmount } = renderHook(() =>
      useAccountWorktrees(relayUrl, "expired-session-token", true, onUnauthorized)
    );

    try {
      await unauthorizedSignal.promise;
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(getStoredAccountSessionToken(relayUrl)).toBeNull();
      expect(localStorage.getItem("ferryx.account.tokenOrigin")).toBeNull();
      expect(getAccountPreferredSessionId(relayUrl, "m1", "ws1", "slug1")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("Scenario (c): downstream machine-specific 401 does NOT trigger onUnauthorized and preserves account credentials and preferred sessions", async () => {
    storeAccountSessionToken("valid-active-session-token", relayUrl);
    setAccountPreferredSessionId(relayUrl, "machine-1", "ws-1", "slug-1", "sess-12345");

    const mockMachine = {
      machineRecordId: "rec-1",
      machineId: "machine-1",
      displayName: "Desktop 1",
      publicKey: "pk-1",
      attachPublicKey: "apk-1",
      relayOrigin: relayUrl,
      platform: "darwin",
      online: true,
      enrollmentEpoch: "epoch-1",
      lastSeenAt: Date.now(),
    };

    const machineErrorSignal = boundedSignal<void>();

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/account/v1/machines/rec-1/grants")) {
        return new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "Machine grant expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/account/v1/machines")) {
        return new Response(JSON.stringify([mockMachine]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const onUnauthorized = vi.fn(() => {
      clearStoredAccountSessionToken();
    });

    const { unmount } = renderHook(() => {
      const hook = useAccountWorktrees(relayUrl, "valid-active-session-token", true, onUnauthorized);
      useEffect(() => {
        if (hook.machineStatuses["machine-1"]?.status === "error") {
          machineErrorSignal.resolve();
        }
      }, [hook.machineStatuses]);
      return hook;
    });

    try {
      await machineErrorSignal.promise;
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(getStoredAccountSessionToken(relayUrl)).toBe("valid-active-session-token");
      expect(localStorage.getItem("ferryx.account.tokenOrigin")).toBe(relayUrl);
      expect(getAccountPreferredSessionId(relayUrl, "machine-1", "ws-1", "slug-1")).toBe("sess-12345");
    } finally {
      unmount();
    }
  });
});
