import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RemoteApp } from "./RemoteApp";

vi.mock("./RemoteTerminal", () => ({
  RemoteTerminal: ({
    sessionId,
  }: {
    sessionId: string;
  }) => (
    <div data-testid="remote-terminal" data-session-id={sessionId}>
      Mirrored terminal {sessionId}
    </div>
  ),
}));

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

function ticketed(inner: typeof fetch): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/v1/socket-ticket")) {
      return jsonResponse({ ticket: "ui-test-ticket", expiresAt: 9999999999 });
    }
    return inner(input, init);
  }) as unknown as typeof fetch;
}

class EventWebSocket {
  static latest: EventWebSocket | null = null;
  readonly url: string;
  close = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    EventWebSocket.latest = this;
  }
}

const threadsState = {
  activeContext: {
    workspaceId: "ferryx",
    worktreeSlug: "main",
    worktreeLabel: "main",
    activeTabId: "tab-claude",
    activeTerminal: { sessionId: "sess-claude", title: "claude", running: true },
    terminalTabs: [
      { id: "tab-claude", sessionId: "sess-claude", label: "claude", agentType: "claude", activityState: "working", worktreeLabel: "main" },
      { id: "tab-dev", sessionId: "sess-dev", label: "vite dev", agentType: "shell", activityState: "waiting", worktreeLabel: "main" },
    ],
  },
};

describe("mobile remote thread entry", () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    localStorage.setItem("ferryx_remote_token", "test-token");
    vi.stubGlobal("WebSocket", EventWebSocket);
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true, writable: true });
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("mobile viewport opens the thread list instead of the terminal", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    vi.stubGlobal("fetch", ticketed(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(threadsState))));

    render(<RemoteApp />);

    expect(await screen.findByTestId("thread-row-tab-claude")).toBeInTheDocument();
    expect(screen.getByTestId("thread-row-tab-dev")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Approval")).toBeInTheDocument();
    expect(screen.queryByTestId("remote-terminal")).not.toBeInTheDocument();
  });

  it("desktop viewport still opens the terminal", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true, writable: true });
    vi.stubGlobal("fetch", ticketed(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(threadsState))));

    render(<RemoteApp />);

    expect(await screen.findByTestId("remote-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-row-tab-claude")).not.toBeInTheDocument();
  });

  it("selecting a thread row switches to the chat view", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    const request = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === "POST" ? jsonResponse({ accepted: true }) : jsonResponse(threadsState),
    );
    vi.stubGlobal("fetch", ticketed(request));

    render(<RemoteApp />);

    fireEvent.click(await screen.findByTestId("thread-row-tab-claude"));

    expect(await screen.findByTestId("mobile-chat-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("thread-row-tab-dev")).not.toBeInTheDocument();
  });
});
