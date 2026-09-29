#!/usr/bin/env node
/**
 * scripts/qa/login-design-audit.mjs
 *
 * Windows Node 24 Playwright + Lighthouse design audit for Ferryx AccountLoginPage.
 * Launches Edge via playwright-core on port 9227.
 * Captures 375, 768, 1280px viewports (initial, keyboard focus, waiting, error, long-email).
 * Runs 3-pass mobile and desktop Lighthouse audits via CDP port 9227 with per-category medians.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright-core";
import lighthouse from "lighthouse";

let desktopConfig;
try {
  const mod = await import("lighthouse/core/config/desktop-config.js");
  desktopConfig = mod.default || mod;
} catch {
  desktopConfig = {
    extends: "lighthouse:default",
    settings: {
      formFactor: "desktop",
      screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 },
    },
  };
}

const DEFAULT_TARGET_URL = "http://localhost:5198";
const DEFAULT_OUT_DIR = "qa-evidence/login-design-audit";
const EDGE_EXECUTABLE = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const CDP_PORT = 9227;

const targetUrl = process.argv[2] || DEFAULT_TARGET_URL;
const outDir = resolve(process.argv[3] || DEFAULT_OUT_DIR);
mkdirSync(outDir, { recursive: true });

const summary = {
  timestamp: new Date().toISOString(),
  targetUrl,
  outDir,
  screenshots: [],
  assertions: [],
  lighthouse: {},
  passed: true,
  failures: [],
};

function recordAssertion(description, passed, details = {}) {
  summary.assertions.push({ description, passed, ...details });
  if (!passed) {
    summary.passed = false;
    summary.failures.push(`${description}: ${JSON.stringify(details)}`);
  }
}

function handleAccountApiRoute(route) {
  const url = route.request().url();
  if (url.includes("/login/request")) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, loginHandle: "a".repeat(64) }),
    });
  }
  if (url.includes("/login/poll")) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending" }),
    });
  }
  if (url.includes("/login/consume")) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, token: "mock-token", email: "user@example.com" }),
    });
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  });
}

console.log(`[audit] Launching Edge: ${EDGE_EXECUTABLE}`);
const browser = await chromium.launch({
  executablePath: EDGE_EXECUTABLE,
  headless: true,
  args: [
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
  ],
});

const pageErrors = [];
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
];

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));

    await page.route("**/api/account/v1/**", handleAccountApiRoute);

    // 1. Initial State
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    const emailInput = page.locator("#account-email-input");
    const submitBtn = page.locator("[data-testid='request-magic-link-btn']");
    await emailInput.waitFor({ state: "visible" });

    // Inspect logo
    const logoLocator = page.locator("img[alt='Ferryx']");
    await logoLocator.waitFor({ state: "visible" });
    await logoLocator.evaluate((img) => (img.decode ? img.decode() : Promise.resolve()));

    const imgInfo = await logoLocator.evaluate((img) => ({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      clientWidth: img.clientWidth,
      clientHeight: img.clientHeight,
    }));
    recordAssertion(`${vp.name}: logo natural dimensions valid`, imgInfo.naturalWidth > 0 && imgInfo.naturalHeight > 0, imgInfo);
    recordAssertion(`${vp.name}: logo size 64px (width=64, height=64)`, imgInfo.clientWidth === 64 && imgInfo.clientHeight === 64, imgInfo);

    const initialShot = join(outDir, `${vp.name}-initial.png`);
    await page.screenshot({ path: initialShot, fullPage: true });
    summary.screenshots.push({ state: "initial", viewport: vp.name, path: initialShot });

    // Inspect input font size and height
    const inputStyles = await emailInput.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        fontSizePx: parseFloat(computed.fontSize),
        height: el.offsetHeight,
      };
    });
    recordAssertion(`${vp.name}: email input font size >= 16px (no iOS auto-zoom)`, inputStyles.fontSizePx >= 16, inputStyles);
    recordAssertion(`${vp.name}: email input height 44px (touch target)`, inputStyles.height === 44, inputStyles);

    const initialCodeCount = await page.locator("[data-testid='account-code-input']").count();
    recordAssertion(`${vp.name}: no code input in initial state`, initialCodeCount === 0);

    const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    recordAssertion(`${vp.name}: no horizontal page overflow`, !docOverflow);

    // 2. Keyboard Focus via Tab
    await page.keyboard.press("Tab");
    const isEmailFocused = await emailInput.evaluate((el) => el === document.activeElement);
    if (!isEmailFocused) await emailInput.focus();
    const focusShot = join(outDir, `${vp.name}-keyboard-focus.png`);
    await page.screenshot({ path: focusShot, fullPage: true });
    summary.screenshots.push({ state: "keyboard-focus", viewport: vp.name, path: focusShot });

    // 3. Mock Request Waiting State
    await emailInput.fill("operator@example.com");
    await submitBtn.click();

    const waitingStatus = page.locator("[data-testid='magic-link-waiting']");
    await waitingStatus.waitFor({ state: "visible" });

    const waitingCodeCount = await page.locator("[data-testid='account-code-input']").count();
    recordAssertion(`${vp.name}: no code input in waiting state`, waitingCodeCount === 0);

    const waitingShot = join(outDir, `${vp.name}-mock-request-waiting.png`);
    await page.screenshot({ path: waitingShot, fullPage: true });
    summary.screenshots.push({ state: "mock-request-waiting", viewport: vp.name, path: waitingShot });

    const waitingRole = await waitingStatus.getAttribute("role");
    recordAssertion(`${vp.name}: waiting state role="status" confirmed`, waitingRole === "status");

    // Reset back via "Use a different email"
    await waitingStatus.locator("button").first().click();
    await emailInput.waitFor({ state: "visible" });

    // 4. Mock Error State
    await page.unroute("**/api/account/v1/**");
    await page.route("**/api/account/v1/**", (route) => {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "RATE_LIMITED", message: "Too many sign-in attempts. Please try again shortly." }),
      });
    });

    await emailInput.fill("operator@example.com");
    await submitBtn.click();

    const errorAlert = page.locator("[data-testid='account-login-error']");
    await errorAlert.waitFor({ state: "visible" });

    const errorRole = await errorAlert.getAttribute("role");
    recordAssertion(`${vp.name}: error has role="alert"`, errorRole === "alert");

    const errorShot = join(outDir, `${vp.name}-error.png`);
    await page.screenshot({ path: errorShot, fullPage: true });
    summary.screenshots.push({ state: "error", viewport: vp.name, path: errorShot });

    // 5. Long-Email Waiting State
    await page.unroute("**/api/account/v1/**");
    await page.route("**/api/account/v1/**", handleAccountApiRoute);

    // RFC valid: local part <= 64 chars, long overall domain
    const longEmail = "very.long.operator.identifier+tag@subdomain.organization-domain.internal-net.corp";
    await emailInput.fill(longEmail);
    await submitBtn.click();

    await waitingStatus.waitFor({ state: "visible" });
    const overflowLongEmail = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    recordAssertion(`${vp.name}: long email does not cause horizontal page overflow`, !overflowLongEmail);

    const longEmailShot = join(outDir, `${vp.name}-long-email-waiting.png`);
    await page.screenshot({ path: longEmailShot, fullPage: true });
    summary.screenshots.push({ state: "long-email-waiting", viewport: vp.name, path: longEmailShot });

    await context.close();
  }

  recordAssertion("No uncaught page errors observed", pageErrors.length === 0, { pageErrors });

  // --- Lighthouse 3-run Audits (via CDP port 9227) ---
  console.log(`[audit] Running Lighthouse via CDP port ${CDP_PORT}...`);

  async function runLighthousePass(mode) {
    const isMobile = mode === "mobile";
    const options = {
      port: CDP_PORT,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    };
    const config = isMobile ? undefined : desktopConfig;
    const runnerResult = await lighthouse(targetUrl, options, config);
    const lhr = runnerResult.lhr;

    const scores = {
      performance: Math.round((lhr.categories.performance?.score || 0) * 100),
      accessibility: Math.round((lhr.categories.accessibility?.score || 0) * 100),
      bestPractices: Math.round((lhr.categories["best-practices"]?.score || 0) * 100),
      seo: Math.round((lhr.categories.seo?.score || 0) * 100),
    };

    const failingAudits = Object.values(lhr.audits)
      .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "informative")
      .map((a) => ({ id: a.id, title: a.title, score: a.score, displayValue: a.displayValue }));

    return { scores, failingAudits, lhr };
  }

  function computeCategoryMedians(runs) {
    const categories = ["performance", "accessibility", "bestPractices", "seo"];
    const medians = {};
    for (const cat of categories) {
      const vals = runs.map((r) => r.scores[cat]).sort((a, b) => a - b);
      medians[cat] = vals[Math.floor(vals.length / 2)];
    }
    return medians;
  }

  for (const mode of ["mobile", "desktop"]) {
    console.log(`[audit] Running 3 Lighthouse passes for ${mode}...`);
    const runs = [];
    for (let i = 1; i <= 3; i++) {
      console.log(`  Pass ${i}/3 (${mode})...`);
      runs.push(await runLighthousePass(mode));
    }
    const medianScores = computeCategoryMedians(runs);
    // Representative LHR from median run closest to median performance
    const representativeRun = [...runs].sort((a, b) => Math.abs(a.scores.performance - medianScores.performance) - Math.abs(b.scores.performance - medianScores.performance))[0];

    summary.lighthouse[mode] = {
      runs: runs.map((r) => r.scores),
      medianScores,
      failingAudits: representativeRun.failingAudits,
    };

    const reportPath = join(outDir, `lighthouse-${mode}-median.json`);
    writeFileSync(reportPath, JSON.stringify(representativeRun.lhr, null, 2), "utf8");

    for (const [cat, score] of Object.entries(medianScores)) {
      const pass = score >= 100;
      recordAssertion(`Lighthouse ${mode} ${cat} score === 100`, pass, {
        actualScore: score,
        failingAudits: pass ? [] : representativeRun.failingAudits.filter((a) => a.id.toLowerCase().includes(cat.slice(0, 4))),
      });
    }
  }
} finally {
  await browser.close().catch(() => {});

  // Persist summary and markdown report unconditionally
  const summaryPath = join(outDir, "audit-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  const mdReportPath = join(outDir, "audit-report.md");
  const mdContent = `# Login Design Audit Report

Date: ${summary.timestamp}
Target URL: ${summary.targetUrl}
Overall Verdict: ${summary.passed ? "PASSED (100% Gate Met)" : "FAILED (Gate Violated)"}

## Screenshots Captured
${summary.screenshots.map((s) => `- ${s.viewport} [${s.state}]: ${s.path}`).join("\n")}

## Assertions
| Check | Status | Details |
|---|---|---|
${summary.assertions.map((a) => `| ${a.description} | ${a.passed ? "PASS" : "FAIL"} | ${a.passed ? "OK" : JSON.stringify(a)} |`).join("\n")}

## Lighthouse Scores (Median of 3 Runs)
### Mobile
- Performance: ${summary.lighthouse.mobile?.medianScores?.performance ?? "N/A"}
- Accessibility: ${summary.lighthouse.mobile?.medianScores?.accessibility ?? "N/A"}
- Best Practices: ${summary.lighthouse.mobile?.medianScores?.bestPractices ?? "N/A"}
- SEO: ${summary.lighthouse.mobile?.medianScores?.seo ?? "N/A"}

### Desktop
- Performance: ${summary.lighthouse.desktop?.medianScores?.performance ?? "N/A"}
- Accessibility: ${summary.lighthouse.desktop?.medianScores?.accessibility ?? "N/A"}
- Best Practices: ${summary.lighthouse.desktop?.medianScores?.bestPractices ?? "N/A"}
- SEO: ${summary.lighthouse.desktop?.medianScores?.seo ?? "N/A"}

${summary.failures.length > 0 ? `\n## Failures\n${summary.failures.map((f) => `- ${f}`).join("\n")}` : ""}
`;
  writeFileSync(mdReportPath, mdContent, "utf8");
}

console.log(`\n[audit] Results written to: ${join(outDir, "audit-summary.json")} and ${join(outDir, "audit-report.md")}`);
if (!summary.passed) {
  console.error(`[audit] FAILED: ${summary.failures.length} check(s) did not meet standards.`);
  process.exitCode = 1;
} else {
  console.log(`[audit] ALL CHECKS PASSED.`);
}
