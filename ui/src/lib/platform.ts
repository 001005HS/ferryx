export type HostPlatform = "macos" | "linux" | "windows" | "unknown";

export function getHostPlatform(): HostPlatform {
  if (typeof process !== "undefined" && process.platform) {
    if (process.platform === "darwin") return "macos";
    if (process.platform === "win32") return "windows";
    if (process.platform === "linux") return "linux";
  }
  if (typeof navigator === "undefined") return "unknown";
  const nav = navigator as {
    userAgentData?: { platform?: string };
    platform?: string;
    userAgent?: string;
  };
  const uadPlatform = nav.userAgentData?.platform ?? "";
  const legacyPlatform = nav.platform ?? "";
  const userAgent = nav.userAgent ?? "";
  const combined = `${uadPlatform} ${legacyPlatform} ${userAgent}`;

  if (/Win/i.test(combined)) return "windows";
  if (/Mac|iPhone|iPad|iPod/i.test(combined)) return "macos";
  if (/Linux/i.test(combined)) return "linux";
  return "unknown";
}

export function isInstalledBrowserCookieImportSupported(): boolean {
  const platform = getHostPlatform();
  return platform === "macos" || platform === "linux";
}

export function isMacHost(): boolean {
  return getHostPlatform() === "macos";
}

export function isWindowsHost(): boolean {
  return getHostPlatform() === "windows";
}
