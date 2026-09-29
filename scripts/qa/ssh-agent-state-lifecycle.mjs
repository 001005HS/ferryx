import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultBinary = join(
  repo,
  "remote-helper",
  "target",
  "debug",
  isWin ? "ferryx-remote-helper.exe" : "ferryx-remote-helper"
);
const binary = process.env.FERRYX_QA_HELPER_BINARY ?? defaultBinary;

async function bounded(promise, label, ms = 15_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}: timed out after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function reapChild(child, exitPromise, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(isWin ? undefined : "SIGTERM");
  try {
    await bounded(exitPromise, `reap ${label} (${child.pid})`, 3000);
  } catch {
    child.kill(isWin ? undefined : "SIGKILL");
    await bounded(exitPromise, `force reap ${label} (${child.pid})`, 3000);
  }
  console.log(JSON.stringify({ event: "child-reaped", label, pid: child.pid }));
}

function openFramedBridgeTransport(helperBinary, stateDir, label) {
  const child = spawn(
    helperBinary,
    ["bridge", "--stdio", "--root", stateDir],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  const exitPromise = once(child, "close");

  let buffered = Buffer.alloc(0);
  const output = child.stdout[Symbol.asyncIterator]();
  let stderrText = "";
  child.stderr.on("data", (d) => (stderrText += d.toString()));

  return {
    child,
    exitPromise,
    pid: child.pid,
    async request(op, params = {}) {
      const payload = Buffer.from(
        JSON.stringify({ protocol: 1, token: "", op, params })
      );
      assert(payload.length <= 1024 * 1024, "request frame exceeds 1 MiB");
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length);
      child.stdin.write(Buffer.concat([header, payload]));

      const readNext = async () => {
        while (
          buffered.length < 4 ||
          buffered.length < 4 + buffered.readUInt32BE()
        ) {
          const next = await output.next();
          assert.equal(
            next.done,
            false,
            `${op}: bridge stream closed unexpectedly. Stderr: ${stderrText}`
          );
          buffered = Buffer.concat([buffered, next.value]);
        }
        const len = buffered.readUInt32BE();
        assert(len <= 1024 * 1024, "response frame exceeds 1 MiB");
        const msg = JSON.parse(buffered.subarray(4, 4 + len).toString("utf8"));
        buffered = buffered.subarray(4 + len);
        return msg;
      };

      const reply = await bounded(readNext(), `${label} -> ${op}`);
      assert.equal(reply.ok, true, `${op} failed: ${reply.error}`);
      return reply.data;
    },
    async close() {
      child.stdin.end();
      await reapChild(child, exitPromise, label);
    },
  };
}

async function sendAgentStateReport(
  port,
  token,
  targetBackendSessionId,
  state,
  detail,
  { waitForServerClose = false } = {}
) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const socket = createConnection({ port: Number(port), host: "127.0.0.1" }, () => {
      const report = {
        type: "agentState",
        sessionId: targetBackendSessionId,
        state,
        agent: "omo",
        token,
        detail,
      };
      const payload = JSON.stringify(report) + "\n";
      if (waitForServerClose) {
        // Half-close client write side; wait for server processing and server-side socket close
        socket.end(payload, "utf8");
      } else {
        // Extension equivalence for normal reports: write and immediately destroy client socket
        socket.write(payload, "utf8", (err) => {
          if (err && !settled) {
            settled = true;
            socket.destroy();
            rejectPromise(new Error(`Agent state write failed: ${err.code || "IO_ERROR"}`));
            return;
          }
          socket.destroy();
          if (!settled) {
            settled = true;
            resolvePromise();
          }
        });
      }
    });

    socket.setTimeout(2000, () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        rejectPromise(new Error("Agent state TCP connection timed out after 2000ms"));
      }
    });

    socket.on("close", () => {
      if (waitForServerClose && !settled) {
        settled = true;
        resolvePromise();
      }
    });

    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        rejectPromise(new Error(`Agent state TCP connection error: ${err.code || "SOCKET_ERROR"}`));
      }
    });
  });
}

// ConPTY rewrites the byte stream it forwards: it hard-wraps long lines with CRLF and
// interleaves VT escape sequences, so a token can end up straddling a line break. Every
// match below therefore runs against this normalized view — OSC/CSI escapes stripped,
// then all whitespace removed — which makes a wrapped "NAME=value" contiguous again.
// The view is only ever used for matching; it is never logged (it contains the token).
function discoveryView(text) {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "")
    .replace(/\x1b[\x20-\x7e]/g, "")
    .replace(/\s+/g, "");
}

// Recognized cursor-position queries and the non-secret replies a terminal must write
// back through pty.write: ESC[6n is DSR 6 (CPR) and ESC[?6n is DECXCPR. The patterns are
// global so String.match can count occurrences; that use is stateless for them.
const CURSOR_POSITION_QUERIES = [
  { label: "ESC[6n", pattern: /\x1b\[6n/g, response: "\x1b[1;1R", responseLabel: "ESC[1;1R" },
  {
    label: "ESC[?6n",
    pattern: /\x1b\[\?6n/g,
    response: "\x1b[?1;1R",
    responseLabel: "ESC[?1;1R",
  },
];

export async function main() {
  console.log(JSON.stringify({ event: "qa-start", binary, platform: process.platform }));

  try {
    await access(binary, constants.X_OK);
  } catch {
    throw new Error(
      `Prerequisite missing: remote-helper binary not found or not executable at ${binary}. ` +
      `Build first with cargo build --manifest-path remote-helper/Cargo.toml`
    );
  }

  const fixture = await mkdtemp(join(tmpdir(), "f-state-qa-"));
  const stateDir = join(fixture, "state");
  const projectDir = join(fixture, "project");
  const hostId = `qa-state-${randomUUID().slice(0, 8)}`;

  let daemonChild = null;
  let daemonExitPromise = null;
  let bridge = null;
  let target = null;
  const cleanupErrors = [];

  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await mkdir(projectDir, { recursive: true, mode: 0o700 });
    await writeFile(join(projectDir, "dummy.txt"), "hello world\n", { mode: 0o600 });

    // 1. Directly spawn foreground helper daemon with retained process handle in unique fixture
    daemonChild = spawn(
      binary,
      ["daemon", "--root", stateDir, "--host-id", hostId],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    daemonExitPromise = once(daemonChild, "close");

    let daemonStderr = "";
    daemonChild.stderr.on("data", (d) => (daemonStderr += d.toString()));

    // Wait for the ready event on stdout
    const readyOutput = daemonChild.stdout[Symbol.asyncIterator]();
    let readyBuf = "";
    const waitForReady = async () => {
      while (!readyBuf.includes("\n")) {
        const next = await readyOutput.next();
        assert.equal(next.done, false, `daemon exited before ready: ${daemonStderr}`);
        readyBuf += next.value.toString("utf8");
      }
      const line = readyBuf.split("\n")[0].trim();
      const event = JSON.parse(line);
      assert.equal(event.event, "ready", `expected ready event, got: ${line}`);
      assert.equal(event.protocol, 1, "protocol version must be 1");
      return event;
    };
    await bounded(waitForReady(), "wait for daemon ready event", 10_000);
    console.log(JSON.stringify({ event: "daemon-ready", hostId, daemonPid: daemonChild.pid }));

    // 2. Open real framed bridge transport
    bridge = openFramedBridgeTransport(binary, stateDir, "qa-bridge");

    // 3. Handshake: wire contract must advertise agentStateV1 capability
    const handshakeReply = await bridge.request("handshake", {});
    console.log(JSON.stringify({ event: "handshake-reply", capabilities: handshakeReply.capabilities }));
    assert(
      Array.isArray(handshakeReply.capabilities),
      "handshake response must contain capabilities array"
    );
    assert(
      handshakeReply.capabilities.includes("agentStateV1"),
      `Capabilities missing agentStateV1: ${JSON.stringify(handshakeReply.capabilities)}`
    );

    // 4. Project registration (helper schema requires { id, path })
    const projectId = "qa-proj-1";
    await bridge.request("project.register", {
      id: projectId,
      path: projectDir,
    });

    // 5. Spawn PTY to inspect the injected environment. Each value is printed on its own
    //    short line followed by a unique end sentinel, so no line reaches the 80-column
    //    ConPTY wrap boundary; discovery below tolerates wrapping regardless.
    const sentinel = `ENV_SENTINEL_${randomUUID().slice(0, 10)}`;
    const portProbe = isWin
      ? "echo FERRYX_AGENT_STATE_PORT=%FERRYX_AGENT_STATE_PORT%"
      : "echo FERRYX_AGENT_STATE_PORT=$FERRYX_AGENT_STATE_PORT";
    const tokenProbe = isWin
      ? "echo FERRYX_AGENT_STATE_TOKEN=%FERRYX_AGENT_STATE_TOKEN%"
      : "echo FERRYX_AGENT_STATE_TOKEN=$FERRYX_AGENT_STATE_TOKEN";
    const holdPtyOpen = isWin ? "set /p x=" : "read -r x";
    const probeScript = [portProbe, tokenProbe, `echo ${sentinel}`, holdPtyOpen].join(
      isWin ? " & " : "; "
    );
    // Windows: /d skips cmd AutoRun scripts and /s pins cmd's /c quote stripping, because
    // portable-pty quotes argv with CRT rules (\" escaping) that cmd.exe does not honor.
    // The payload stays free of embedded quotes so /s strips exactly the outer pair.
    const spawnProgram = isWin ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
    const spawnArgs = isWin ? ["/d", "/s", "/c", probeScript] : ["-c", probeScript];

    const spawnResult = await bridge.request("pty.spawn", {
      projectId,
      worktree: ".",
      cols: 80,
      rows: 24,
      program: spawnProgram,
      args: spawnArgs,
      clientRequestId: `req-${randomUUID().slice(0, 8)}`,
    });

    assert(spawnResult.target, "spawn response missing target");
    target = spawnResult.target;
    const ptyPid = spawnResult.pid;
    console.log(JSON.stringify({ event: "pty-spawned", target, ptyPid }));

    // Minimal terminal-side DSR handling. ConPTY emits a cursor-position query and
    // withholds every byte of child output until the terminal answers it, so an
    // unanswered query shows up as a four-byte stream (ESC[6n). Answering is the
    // terminal emulator's job — in this headless harness that is us, not the helper.
    const dsrReplies = new Map();
    const answerCursorPositionQueries = async (accumulatedText) => {
      for (const query of CURSOR_POSITION_QUERIES) {
        const answered = dsrReplies.get(query.label) ?? 0;
        const seen = accumulatedText.match(query.pattern)?.length ?? 0;
        for (let sent = answered; sent < seen; sent += 1) {
          await bridge.request("pty.write", { target, text: query.response });
          console.log(
            JSON.stringify({
              event: "pty-dsr-reply",
              query: query.label,
              response: query.responseLabel,
            })
          );
        }
        if (seen > answered) dsrReplies.set(query.label, seen);
      }
    };

    // Read PTY output until the sentinel line is fully flushed.
    let cursor = "0";
    let ptyText = "";
    const readDeadline = Date.now() + 10_000;
    while (Date.now() < readDeadline) {
      const readReply = await bridge.request("pty.read", {
        target,
        cursor,
        waitMs: 1000,
      });
      cursor = readReply.cursor;
      for (const chunk of readReply.chunks || []) {
        ptyText += Buffer.from(chunk.data, "base64").toString("utf8");
      }
      await answerCursorPositionQueries(ptyText);
      if (discoveryView(ptyText).includes(sentinel)) {
        break;
      }
      if (readReply.exited) break;
    }

    const discoverable = discoveryView(ptyText);
    if (!discoverable.includes(sentinel)) {
      // Sanitized evidence only, never raw PTY text: which VT queries were recognized,
      // how many replies were written, and at most the first four bytes that preceded
      // any environment output — the token cannot appear in that window.
      const envOutputIndex = ptyText.indexOf("FERRYX_AGENT_STATE_");
      const beforeEnvOutput = envOutputIndex < 0 ? ptyText : ptyText.slice(0, envOutputIndex);
      console.log(
        JSON.stringify({
          event: "pty-sentinel-diagnostic",
          bytesRead: ptyText.length,
          recognizedQueries: [...dsrReplies.keys()],
          dsrRepliesSent: [...dsrReplies.values()].reduce((total, count) => total + count, 0),
          initialHexBeforeEnvOutput: Buffer.from(beforeEnvOutput, "utf8")
            .subarray(0, 4)
            .toString("hex"),
        })
      );
    }
    assert(
      discoverable.includes(sentinel),
      `PTY environment output did not reach sentinel within deadline (${ptyText.length} bytes read)`
    );

    // Endpoint discovery: canonical environment names, each value matching its own
    // bounded shape. Messages stay free of raw PTY text so the bearer token is never
    // echoed into QA logs.
    const portMatch = discoverable.match(/FERRYX_AGENT_STATE_PORT=(\d{1,5})/);
    const tokenMatch = discoverable.match(/FERRYX_AGENT_STATE_TOKEN=([0-9a-f]{32})/);
    assert(portMatch, "PTY environment output missing FERRYX_AGENT_STATE_PORT");
    assert(tokenMatch, "PTY environment output missing FERRYX_AGENT_STATE_TOKEN");

    const agentPort = portMatch[1];
    const agentToken = tokenMatch[1];
    assert(
      Number(agentPort) > 0 && Number(agentPort) <= 65535,
      `Invalid agent state port: ${agentPort}`
    );

    // Freeze a stable cursor boundary: consume trailing ConPTY flushes so the later
    // "cursor unchanged" assertions cannot be tripped by late bytes. The loop stops as
    // soon as a bounded read returns no new chunks; it never sleeps a fixed amount.
    let basePtyCursor = cursor;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const drainReply = await bounded(
        bridge.request("pty.read", { target, cursor: basePtyCursor, waitMs: 250 }),
        "pty.read drain"
      );
      basePtyCursor = drainReply.cursor;
      const drainChunks = drainReply.chunks || [];
      if (!drainChunks.length) break;
      for (const chunk of drainChunks) {
        ptyText += Buffer.from(chunk.data, "base64").toString("utf8");
      }
      // Keep ConPTY unblocked: a query left unanswered after the sentinel would stall
      // the PTY and break the cursor-stability assertions below.
      await answerCursorPositionQueries(ptyText);
    }
    console.log(JSON.stringify({ event: "agent-endpoint-discovered", port: agentPort, baseCursor: basePtyCursor }));

    // 6. Test initial pty.read before any report with agentAfterRevision: "0"
    const initialRead = await bridge.request("pty.read", {
      target,
      cursor: basePtyCursor,
      waitMs: 0,
      agentAfterRevision: "0",
    });
    assert.equal(
      initialRead.agentState,
      undefined,
      "agentState must be omitted before any reports are accepted"
    );
    assert.equal(
      initialRead.cursor,
      basePtyCursor,
      "PTY cursor must remain unchanged across initial agentAfterRevision read"
    );

    // 7. Auth negative assertion: send report with WRONG token and wait for server-side socket close
    // Using waitForServerClose: true proves the server handler processed and rejected the report before we assert
    await sendAgentStateReport(
      agentPort,
      "invalid-token-auth-reject",
      target.backendSessionId,
      "working",
      "unauthorized probe",
      { waitForServerClose: true }
    );
    console.log(JSON.stringify({ event: "negative-report-handled" }));

    const authNegativeRead = await bridge.request("pty.read", {
      target,
      cursor: basePtyCursor,
      waitMs: 0,
      agentAfterRevision: "0",
    });
    assert.equal(
      authNegativeRead.agentState,
      undefined,
      "agentState must remain absent when unauthorized report with invalid token is submitted"
    );
    assert.equal(
      authNegativeRead.cursor,
      basePtyCursor,
      "PTY cursor must remain unchanged after rejected report"
    );
    console.log(JSON.stringify({ event: "auth-negative-verified" }));

    // 8. Positive report 1: send report with VALID token (extension equivalence: immediate client close)
    await sendAgentStateReport(
      agentPort,
      agentToken,
      target.backendSessionId,
      "working",
      "compiling code",
      { waitForServerClose: false }
    );
    console.log(JSON.stringify({ event: "report-sent", state: "working", revision: "1" }));

    // 9. Read with agentAfterRevision: "0" -> should receive snapshot with revision 1, cursor unchanged
    const firstReportRead = await bounded(
      bridge.request("pty.read", {
        target,
        cursor: basePtyCursor,
        waitMs: 2000,
        agentAfterRevision: "0",
      }),
      "pty.read revision 1"
    );
    assert(firstReportRead.agentState, "expected agentState snapshot in response");
    assert.equal(firstReportRead.agentState.revision, "1", "revision must be 1");
    assert.equal(firstReportRead.agentState.state, "working", "state must be working");
    assert.equal(
      Object.prototype.hasOwnProperty.call(firstReportRead.agentState, "token"),
      false,
      "agentState snapshot must not echo the bearer token"
    );
    assert.equal(
      firstReportRead.cursor,
      basePtyCursor,
      "PTY cursor must remain unchanged after receiving agentState report"
    );
    console.log(JSON.stringify({ event: "snapshot-verified", revision: "1", state: "working" }));

    // 10. Deduplication check with waitMs: 0 -> should NOT resend snapshot when requested revision == current revision
    const dedupeRead = await bridge.request("pty.read", {
      target,
      cursor: basePtyCursor,
      waitMs: 0,
      agentAfterRevision: "1",
    });
    assert.equal(
      dedupeRead.agentState,
      undefined,
      "agentState must not be resent when requested revision equals current revision"
    );
    assert.equal(
      dedupeRead.cursor,
      basePtyCursor,
      "PTY cursor must remain unchanged on deduplicated read"
    );
    console.log(JSON.stringify({ event: "dedup-verified", revision: "1" }));

    // 11. Reconnect/crash bridge scenario:
    // Retain helper daemon + PTY, kill ONLY owned bridge handle, send report while disconnected,
    // reconnect fresh bridge, verify handshake, and read latest state verifying same pid, target, port.
    console.log(JSON.stringify({ event: "bridge-disconnect-start", bridgePid: bridge.pid }));
    const oldBridgeExit = bridge.exitPromise;
    bridge.child.kill(isWin ? undefined : "SIGKILL");
    await bounded(oldBridgeExit, "bridge disconnect", 3000);
    bridge = null;
    console.log(JSON.stringify({ event: "bridge-disconnected-cleanly" }));

    // Send report while disconnected from helper bridge
    await sendAgentStateReport(
      agentPort,
      agentToken,
      target.backendSessionId,
      "blocked",
      "Which tool should I use?",
      { waitForServerClose: false }
    );
    console.log(JSON.stringify({ event: "offline-report-sent", state: "blocked", revision: "2" }));

    // Reconnect a fresh bridge transport
    bridge = openFramedBridgeTransport(binary, stateDir, "qa-reconnected-bridge");
    const reconnectedHandshake = await bridge.request("handshake", {});
    assert(
      reconnectedHandshake.capabilities.includes("agentStateV1"),
      "reconnected bridge handshake must advertise agentStateV1"
    );

    // Read latest state through reconnected bridge
    const reconnectedRead = await bounded(
      bridge.request("pty.read", {
        target,
        cursor: basePtyCursor,
        waitMs: 2000,
        agentAfterRevision: "1",
      }),
      "reconnected pty.read revision 2"
    );
    assert.equal(reconnectedRead.pid, ptyPid, "PTY process PID must be preserved across bridge reconnect");
    assert(reconnectedRead.agentState, "expected agentState snapshot on reconnected bridge");
    assert.equal(reconnectedRead.agentState.revision, "2", "revision must advance to 2");
    assert.equal(reconnectedRead.agentState.state, "blocked", "state must be blocked");
    assert.equal(
      reconnectedRead.agentState.detail,
      "Which tool should I use?",
      "detail must match report sent during disconnect"
    );
    assert.equal(
      reconnectedRead.cursor,
      basePtyCursor,
      "PTY cursor must remain unchanged across bridge reconnection and report ingestion"
    );
    console.log(JSON.stringify({ event: "reconnect-survival-verified", ptyPid, revision: "2" }));
  } finally {
    // Attempt pty.stop even if assertions failed
    if (target) {
      try {
        if (bridge && bridge.child.exitCode === null) {
          await bounded(bridge.request("pty.stop", { target }), "pty.stop on active bridge", 3000);
        } else {
          // If original bridge was closed/killed, open an isolated cleanup bridge to stop the PTY
          const cleanupBridge = openFramedBridgeTransport(binary, stateDir, "qa-cleanup-bridge");
          try {
            await bounded(cleanupBridge.request("pty.stop", { target }), "pty.stop on cleanup bridge", 3000);
          } finally {
            await cleanupBridge.close().catch((e) => cleanupErrors.push(`cleanupBridge.close: ${e.message}`));
          }
        }
        console.log(JSON.stringify({ event: "pty-stopped-in-finally" }));
      } catch (err) {
        cleanupErrors.push(`pty.stop: ${err.message}`);
      }
    }

    // Close bridge transport
    if (bridge) {
      try {
        await bridge.close();
      } catch (err) {
        cleanupErrors.push(`bridge.close: ${err.message}`);
      }
    }

    // Reap foreground helper daemon
    if (daemonChild) {
      try {
        await reapChild(daemonChild, daemonExitPromise, "helper-daemon");
      } catch (err) {
        cleanupErrors.push(`daemon.reap: ${err.message}`);
      }
    }

    // Clean up temporary fixture directory
    try {
      await rm(fixture, { recursive: true, force: true });
      console.log(JSON.stringify({ event: "fixture-cleaned", fixture }));
    } catch (err) {
      cleanupErrors.push(`fixture.rm: ${err.message}`);
    }

    // Do NOT swallow cleanup failures
    if (cleanupErrors.length > 0) {
      console.error(JSON.stringify({ event: "cleanup-failures", errors: cleanupErrors }));
      throw new Error(`QA cleanup failed: ${cleanupErrors.join("; ")}`);
    }
  }

  // Print qa-success ONLY after cleanup has succeeded completely
  console.log(JSON.stringify({ event: "qa-success" }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(JSON.stringify({ event: "qa-failure", error: err.message, stack: err.stack }));
    process.exit(1);
  });
}
