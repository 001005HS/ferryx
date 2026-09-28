import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SystemPermissionsStatus } from "../../lib/types";
import { PermissionsStep } from "./PermissionsStep";

const mockTauri = vi.hoisted(() => ({
  getSystemPermissionsStatus: vi.fn(),
  openPermissionsSystemSettings: vi.fn(),
  requestAccessibilityPermission: vi.fn(),
  requestNotificationPermission: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  getSystemPermissionsStatus: () => mockTauri.getSystemPermissionsStatus(),
  openPermissionsSystemSettings: (target: string) =>
    mockTauri.openPermissionsSystemSettings(target),
  requestAccessibilityPermission: () => mockTauri.requestAccessibilityPermission(),
  requestNotificationPermission: () => mockTauri.requestNotificationPermission(),
}));

const mockMacStatusNotGranted: SystemPermissionsStatus = {
  platform: "macos",
  allGranted: false,
  fullDiskAccess: {
    status: "denied",
    granted: false,
    canRequest: false,
    canOpenSettings: true,
    description: "Full disk access needed.",
  },
  accessibility: {
    status: "denied",
    granted: false,
    canRequest: true,
    canOpenSettings: true,
    description: "Accessibility needed.",
  },
  notifications: {
    status: "denied",
    granted: false,
    canRequest: true,
    canOpenSettings: true,
    description: "Notifications needed.",
  },
};

const mockMacStatusAllGranted: SystemPermissionsStatus = {
  platform: "macos",
  allGranted: true,
  fullDiskAccess: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Full disk access granted.",
  },
  accessibility: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Accessibility granted.",
  },
  notifications: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Notifications granted.",
  },
};

const mockWindowsStatus: SystemPermissionsStatus = {
  platform: "windows",
  allGranted: false,
  fullDiskAccess: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Not supported.",
  },
  accessibility: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Not supported.",
  },
  notifications: {
    status: "unknown",
    granted: false,
    canRequest: false,
    canOpenSettings: true,
    description: "Windows manages notifications.",
  },
};

const mockLinuxStatus: SystemPermissionsStatus = {
  platform: "linux",
  allGranted: false,
  fullDiskAccess: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Not supported.",
  },
  accessibility: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Not supported.",
  },
  notifications: {
    status: "unknown",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Not supported.",
  },
};

describe("PermissionsStep", () => {
  beforeEach(() => {
    mockTauri.getSystemPermissionsStatus.mockReset();
    mockTauri.openPermissionsSystemSettings.mockReset();
    mockTauri.requestAccessibilityPermission.mockReset();
    mockTauri.requestNotificationPermission.mockReset();
    mockTauri.getSystemPermissionsStatus.mockResolvedValue(mockMacStatusNotGranted);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders macOS three cards with badges (Recommended x2, Optional) and counter", () => {
    render(<PermissionsStep initialStatus={mockMacStatusNotGranted} />);

    expect(
      screen.getByTestId("onboarding-permission-card-fullDiskAccess")
    ).toBeDefined();
    expect(
      screen.getByTestId("onboarding-permission-card-accessibility")
    ).toBeDefined();
    expect(
      screen.getByTestId("onboarding-permission-card-notifications")
    ).toBeDefined();

    const recommendedBadges = screen.getAllByText("Recommended");
    expect(recommendedBadges).toHaveLength(2);
    expect(screen.getByText("Optional")).toBeDefined();

    const counter = screen.getByTestId("onboarding-permissions-count");
    expect(counter.textContent).toBe("0 of 3 granted");

    expect(
      screen.getByText(
        "Grant these so agents, file access, and alerts work without interruptions. You can change them later in Settings > Permissions."
      )
    ).toBeDefined();
  });

  it("renders Windows with only notifications card, Managed by OS badge, and Open Windows Settings button", () => {
    render(<PermissionsStep initialStatus={mockWindowsStatus} />);

    expect(
      screen.getByTestId("onboarding-permission-card-notifications")
    ).toBeDefined();
    expect(
      screen.queryByTestId("onboarding-permission-card-fullDiskAccess")
    ).toBeNull();
    expect(
      screen.queryByTestId("onboarding-permission-card-accessibility")
    ).toBeNull();

    expect(screen.getByText("Managed by OS")).toBeDefined();
    const winSettingsBtn = screen.getByTestId(
      "onboarding-open-notifications-settings"
    );
    expect(winSettingsBtn.textContent).toContain("Open Windows Settings");
    expect(screen.queryByTestId("onboarding-permissions-count")).toBeNull();
    expect(
      screen.getByText(
        "Your operating system manages notification access for Ferryx."
      )
    ).toBeDefined();

    fireEvent.click(winSettingsBtn);
    expect(mockTauri.openPermissionsSystemSettings).toHaveBeenCalledWith(
      "notifications"
    );
  });

  it("renders Linux empty-state line with no cards", () => {
    render(<PermissionsStep initialStatus={mockLinuxStatus} />);

    expect(
      screen.getByText("No permissions need your attention on this system.")
    ).toBeDefined();
    expect(
      screen.queryByTestId("onboarding-permission-card-fullDiskAccess")
    ).toBeNull();
    expect(
      screen.queryByTestId("onboarding-permission-card-accessibility")
    ).toBeNull();
    expect(
      screen.queryByTestId("onboarding-permission-card-notifications")
    ).toBeNull();
    expect(screen.queryByTestId("onboarding-permissions-count")).toBeNull();
  });

  it("updates a badge to Granted after polling fetchStatus resolves granted", async () => {
    vi.useFakeTimers();

    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(mockMacStatusNotGranted)
      .mockResolvedValue(mockMacStatusAllGranted);

    render(
      <PermissionsStep
        initialStatus={mockMacStatusNotGranted}
        fetchStatus={fetchStatus}
      />
    );

    expect(screen.getByTestId("onboarding-permissions-count").textContent).toBe(
      "0 of 3 granted"
    );
    expect(screen.getAllByText("Recommended")).toHaveLength(2);
    expect(screen.getByText("Optional")).toBeDefined();

    await vi.advanceTimersByTimeAsync(2000);

    expect(screen.getByTestId("onboarding-permissions-count").textContent).toBe(
      "3 of 3 granted"
    );
    expect(screen.getAllByText("Granted")).toHaveLength(3);
    expect(screen.queryByText("Recommended")).toBeNull();
    expect(screen.queryByText("Optional")).toBeNull();
  });

  it("updates status when window focus event is triggered", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(mockMacStatusNotGranted)
      .mockResolvedValue(mockMacStatusAllGranted);

    render(
      <PermissionsStep
        initialStatus={mockMacStatusNotGranted}
        fetchStatus={fetchStatus}
      />
    );

    expect(screen.getByTestId("onboarding-permissions-count").textContent).toBe(
      "0 of 3 granted"
    );

    fireEvent(window, new Event("focus"));

    await waitFor(() => {
      expect(
        screen.getByTestId("onboarding-permissions-count").textContent
      ).toBe("3 of 3 granted");
    });
  });

  it("keeps last status when fetchStatus rejects", async () => {
    vi.useFakeTimers();

    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(mockMacStatusNotGranted)
      .mockRejectedValue(new Error("Network error"));

    render(
      <PermissionsStep
        initialStatus={mockMacStatusNotGranted}
        fetchStatus={fetchStatus}
      />
    );

    expect(screen.getByTestId("onboarding-permissions-count").textContent).toBe(
      "0 of 3 granted"
    );

    await vi.advanceTimersByTimeAsync(2000);

    expect(screen.getByTestId("onboarding-permissions-count").textContent).toBe(
      "0 of 3 granted"
    );
    expect(
      screen.getByTestId("onboarding-permission-card-fullDiskAccess")
    ).toBeDefined();
  });

  it("shows request-notifications error in role=alert", async () => {
    mockTauri.requestNotificationPermission.mockResolvedValueOnce({
      granted: false,
      error: "notifications require a bundled .app",
    });

    render(<PermissionsStep initialStatus={mockMacStatusNotGranted} />);

    const btn = screen.getByTestId("onboarding-request-notifications");
    fireEvent.click(btn);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("notifications require a bundled .app");
  });

  it("calls openPermissionsSystemSettings('full_disk_access') when FDA settings button clicked", () => {
    render(<PermissionsStep initialStatus={mockMacStatusNotGranted} />);
    const btn = screen.getByTestId("onboarding-open-fda-settings");
    fireEvent.click(btn);
    expect(mockTauri.openPermissionsSystemSettings).toHaveBeenCalledWith(
      "full_disk_access"
    );
  });

  it("calls requestAccessibilityPermission when accessibility request button clicked", () => {
    render(<PermissionsStep initialStatus={mockMacStatusNotGranted} />);
    const btn = screen.getByTestId("onboarding-request-accessibility");
    fireEvent.click(btn);
    expect(mockTauri.requestAccessibilityPermission).toHaveBeenCalled();
  });

  it("renders Open System Settings for accessibility when canRequest is false", () => {
    const status: SystemPermissionsStatus = {
      ...mockMacStatusNotGranted,
      accessibility: {
        ...mockMacStatusNotGranted.accessibility,
        canRequest: false,
        canOpenSettings: true,
      },
    };
    render(<PermissionsStep initialStatus={status} />);
    const btn = screen.getByTestId("onboarding-open-accessibility-settings");
    expect(btn.textContent).toContain("Open System Settings");
    fireEvent.click(btn);
    expect(mockTauri.openPermissionsSystemSettings).toHaveBeenCalledWith(
      "accessibility"
    );
  });

  it("renders Open System Settings for notifications on macOS when canRequest is false", () => {
    const status: SystemPermissionsStatus = {
      ...mockMacStatusNotGranted,
      notifications: {
        ...mockMacStatusNotGranted.notifications,
        canRequest: false,
        canOpenSettings: true,
      },
    };
    render(<PermissionsStep initialStatus={status} />);
    const btn = screen.getByTestId("onboarding-open-notifications-settings");
    expect(btn.textContent).toContain("Open System Settings");
    fireEvent.click(btn);
    expect(mockTauri.openPermissionsSystemSettings).toHaveBeenCalledWith(
      "notifications"
    );
  });
});
