import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// FERRYX_QA_UI_ROOT points at a source checkout when this config runs from another tree.
const uiRoot = path.resolve(process.env.FERRYX_QA_UI_ROOT || path.resolve(__dirname, "../../ui"));
const remoteDir = path.resolve(uiRoot, "src/remote");
const samePath = (a, b) =>
  process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

// Only the relay/tunnel modules are swapped, and only for importers inside src/remote, so the
// real RemoteApp, hooks and components run unchanged against the in-memory fake desktop.
const SCOPED_MOCKS = {
  "./accountSession": path.resolve(uiRoot, "src/qa/mockAccountSession.ts"),
  "./accountAttach": path.resolve(uiRoot, "src/qa/mockAccountAttach.ts"),
};

const qaAccountMocks = {
  name: "ferryx-qa-account-mocks",
  enforce: "pre",
  resolveId(source, importer) {
    const target = SCOPED_MOCKS[source];
    if (!target || !importer) return null;
    const importerDir = path.dirname(importer.split("?")[0]);
    return samePath(importerDir, remoteDir) ? target : null;
  },
};

// Dependencies may live outside the source tree (for example a junctioned node_modules);
// allow Vite to serve them without widening access beyond the ui root.
const extraAllow = process.env.FERRYX_QA_NODE_MODULES ? [path.resolve(process.env.FERRYX_QA_NODE_MODULES)] : [];

export default {
  root: uiRoot,
  // Own dep cache: sharing ui/node_modules/.vite with the app dev server lets either server
  // rewrite the optimized React chunks under the other, which loads two React copies.
  cacheDir: path.resolve(uiRoot, "node_modules/.vite-qa-account-worktrees"),
  plugins: [qaAccountMocks],
  // Crawl the lazily imported RemoteApp graph before the first response so the first page load
  // never triggers a mid-session re-optimize (which reloads with a new React chunk hash).
  optimizeDeps: {
    entries: ["account-worktrees-qa.html", "src/qa/**/*.{ts,tsx}", "src/remote/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    holdUntilCrawlEnd: true,
  },
  esbuild: {
    jsx: "automatic",
  },
  define: {
    __FERRYX_BUILD__: JSON.stringify("qa-account-worktrees-harness"),
  },
  resolve: {
    alias: {
      "@": path.resolve(uiRoot, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5199,
    strictPort: true,
    hmr: false,
    fs: {
      allow: [uiRoot, ...extraAllow],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "qa-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        harness: path.resolve(uiRoot, "account-worktrees-qa.html"),
      },
    },
  },
};
