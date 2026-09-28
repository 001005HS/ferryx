import { invoke } from "@tauri-apps/api/core";

export type OpenWithApp = {
  id: string;
  name: string;
};

export type OpenWithApps = {
  apps: OpenWithApp[];
  supportsChooser: boolean;
};

export async function listOpenWithApps(path: string): Promise<OpenWithApps> {
  return invoke<OpenWithApps>("cmd_file_open_with_apps", { path });
}

export async function openWithApp(path: string, appId: string): Promise<void> {
  return invoke<void>("cmd_file_open_with", { path, appId });
}

export async function printCurrentWebview(): Promise<void> {
  return invoke<void>("cmd_webview_print");
}
