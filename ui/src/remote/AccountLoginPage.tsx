import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import {
  AccountSessionError,
  consumeLogin,
  isTerminalLoginPollError,
  pollLogin,
  requestLogin,
  resolveAccountOrigin,
  storeAccountSessionToken,
} from "./accountSession";

interface AccountLoginPageProps {
  relayUrl: string;
  onLoginSuccess: (token: string, email: string) => void;
}

const LOGIN_POLL_INTERVAL_MS = 2000;
const LOGIN_POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (TTL 600s)

export const AccountLoginPage: React.FC<AccountLoginPageProps> = ({
  relayUrl,
  onLoginSuccess,
}) => {
  const [email, setEmail] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const onLoginSuccessRef = useRef(onLoginSuccess);
  const consumedCodesRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    onLoginSuccessRef.current = onLoginSuccess;
  }, [onLoginSuccess]);

  const stopPolling = () => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, []);

  const startPolling = (origin: string, loginHandle: string) => {
    stopPolling();
    const startTime = Date.now();
    let inFlight = false;

    pollTimerRef.current = setInterval(async () => {
      if (!isMountedRef.current) return;
      if (inFlight) return;

      if (Date.now() - startTime >= LOGIN_POLL_TIMEOUT_MS) {
        stopPolling();
        if (!isMountedRef.current) return;
        setError("The login link has expired. Please request a new link.");
        return;
      }

      inFlight = true;
      try {
        const res = await pollLogin(origin, loginHandle);
        if (!isMountedRef.current) return;

        if (res.status === "approved" && res.token) {
          stopPolling();
          storeAccountSessionToken(res.token, origin);
          onLoginSuccessRef.current(res.token, res.email ?? "");
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;

        // Distinguish terminal from transient errors: if transient (network failure,
        // fetch TypeError, 5xx server error), leave the timer running and retry silently.
        // Stopping on a transient error would abandon a login code that may already be
        // consumed server-side once the user opened the magic link.
        if (isTerminalLoginPollError(err)) {
          stopPolling();
          if (err instanceof AccountSessionError) {
            setError(err.message);
          } else if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            typeof (err as { code: string }).code === "string"
          ) {
            const typed = err as { code: string; message?: string };
            setError(typed.message || typed.code);
          } else if (err instanceof Error) {
            setError(err.message);
          } else {
            setError("Failed to check login status");
          }
        }
        // Transient errors do NOT stop polling and do NOT set error state.
      } finally {
        inFlight = false;
      }
    }, LOGIN_POLL_INTERVAL_MS);
  };

  useEffect(() => {
    let code: string | null = null;
    const hash = window.location.hash;
    if (hash.startsWith("#code=")) {
      code = new URLSearchParams(hash.slice(1)).get("code");
    } else if (hash.startsWith("#login=")) {
      code = new URLSearchParams(hash.slice(1)).get("login");
    } else if (hash.startsWith("#account_token=")) {
      code = new URLSearchParams(hash.slice(1)).get("account_token");
    } else if (hash.length > 1) {
      const hashParams = new URLSearchParams(hash.slice(1));
      code = hashParams.get("code") ?? hashParams.get("login") ?? hashParams.get("account_token");
    }
    if (!code && window.location.search) {
      const searchParams = new URLSearchParams(window.location.search);
      code = searchParams.get("code") ?? searchParams.get("login") ?? searchParams.get("account_token");
    }

    if (code && code.trim()) {
      const trimmedCode = code.trim();
      if (consumedCodesRef.current.has(trimmedCode)) return;
      consumedCodesRef.current.add(trimmedCode);

      stopPolling();
      setLoading(true);
      setError(null);
      // The account API is not necessarily on the page origin (the desktop app
      // serves this client without an account router), so resolve it first.
      resolveAccountOrigin(relayUrl)
        .then(async (origin) => ({ origin, res: await consumeLogin(origin, trimmedCode) }))
        .then(({ origin, res }) => {
          storeAccountSessionToken(res.token, origin);
          if (window.history && typeof window.history.replaceState === "function") {
            window.history.replaceState(null, "", window.location.pathname);
          }
          window.location.hash = "";
          onLoginSuccessRef.current(res.token, res.email);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to consume login token");
          if (window.history && typeof window.history.replaceState === "function") {
            window.history.replaceState(null, "", window.location.pathname);
          }
          window.location.hash = "";
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [relayUrl]);

  const handleRequestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || loading) return;

    stopPolling();
    setLoading(true);
    setError(null);
    try {
      const origin = await resolveAccountOrigin(relayUrl);
      const res = await requestLogin(origin, email.trim());
      setCodeRequested(true);
      startPolling(origin, res.loginHandle);
    } catch (err: unknown) {
      if (err instanceof AccountSessionError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to request login link");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-rows-[1fr_auto] min-h-dvh w-full p-4 sm:p-6 lg:p-8 bg-background text-foreground">
      {/* Central balanced region: brand lockup and login card */}
      <main className="flex items-center justify-center py-6 sm:py-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
            {/* Composed brand lockup: 64px actual app icon above heading */}
            <div className="flex flex-col items-center text-center space-y-3">
              <img
                src="/icon-192.png"
                alt="Ferryx"
                width={64}
                height={64}
                className="size-16 rounded-2xl object-contain shadow-md"
              />
              <div>
                <h1 className="text-[28px] font-semibold tracking-tight text-foreground leading-tight">
                  Sign In to Ferryx
                </h1>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Access and control your remote machines securely over the encrypted tunnel.
                </p>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                data-testid="account-login-error"
                className="p-3.5 text-xs text-destructive bg-destructive/10 rounded-lg leading-relaxed"
              >
                {error}
              </div>
            )}

            {!codeRequested ? (
              <form onSubmit={handleRequestLink} className="space-y-5">
                <div className="space-y-2">
                  <label
                    htmlFor="account-email-input"
                    className="block text-xs font-medium text-foreground tracking-wide"
                  >
                    Email Address
                  </label>
                  <input
                    id="account-email-input"
                    data-testid="account-email-input"
                    type="email"
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    disabled={loading}
                    className="w-full h-11 px-3.5 py-2.5 text-base bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  data-testid="request-magic-link-btn"
                  disabled={loading || !email.trim()}
                  className="w-full h-11 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none shadow-sm flex items-center justify-center font-sans"
                >
                  {loading ? "Sending link..." : "Send Magic Link"}
                </button>
              </form>
            ) : (
              <div data-testid="magic-link-waiting" role="status" className="space-y-5 pt-1">
                <div className="flex items-start gap-3 text-left">
                  <MailCheck className="size-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    A login link was sent to <strong className="text-foreground font-medium break-all">{email}</strong>. This page will sign in automatically once the link is opened.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    stopPolling();
                    setCodeRequested(false);
                    setError(null);
                  }}
                  className="w-full h-10 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-lg flex items-center justify-center focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Use a different email
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Quiet footer anchor completing the cover pattern balance */}
      <footer className="flex items-center justify-center pb-2 sm:pb-4">
        <p className="text-xs text-muted-foreground tracking-wide">
          Ferryx Remote Access
        </p>
      </footer>
    </div>
  );
};
