import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STEP_ORDER,
  ONBOARDING_VERSION,
  OPEN_ONBOARDING_EVENT,
  PERMISSION_PRIORITY,
  dismissOnboarding,
  isOnboardingStepSatisfied,
  loadOnboardingState,
  markOnboardingStepsCompleted,
  pendingOnboardingSteps,
  rerunOnboardingSteps,
  resetOnboarding,
  saveOnboardingState,
  shouldAutoOpenOnboarding,
  visiblePermissionKeys,
  type OnboardingContext,
  type OnboardingState,
} from "./onboarding";
import {
  ONBOARDING_STORAGE_KEY,
  PERMISSIONS_ONBOARDING_DISMISSED_STORAGE_KEY,
} from "./storageKeys";
import type { CliLauncherStatus, SystemPermissionsStatus } from "./types";

function createMockStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: store.size,
  };
}

const macosPermissionsStatus: SystemPermissionsStatus = {
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
    status: "not_determined",
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

const macosAllGrantedStatus: SystemPermissionsStatus = {
  platform: "macos",
  allGranted: true,
  fullDiskAccess: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Full disk access.",
  },
  accessibility: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Accessibility.",
  },
  notifications: {
    status: "granted",
    granted: true,
    canRequest: false,
    canOpenSettings: true,
    description: "Notifications.",
  },
};

const windowsPermissionsStatus: SystemPermissionsStatus = {
  platform: "windows",
  allGranted: false,
  fullDiskAccess: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Unsupported on Windows",
  },
  accessibility: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Unsupported on Windows",
  },
  notifications: {
    status: "unknown",
    granted: false,
    canRequest: false,
    canOpenSettings: true,
    description: "Managed by Windows",
  },
};

const linuxPermissionsStatus: SystemPermissionsStatus = {
  platform: "linux",
  allGranted: false,
  fullDiskAccess: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Unsupported on Linux",
  },
  accessibility: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Unsupported on Linux",
  },
  notifications: {
    status: "unknown",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Managed by desktop environment",
  },
};

const webPermissionsStatus: SystemPermissionsStatus = {
  platform: "web",
  allGranted: false,
  fullDiskAccess: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Unsupported",
  },
  accessibility: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Unsupported",
  },
  notifications: {
    status: "unsupported",
    granted: false,
    canRequest: false,
    canOpenSettings: false,
    description: "Unsupported",
  },
};

const cliInstalled: CliLauncherStatus = {
  launcherPath: "/usr/local/bin/ferryx",
  isInstalled: true,
  isSymlink: true,
  currentTarget: "/Applications/Ferryx.app/Contents/MacOS/ferryx",
  activeExecutable: "/Applications/Ferryx.app/Contents/MacOS/ferryx",
  isSupported: true,
};

const cliNotInstalled: CliLauncherStatus = {
  launcherPath: "/usr/local/bin/ferryx",
  isInstalled: false,
  isSymlink: false,
  currentTarget: null,
  activeExecutable: null,
  isSupported: true,
};

const cliUnsupported: CliLauncherStatus = {
  launcherPath: "",
  isInstalled: false,
  isSymlink: false,
  currentTarget: null,
  activeExecutable: null,
  isSupported: false,
};

describe("onboarding exports and constants", () => {
  it("exports expected constants and step order", () => {
    expect(ONBOARDING_VERSION).toBe(1);
    expect(ONBOARDING_STEP_ORDER).toEqual([
      "intro",
      "permissions",
      "agents",
      "project",
    ]);
    expect(OPEN_ONBOARDING_EVENT).toBe("ferryx:open-onboarding");
    expect(PERMISSION_PRIORITY).toEqual({
      fullDiskAccess: "recommended",
      accessibility: "recommended",
      notifications: "optional",
    });
  });
});

describe("loadOnboardingState", () => {
  it("returns default state when storage is empty", () => {
    const storage = createMockStorage();
    expect(loadOnboardingState(storage)).toEqual({
      version: 1,
      completedSteps: [],
      dismissed: false,
    });
  });

  it("is null-safe when storage is null", () => {
    expect(loadOnboardingState(null)).toEqual({
      version: 1,
      completedSteps: [],
      dismissed: false,
    });
  });

  it("loads valid v1 state from storage", () => {
    const storage = createMockStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        version: 1,
        completedSteps: ["intro", "agents"],
        dismissed: true,
      }),
    });
    expect(loadOnboardingState(storage)).toEqual({
      version: 1,
      completedSteps: ["intro", "agents"],
      dismissed: true,
    });
  });

  it("drops unknown step ids and removes duplicate completed steps", () => {
    const storage = createMockStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        version: 1,
        completedSteps: ["intro", "future_step", "intro", "permissions"],
        dismissed: false,
      }),
    });
    expect(loadOnboardingState(storage)).toEqual({
      version: 1,
      completedSteps: ["intro", "permissions"],
      dismissed: false,
    });
  });

  it("treats malformed JSON as absent and returns default if no legacy key", () => {
    const storage = createMockStorage({
      [ONBOARDING_STORAGE_KEY]: "invalid-json{",
    });
    expect(loadOnboardingState(storage)).toEqual({
      version: 1,
      completedSteps: [],
      dismissed: false,
    });
  });

  it("treats wrong version as absent and returns default if no legacy key", () => {
    const storage = createMockStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        version: 2,
        completedSteps: ["intro"],
        dismissed: true,
      }),
    });
    expect(loadOnboardingState(storage)).toEqual({
      version: 1,
      completedSteps: [],
      dismissed: false,
    });
  });

  it("migrates from legacy key when absent, saves v1, and removes legacy key", () => {
    const storage = createMockStorage({
      [PERMISSIONS_ONBOARDING_DISMISSED_STORAGE_KEY]: "true",
    });
    const loaded = loadOnboardingState(storage);
    expect(loaded).toEqual({
      version: 1,
      completedSteps: ["intro", "permissions"],
      dismissed: false,
    });
    expect(storage.getItem(PERMISSIONS_ONBOARDING_DISMISSED_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      completedSteps: ["intro", "permissions"],
      dismissed: false,
    });
  });

  it("migrates from legacy key when v1 JSON is malformed", () => {
    const storage = createMockStorage({
      [ONBOARDING_STORAGE_KEY]: "{not valid json",
      [PERMISSIONS_ONBOARDING_DISMISSED_STORAGE_KEY]: "true",
    });
    const loaded = loadOnboardingState(storage);
    expect(loaded).toEqual({
      version: 1,
      completedSteps: ["intro", "permissions"],
      dismissed: false,
    });
    expect(storage.getItem(PERMISSIONS_ONBOARDING_DISMISSED_STORAGE_KEY)).toBeNull();
  });
});

describe("saveOnboardingState", () => {
  it("persists state to storage", () => {
    const storage = createMockStorage();
    const state: OnboardingState = {
      version: 1,
      completedSteps: ["intro", "permissions"],
      dismissed: false,
    };
    saveOnboardingState(state, storage);
    expect(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}")).toEqual(state);
  });

  it("is null-safe", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: [],
      dismissed: false,
    };
    expect(() => saveOnboardingState(state, null)).not.toThrow();
  });
});

describe("markOnboardingStepsCompleted", () => {
  it("unions completed steps in ONBOARDING_STEP_ORDER without duplicates", () => {
    const storage = createMockStorage();
    const result1 = markOnboardingStepsCompleted(["agents", "intro"], storage);
    expect(result1.completedSteps).toEqual(["intro", "agents"]);

    const result2 = markOnboardingStepsCompleted(["permissions", "intro"], storage);
    expect(result2.completedSteps).toEqual(["intro", "permissions", "agents"]);

    const stored = JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}");
    expect(stored.completedSteps).toEqual(["intro", "permissions", "agents"]);
  });
});

describe("dismissOnboarding", () => {
  it("sets dismissed: true while keeping completed steps", () => {
    const storage = createMockStorage();
    markOnboardingStepsCompleted(["intro"], storage);

    const dismissedState = dismissOnboarding(storage);
    expect(dismissedState).toEqual({
      version: 1,
      completedSteps: ["intro"],
      dismissed: true,
    });
    expect(loadOnboardingState(storage).dismissed).toBe(true);
  });
});

describe("resetOnboarding", () => {
  it("removes both v1 storage key and legacy permissions dismissed key", () => {
    const storage = createMockStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        version: 1,
        completedSteps: ["intro"],
        dismissed: true,
      }),
      [PERMISSIONS_ONBOARDING_DISMISSED_STORAGE_KEY]: "true",
    });

    resetOnboarding(storage);
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PERMISSIONS_ONBOARDING_DISMISSED_STORAGE_KEY)).toBeNull();
  });

  it("is null-safe", () => {
    expect(() => resetOnboarding(null)).not.toThrow();
  });
});

describe("visiblePermissionKeys", () => {
  it("returns empty array when status is null", () => {
    expect(visiblePermissionKeys(null)).toEqual([]);
  });

  it("returns empty array when platform is web", () => {
    expect(visiblePermissionKeys(webPermissionsStatus)).toEqual([]);
  });

  it("returns all three keys on macOS", () => {
    expect(visiblePermissionKeys(macosPermissionsStatus)).toEqual([
      "fullDiskAccess",
      "accessibility",
      "notifications",
    ]);
  });

  it("returns only notifications on Windows", () => {
    expect(visiblePermissionKeys(windowsPermissionsStatus)).toEqual([
      "notifications",
    ]);
  });

  it("returns empty array on Linux", () => {
    expect(visiblePermissionKeys(linuxPermissionsStatus)).toEqual([]);
  });
});

describe("isOnboardingStepSatisfied", () => {
  it("satisfies intro when projectCount > 0", () => {
    const baseCtx: OnboardingContext = {
      permissions: null,
      agents: null,
      cli: null,
      projectCount: 0,
    };
    expect(isOnboardingStepSatisfied("intro", baseCtx)).toBe(false);
    expect(
      isOnboardingStepSatisfied("intro", { ...baseCtx, projectCount: 1 })
    ).toBe(true);
  });

  it("satisfies project when projectCount > 0", () => {
    const baseCtx: OnboardingContext = {
      permissions: null,
      agents: null,
      cli: null,
      projectCount: 0,
    };
    expect(isOnboardingStepSatisfied("project", baseCtx)).toBe(false);
    expect(
      isOnboardingStepSatisfied("project", { ...baseCtx, projectCount: 2 })
    ).toBe(true);
  });

  it("satisfies permissions when visiblePermissionKeys is empty", () => {
    const linuxCtx: OnboardingContext = {
      permissions: linuxPermissionsStatus,
      agents: null,
      cli: null,
      projectCount: 0,
    };
    expect(isOnboardingStepSatisfied("permissions", linuxCtx)).toBe(true);

    const webCtx: OnboardingContext = {
      permissions: webPermissionsStatus,
      agents: null,
      cli: null,
      projectCount: 0,
    };
    expect(isOnboardingStepSatisfied("permissions", webCtx)).toBe(true);
  });

  it("satisfies permissions when all visible permissions are granted", () => {
    const grantedCtx: OnboardingContext = {
      permissions: macosAllGrantedStatus,
      agents: null,
      cli: null,
      projectCount: 0,
    };
    expect(isOnboardingStepSatisfied("permissions", grantedCtx)).toBe(true);
  });

  it("does not satisfy permissions when visible permissions are missing", () => {
    const missingCtx: OnboardingContext = {
      permissions: macosPermissionsStatus,
      agents: null,
      cli: null,
      projectCount: 0,
    };
    expect(isOnboardingStepSatisfied("permissions", missingCtx)).toBe(false);
  });

  it("satisfies agents only when available agent exists and cli is satisfied", () => {
    expect(
      isOnboardingStepSatisfied("agents", {
        permissions: null,
        agents: null,
        cli: cliInstalled,
        projectCount: 0,
      })
    ).toBe(false);

    expect(
      isOnboardingStepSatisfied("agents", {
        permissions: null,
        agents: [{ name: "claude", available: false }],
        cli: cliInstalled,
        projectCount: 0,
      })
    ).toBe(false);

    expect(
      isOnboardingStepSatisfied("agents", {
        permissions: null,
        agents: [{ name: "claude", available: true }],
        cli: cliNotInstalled,
        projectCount: 0,
      })
    ).toBe(false);

    expect(
      isOnboardingStepSatisfied("agents", {
        permissions: null,
        agents: [{ name: "claude", available: true }],
        cli: cliInstalled,
        projectCount: 0,
      })
    ).toBe(true);

    expect(
      isOnboardingStepSatisfied("agents", {
        permissions: null,
        agents: [{ name: "claude", available: true }],
        cli: null,
        projectCount: 0,
      })
    ).toBe(true);

    expect(
      isOnboardingStepSatisfied("agents", {
        permissions: null,
        agents: [{ name: "claude", available: true }],
        cli: cliUnsupported,
        projectCount: 0,
      })
    ).toBe(true);
  });
});

describe("pendingOnboardingSteps", () => {
  it("excludes completed and satisfied steps in ONBOARDING_STEP_ORDER", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: ["intro"],
      dismissed: false,
    };
    const ctx: OnboardingContext = {
      permissions: macosPermissionsStatus,
      agents: [{ name: "claude", available: true }],
      cli: cliInstalled,
      projectCount: 0,
    };
    expect(pendingOnboardingSteps(state, ctx)).toEqual([
      "permissions",
      "project",
    ]);
  });

  it("returns empty when all steps completed or satisfied", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: ["permissions"],
      dismissed: false,
    };
    const ctx: OnboardingContext = {
      permissions: macosPermissionsStatus,
      agents: [{ name: "claude", available: true }],
      cli: cliInstalled,
      projectCount: 1,
    };
    expect(pendingOnboardingSteps(state, ctx)).toEqual([]);
  });
});

describe("rerunOnboardingSteps", () => {
  it("returns all 4 steps on macOS where permissions are visible", () => {
    const ctx: OnboardingContext = {
      permissions: macosPermissionsStatus,
      agents: null,
      cli: null,
      projectCount: 3,
    };
    expect(rerunOnboardingSteps(ctx)).toEqual([
      "intro",
      "permissions",
      "agents",
      "project",
    ]);
  });

  it("drops permissions on Linux where visible permissions are empty", () => {
    const ctx: OnboardingContext = {
      permissions: linuxPermissionsStatus,
      agents: null,
      cli: null,
      projectCount: 0,
    };
    expect(rerunOnboardingSteps(ctx)).toEqual(["intro", "agents", "project"]);
  });
});

describe("shouldAutoOpenOnboarding", () => {
  const pendingCtx: OnboardingContext = {
    permissions: macosPermissionsStatus,
    agents: null,
    cli: null,
    projectCount: 0,
  };

  it("returns true when not dismissed with valid permissions and pending steps", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: [],
      dismissed: false,
    };
    expect(shouldAutoOpenOnboarding(state, pendingCtx)).toBe(true);
  });

  it("returns false when dismissed", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: [],
      dismissed: true,
    };
    expect(shouldAutoOpenOnboarding(state, pendingCtx)).toBe(false);
  });

  it("returns false when permissions is null", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: [],
      dismissed: false,
    };
    expect(
      shouldAutoOpenOnboarding(state, { ...pendingCtx, permissions: null })
    ).toBe(false);
  });

  it("returns false on web platform", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: [],
      dismissed: false,
    };
    expect(
      shouldAutoOpenOnboarding(state, {
        ...pendingCtx,
        permissions: webPermissionsStatus,
      })
    ).toBe(false);
  });

  it("returns false when no pending steps remain", () => {
    const state: OnboardingState = {
      version: 1,
      completedSteps: ["intro", "permissions", "agents", "project"],
      dismissed: false,
    };
    expect(shouldAutoOpenOnboarding(state, pendingCtx)).toBe(false);
  });
});
