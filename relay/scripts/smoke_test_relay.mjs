#!/usr/bin/env node
/**
 * Zero-dependency live smoke & despair verifier for jjdr-relay (Node 22+).
 * Usage:
 *   node relay/scripts/smoke_test_relay.mjs --url http://<RELAY_IP>:8787 --key <TEAM_KEY>
 */

function parseArgs(argv) {
  const out = { url: "http://127.0.0.1:8787", key: process.env.JJDR_RELAY_TEAM_KEY || "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) out.url = argv[++i].replace(/\/+$/, "");
    else if (argv[i] === "--key" && argv[i + 1]) out.key = argv[++i];
  }
  return out;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function openWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const queue = [];
    const waiters = [];

    ws.addEventListener("open", () => resolve({ ws, nextMsg }));
    ws.addEventListener("error", (err) => reject(new Error(`WebSocket error: ${err.message || "failed"}`)));
    ws.addEventListener("message", (ev) => {
      const parsed = JSON.parse(String(ev.data));
      if (waiters.length > 0) {
        const w = waiters.shift();
        clearTimeout(w.timer);
        w.resolve(parsed);
      } else {
        queue.push(parsed);
      }
    });

    function nextMsg(predicate, timeoutMs = 4000) {
      for (let i = 0; i < queue.length; i++) {
        if (predicate(queue[i])) {
          return Promise.resolve(queue.splice(i, 1)[0]);
        }
      }
      return new Promise((res, rej) => {
        const deadline = Date.now() + timeoutMs;
        const pump = () => {
          const remaining = deadline - Date.now();
          if (remaining <= 0) return rej(new Error("Timed out waiting for WS message"));
          const timer = setTimeout(() => rej(new Error("Timed out waiting for WS message")), remaining);
          waiters.push({
            timer,
            resolve: (msg) => {
              if (predicate(msg)) res(msg);
              else pump();
            },
          });
        };
        pump();
      });
    }
  });
}

async function main() {
  const { url, key } = parseArgs(process.argv);
  if (!key) {
    console.error("Error: pass --key <TEAM_KEY> or set JJDR_RELAY_TEAM_KEY");
    process.exit(2);
  }
  const wsBase = url.replace(/^http/i, "ws");
  const runId = Math.floor(Date.now() / 1000) % 100000;
  const repoUrl = `https://github.corp.example.com/smoke/repo-${runId}.git`;
  const authorId = `smoke_author_${runId}`;
  const rev1Id = `smoke_rev1_${runId}`;
  const rev2Id = `smoke_rev2_${runId}`;
  const sha = `smoke${String(runId).padStart(7, "0")}`;

  const steps = [];
  const runStep = async (name, fn) => {
    process.stdout.write(`[RUN ] ${name} ... `);
    await fn();
    steps.push(name);
    console.log("PASS");
  };

  let authorConn;
  let rev1Conn;
  let rev2Conn;

  try {
    await runStep("1. Health check (no auth)", async () => {
      const res = await fetch(`${url}/health`);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const json = await res.json();
      assert(json.status === "ok", `unexpected health: ${JSON.stringify(json)}`);
    });

    await runStep("2. Invalid TEAM_KEY blocked (401)", async () => {
      const res = await fetch(`${url}/api/v1/peers`, {
        headers: { "x-team-key": "definitely-wrong-key" },
      });
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await runStep("3. Author + 2 Reviewers connect over WebSocket", async () => {
      authorConn = await openWs(`${wsBase}/ws?team_key=${encodeURIComponent(key)}`);
      rev1Conn = await openWs(`${wsBase}/ws?team_key=${encodeURIComponent(key)}`);
      rev2Conn = await openWs(`${wsBase}/ws?team_key=${encodeURIComponent(key)}`);

      for (const [conn, id] of [
        [authorConn, authorId],
        [rev1Conn, rev1Id],
        [rev2Conn, rev2Id],
      ]) {
        conn.ws.send(
          JSON.stringify({
            type: "hello",
            github_id: id,
            display_name: id,
            status: "online",
            repo_urls: [repoUrl],
            device_id: `smoke-device-${id}`,
          })
        );
        await conn.nextMsg((m) => m.type === "welcome");
      }
    });

    let requestId = "";
    await runStep("4. Happy path: 2 reviewers receive PR + AckDelivery + live status", async () => {
      const res = await fetch(`${url}/api/v1/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-team-key": key },
        body: JSON.stringify({
          repo_url: repoUrl,
          pr_number: runId,
          pr_url: `https://github.corp.example.com/smoke/repo-${runId}/pull/${runId}`,
          pr_title: `Smoke Test PR #${runId}`,
          base_branch: "main",
          head_branch: `feat/smoke-${runId}`,
          head_sha: sha,
          author_id: authorId,
          reviewers: [rev1Id, rev2Id],
        }),
      });
      assert(res.status === 201, `expected 201, got ${res.status}`);
      const created = await res.json();
      requestId = created.request.request_id;
      assert(created.assignments.length === 2, "expected 2 assignments");

      await rev1Conn.nextMsg((m) => m.type === "review_assigned" && m.request.request_id === requestId);
      await rev2Conn.nextMsg((m) => m.type === "review_assigned" && m.request.request_id === requestId);

      rev1Conn.ws.send(JSON.stringify({ type: "ack_delivery", request_id: requestId }));
      await authorConn.nextMsg(
        (m) => m.type === "assignment_status_changed" && m.reviewer_id === rev1Id && m.status === "delivered"
      );

      rev1Conn.ws.send(
        JSON.stringify({
          type: "report_status",
          request_id: requestId,
          status: "reviewing",
          worker_agent: "claude",
        })
      );
      const evt = await authorConn.nextMsg(
        (m) => m.type === "assignment_status_changed" && m.reviewer_id === rev1Id && m.status === "reviewing"
      );
      assert(evt.worker_agent === "claude", "missing worker_agent");
    });

    await runStep("5. Despair path: Duplicate SHA rejected by Layer-1", async () => {
      const res = await fetch(`${url}/api/v1/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-team-key": key },
        body: JSON.stringify({
          repo_url: repoUrl,
          pr_number: runId,
          pr_url: `https://github.corp.example.com/smoke/repo-${runId}/pull/${runId}`,
          pr_title: `Duplicate PR #${runId}`,
          base_branch: "main",
          head_branch: `feat/smoke-${runId}`,
          head_sha: sha,
          author_id: authorId,
          reviewers: [rev1Id],
        }),
      });
      const dup = await res.json();
      assert(dup.assignments[0].status === "rejected", "expected rejected");
      assert(dup.assignments[0].reject_reason === "duplicate_sha", "expected duplicate_sha");
    });

    await runStep("6. Despair path: Unauthorized hijack (403) + Other device claim conflict (409)", async () => {
      const res = await fetch(`${url}/api/v1/reviews/${requestId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-team-key": key },
        body: JSON.stringify({ author_id: rev1Id, reviewer_ids: [] }),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);

      const conflict = await fetch(`${url}/api/v1/reviews/${requestId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-team-key": key },
        body: JSON.stringify({
          reviewer_id: rev1Id,
          status: "completed",
          device_id: "other-pc-device",
        }),
      });
      assert(conflict.status === 409, `expected 409, got ${conflict.status}`);
    });

    await runStep("7. Cleanup + sync-active cancellation verification", async () => {
      const res = await fetch(`${url}/api/v1/reviews/${requestId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-team-key": key },
        body: JSON.stringify({ author_id: authorId, reviewer_ids: [], reason: "smoke cleanup" }),
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);

      const syncRes = await fetch(`${url}/api/v1/reviews/sync-active`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-team-key": key },
        body: JSON.stringify({
          reviewer_id: rev1Id,
          device_id: `smoke-device-${rev1Id}`,
          request_ids: [requestId],
        }),
      });
      assert(syncRes.status === 200, `expected 200, got ${syncRes.status}`);
      const syncJson = await syncRes.json();
      assert(syncJson.results[0].should_abort === true, "cancelled job must report should_abort=true");
    });

    console.log(`\nALL ${steps.length} LIVE SMOKE CHECKS PASSED against ${url}`);
  } finally {
    authorConn?.ws?.close();
    rev1Conn?.ws?.close();
    rev2Conn?.ws?.close();
  }
}

main().catch((err) => {
  console.error(`\nFAIL: ${err.message}`);
  process.exit(1);
});
