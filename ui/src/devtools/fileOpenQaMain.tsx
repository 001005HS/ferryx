import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import "../index.css";
import { TabBar } from "../components/TabBar";
import { FilePreviewPane } from "../components/FilePreviewPane";
import {
  FILE_PREVIEW_COMMANDS,
  type FilePreviewKind,
  type FilePreviewPayload,
  type FilePreviewSource,
} from "../lib/filePreviewTypes";
import { createFileTabMenuHandlers } from "../lib/fileTabPaths";
import { disambiguateFileTabLabels } from "../lib/fileTabLabels";
import {
  getFilePreview,
  releaseFilePreview,
  retainFilePreview,
} from "../lib/filePreviewTabRegistry";
import { openTerminalToken } from "../lib/linkRouting";
import type { FileTab } from "../lib/types";

declare global {
  interface Window {
    __qaLog?: string[];
    isTauri?: boolean;
  }
}

if (!window.__qaLog) {
  window.__qaLog = [];
}

function logQa(event: string) {
  if (!window.__qaLog) {
    window.__qaLog = [];
  }
  window.__qaLog.push(event);
  console.info(`[file-open-qa] ${event}`);
}

mockWindows("main");
(window as unknown as { isTauri?: boolean }).isTauri = true;
(globalThis as unknown as { isTauri?: boolean }).isTauri = true;

type FixtureEntry = {
  kind: FilePreviewKind;
  text: string;
};

const MAIN_TS_CONTENT = `/**
 * Sample TypeScript file for Ferryx QA harness.
 * Demonstrates syntax highlighting, line numbering, and link handling.
 */

export interface AppConfig {
  readonly appName: string;
  readonly version: string;
  readonly port: number;
  readonly host: string;
  readonly debug: boolean;
}

export const defaultConfig: AppConfig = {
  appName: "FerryxQA",
  version: "1.0.0",
  port: 8080,
  host: "127.0.0.1",
  debug: true,
};

export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  public register<T>(name: string, service: T): void {
    if (this.services.has(name)) {
      throw new Error(\`Service \${name} is already registered.\`);
    }
    this.services.set(name, service);
  }

  public get<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(\`Service \${name} not found.\`);
    }
    return service as T;
  }

  public list(): string[] {
    return Array.from(this.services.keys());
  }
}

export function initializeApp(config: AppConfig = defaultConfig): ServiceRegistry {
  console.info(\`Initializing \${config.appName} v\${config.version}...\`);
  const registry = new ServiceRegistry();
  return registry;
}
`;

const README_MD_CONTENT = `# Ferryx Project

Welcome to the project. See the [Guide](docs/guide.md) for full instructions.

## Architecture

This application manages terminal sessions and native worktrees.
Refer to [Guide](docs/guide.md) for architectural details.

## Setup and Development

Run the test suite and launch the QA dev server to verify changes.
`;

const GUIDE_MD_CONTENT = `# Documentation Guide

This guide details the setup and configuration of Ferryx.

## Configuration

Set your environment variables and configure your workspace.

## Usage

Use the toolbar buttons to open previews and navigate between files.
`;

const DATA_CSV_CONTENT = `id,name,role,notes
1,Alice,Frontend Engineer,"Components, layouts, and tests"
2,Bob,Backend Engineer,"PTY daemon, sockets"
3,Charlie,Product Manager,"Roadmap, delivery"
4,Diana,Designer,"Design systems, tokens"
5,Evan,DevOps Engineer,"Pipelines, releases"
`;

const NB_IPYNB_CONTENT = JSON.stringify(
  {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "# Ferryx QA Notebook\n",
          "A sample Jupyter notebook fixture.",
        ],
      },
      {
        cell_type: "code",
        execution_count: 1,
        metadata: {},
        outputs: [
          {
            name: "stdout",
            output_type: "stream",
            text: ["Hello from Ferryx Notebook QA!\n"],
          },
        ],
        source: ["print('Hello from Ferryx Notebook QA!')"],
      },
    ],
    metadata: {
      language_info: {
        name: "python",
        version: "3.10",
      },
    },
    nbformat: 4,
    nbformat_minor: 4,
  },
  null,
  2,
);

const FIXTURES: Record<string, FixtureEntry> = {
  "/repo/src/main.ts": {
    kind: "text",
    text: MAIN_TS_CONTENT,
  },
  "/repo/README.md": {
    kind: "markdown",
    text: README_MD_CONTENT,
  },
  "/repo/docs/guide.md": {
    kind: "markdown",
    text: GUIDE_MD_CONTENT,
  },
  "/repo/data.csv": {
    kind: "text",
    text: DATA_CSV_CONTENT,
  },
  "/repo/nb.ipynb": {
    kind: "text",
    text: NB_IPYNB_CONTENT,
  },
};

function findFixture(reqPath: string): { resolvedPath: string; fixture: FixtureEntry } {
  if (FIXTURES[reqPath]) {
    return { resolvedPath: reqPath, fixture: FIXTURES[reqPath] };
  }
  const dotIndex = reqPath.lastIndexOf(".");
  if (dotIndex !== -1) {
    const ext = reqPath.slice(dotIndex).toLowerCase();
    for (const [fixturePath, fixture] of Object.entries(FIXTURES)) {
      if (fixturePath.toLowerCase().endsWith(ext)) {
        return { resolvedPath: fixturePath, fixture };
      }
    }
  }
  return { resolvedPath: "/repo/src/main.ts", fixture: FIXTURES["/repo/src/main.ts"] };
}

mockIPC((cmd, args) => {
  const path =
    typeof (args as { path?: unknown })?.path === "string"
      ? (args as { path: string }).path
      : undefined;
  logQa(path !== undefined ? `invoke:${cmd}:${path}` : `invoke:${cmd}`);

  if (cmd === FILE_PREVIEW_COMMANDS.open) {
    const reqPath =
      typeof (args as { path?: unknown })?.path === "string"
        ? (args as { path: string }).path
        : "";
    const { resolvedPath, fixture } = findFixture(reqPath);
    const targetLine =
      typeof (args as { line?: unknown })?.line === "number"
        ? (args as { line: number }).line
        : null;
    const targetCol =
      typeof (args as { col?: unknown })?.col === "number"
        ? (args as { col: number }).col
        : null;

    const payload: FilePreviewPayload = {
      handle: `handle:${resolvedPath}`,
      displayName: resolvedPath.split("/").pop() ?? "file",
      kind: fixture.kind,
      byteLength: new TextEncoder().encode(fixture.text).length,
      encoding: "utf-8",
      mediaType: null,
      mediaUrl: null,
      text: fixture.text,
      lineCount: fixture.text.split("\n").length,
      target: targetLine !== null ? { line: targetLine, col: targetCol } : null,
      resolvedPath,
    };
    return payload;
  }

  if (cmd === "cmd_file_preview_resolve") {
    const reqPath =
      typeof (args as { path?: unknown })?.path === "string"
        ? (args as { path: string }).path
        : "";
    const isDirectory = reqPath === "/repo/src";
    const exists = reqPath in FIXTURES || isDirectory;
    return {
      resolvedPath: reqPath,
      exists,
      isDirectory,
    };
  }

  if (cmd === "cmd_file_preview_changed") {
    return false;
  }

  if (
    cmd === FILE_PREVIEW_COMMANDS.close ||
    cmd === "cmd_file_preview_close" ||
    cmd === "cmd_file_preview_release" ||
    cmd === "cmd_file_preview_close_child"
  ) {
    return null;
  }

  return null;
});

document.documentElement.classList.remove("light");
document.documentElement.classList.add("dark");
document.documentElement.dataset.theme = "dark";

const QA_SOURCE: FilePreviewSource = {
  leafId: "qa-leaf",
  sessionId: "qa-session",
  backendSessionId: "qa-session",
  workspaceId: "qa-ws",
};

function FileOpenQaApp(): JSX.Element {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        source?: FilePreviewSource;
        request?: {
          path: string;
          backendSessionId: string;
          line: number | null;
          col: number | null;
        };
      }>;
      const request = customEvent.detail?.request;
      if (!request?.path) return;

      const targetPath = request.path;
      const tabId = `qa-${targetPath}`;
      const source = customEvent.detail?.source ?? QA_SOURCE;

      retainFilePreview(tabId, source, {
        path: targetPath,
        backendSessionId: source.backendSessionId,
        line: request.line ?? null,
        col: request.col ?? null,
      });

      setTabs((prevTabs) => {
        const existingIndex = prevTabs.findIndex((t) => t.path === targetPath);
        let nextTabs: FileTab[];

        if (existingIndex >= 0) {
          nextTabs = prevTabs.map((t, idx) =>
            idx === existingIndex
              ? { ...t, line: request.line ?? null, col: request.col ?? null }
              : t,
          );
        } else {
          const basename = targetPath.split("/").pop() ?? targetPath;
          const newTab: FileTab = {
            kind: "file",
            id: tabId,
            previewId: tabId,
            path: targetPath,
            label: basename,
            backendSessionId: "qa-session",
            line: request.line ?? null,
            col: request.col ?? null,
            workspaceId: "qa-ws",
          };
          nextTabs = [...prevTabs, newTab];
        }

        const paths = nextTabs.map((t) => t.path);
        const labels = disambiguateFileTabLabels(paths);
        return nextTabs.map((t, i) => ({
          ...t,
          label: labels[i] ?? t.label,
        }));
      });

      setActiveTabId(tabId);
    };

    window.addEventListener("ferryx:open-file-preview", handler);
    return () => {
      window.removeEventListener("ferryx:open-file-preview", handler);
    };
  }, []);

  const handleCloseTab = (idToClose: string) => {
    void releaseFilePreview(idToClose);
    setTabs((prevTabs) => {
      const nextTabs = prevTabs.filter((t) => t.id !== idToClose);
      const paths = nextTabs.map((t) => t.path);
      const labels = disambiguateFileTabLabels(paths);
      const updated = nextTabs.map((t, i) => ({
        ...t,
        label: labels[i] ?? t.label,
      }));
      setActiveTabId((currentActive) => {
        if (currentActive !== idToClose) return currentActive;
        return updated.length > 0 ? updated[updated.length - 1].id : "";
      });
      return updated;
    });
  };

  const menuHandlers = useMemo(
    () =>
      createFileTabMenuHandlers({
        tabs,
        worktreePath: "/repo",
        getController: (previewId: string) => getFilePreview(previewId),
        reveal: (p: string) => logQa("reveal:" + p),
      }),
    [tabs],
  );

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card p-2 text-xs">
        <button
          type="button"
          data-testid="qa-open-main-ts"
          className="rounded border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => {
            void openTerminalToken(
              { type: "file", path: "/repo/src/main.ts", raw: "/repo/src/main.ts" },
              { source: QA_SOURCE },
            );
          }}
        >
          Open main.ts
        </button>
        <button
          type="button"
          data-testid="qa-open-readme"
          className="rounded border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => {
            void openTerminalToken(
              { type: "file", path: "/repo/README.md", raw: "/repo/README.md" },
              { source: QA_SOURCE },
            );
          }}
        >
          Open README.md
        </button>
        <button
          type="button"
          data-testid="qa-open-csv"
          className="rounded border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => {
            void openTerminalToken(
              { type: "file", path: "/repo/data.csv", raw: "/repo/data.csv" },
              { source: QA_SOURCE },
            );
          }}
        >
          Open data.csv
        </button>
        <button
          type="button"
          data-testid="qa-open-ipynb"
          className="rounded border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => {
            void openTerminalToken(
              { type: "file", path: "/repo/nb.ipynb", raw: "/repo/nb.ipynb" },
              { source: QA_SOURCE },
            );
          }}
        >
          Open nb.ipynb
        </button>
        <button
          type="button"
          data-testid="qa-open-missing"
          className="rounded border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => {
            void openTerminalToken(
              { type: "file", path: "/repo/missing.txt", raw: "/repo/missing.txt" },
              { source: QA_SOURCE },
            );
          }}
        >
          Open missing
        </button>
        <button
          type="button"
          data-testid="qa-open-dir"
          className="rounded border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => {
            void openTerminalToken(
              { type: "file", path: "/repo/src", raw: "/repo/src" },
              { source: QA_SOURCE },
            );
          }}
        >
          Open dir
        </button>
        <button
          type="button"
          data-testid="qa-open-main-ts-line"
          className="rounded border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => {
            void openTerminalToken(
              {
                type: "file",
                path: "/repo/src/main.ts",
                raw: "/repo/src/main.ts:15:3",
                line: 15,
                col: 3,
              },
              { source: QA_SOURCE },
            );
          }}
        >
          Open main.ts:15:3
        </button>
      </div>

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={(id) => setActiveTabId(id)}
        onClose={handleCloseTab}
        onAdd={() => {}}
        filePathsForTab={menuHandlers.filePathsForTab}
        onReloadFileTab={menuHandlers.onReloadFileTab}
        onOpenFileExternally={menuHandlers.onOpenFileExternally}
        onRevealFileTab={menuHandlers.onRevealFileTab}
      />

      <main className="flex-1 min-h-0 w-full overflow-hidden">
        {activeTab ? (
          <FilePreviewPane
            key={activeTab.previewId}
            previewId={activeTab.previewId}
            path={activeTab.path}
            backendSessionId="qa-session"
            line={activeTab.line}
            col={activeTab.col}
            workspaceId="qa-ws"
          />
        ) : (
          <div
            data-testid="file-preview-empty"
            className="flex h-full w-full items-center justify-center text-sm text-muted-foreground"
          >
            No preview open
          </div>
        )}
      </main>

      <Toaster position="bottom-right" />
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<FileOpenQaApp />);
}
