import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DaemonConnectionBanner,
  type ProjectConnectionError,
} from "./DaemonConnectionBanner";

describe("DaemonConnectionBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders DAEMON_UNAVAILABLE error correctly", () => {
    const error: ProjectConnectionError = {
      code: "DAEMON_UNAVAILABLE",
      message: "Socket connection refused",
    };
    const onRetry = vi.fn();

    render(<DaemonConnectionBanner error={error} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("daemon-connection-banner")).toBeInTheDocument();
    expect(
      screen.getByText("Ferryx can't reach its background service")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your saved tabs and panes are kept. Retry, or quit and reopen Ferryx if this keeps happening."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("DAEMON_UNAVAILABLE")).toBeInTheDocument();

    const retryBtn = screen.getByTestId("daemon-connection-retry");
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders DAEMON_PROTOCOL_MISMATCH error correctly", () => {
    const error: ProjectConnectionError = {
      code: "DAEMON_PROTOCOL_MISMATCH",
      message: "Protocol version 4 does not match expected 5",
    };
    const onRetry = vi.fn();

    render(<DaemonConnectionBanner error={error} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The background service is from a different Ferryx version"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Running terminals are kept. Quit and reopen Ferryx to finish the update."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("DAEMON_PROTOCOL_MISMATCH")).toBeInTheDocument();
  });

  it("renders generic/other error code with error.message as body", () => {
    const error: ProjectConnectionError = {
      code: "PROJECT_NOT_FOUND",
      message: "The requested project path does not exist on disk.",
    };
    const onRetry = vi.fn();

    render(<DaemonConnectionBanner error={error} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn't open this project")).toBeInTheDocument();
    expect(
      screen.getByText("The requested project path does not exist on disk.")
    ).toBeInTheDocument();
    expect(screen.getByText("PROJECT_NOT_FOUND")).toBeInTheDocument();

    const retryBtn = screen.getByTestId("daemon-connection-retry");
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
