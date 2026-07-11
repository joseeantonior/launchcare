#!/usr/bin/env node
// LaunchCare eval runner — node >=18, no dependencies.
//
//   node evals/run.mjs --version v0.2            # run all 20 cases
//   node evals/run.mjs --version v0.2 --case T11 # one case
//   node evals/run.mjs --baseline                # snapshot current as baseline
//
// Wire ONE function to your agent (see resolveTicket below). Pass/fail =
// final envelope `action` matches expected.action. Correct escalations are
// passes. Exits 1 if pass count drops below baseline -> use as a merge gate
// (rubric: "fails a release if quality drops").

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? true;
};

const version = flag("version") ?? "dev";
const onlyCase = flag("case");
const snapshotBaseline = args.includes("--baseline");

const cases = readFileSync(`${dir}cases.jsonl`, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((c) => !onlyCase || c.caseId === onlyCase);

// ---------------------------------------------------------------------------
// ADAPTER — POSTs each case to the gateway's eval endpoint. Start it first:
//   ORG_ID=... CONVEX_URL=... NOVITA_API_KEY=... node gateway/index.mjs
// Eval mode uses fixture-backed tools: no real inbox, no live payments.
const GATEWAY = (process.env.GATEWAY_URL ?? "http://localhost:8787").replace(/\/$/, "");
async function resolveTicket(c) {
  const res = await fetch(`${GATEWAY}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case: c }),
  });
  return await res.json(); // { action, summary, runId }
}
// ---------------------------------------------------------------------------

const results = [];
for (const c of cases) {
  const t0 = Date.now();
  let actual = { action: "ERROR", summary: "" };
  try {
    actual = await resolveTicket(c);
  } catch (e) {
    actual.summary = String(e.message ?? e);
  }
  const pass = actual.action === c.expected.action;
  results.push({
    caseId: c.caseId,
    category: c.category,
    pass,
    expected: c.expected.action,
    actual: actual.action,
    ms: Date.now() - t0,
    detail: pass ? "" : (actual.summary ?? "").slice(0, 140),
  });
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${c.caseId}  ${c.category.padEnd(8)} ` +
    `expected=${c.expected.action}  actual=${actual.action}  ${Date.now() - t0}ms`
  );
}

const passCount = results.filter((r) => r.pass).length;
const summary = {
  version,
  at: new Date().toISOString(),
  passCount,
  failCount: results.length - passCount,
  total: results.length,
  results,
};
writeFileSync(`${dir}results-${version}.json`, JSON.stringify(summary, null, 2));
console.log(`\n${passCount}/${results.length} passed  (${version})`);
console.log(`wrote evals/results-${version}.json`);

// Push results to Convex for the dashboard trend (needs --org).
const orgId = flag("org");
const convexUrl = (process.env.CONVEX_URL ??
  readFileSync(`${dir}../.env.local`, "utf8").match(/^CONVEX_URL=(.+)$/m)?.[1] ?? ""
).replace(/\/$/, "");
if (orgId && convexUrl) {
  const res = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "agency:recordEvalRun",
      format: "json",
      args: {
        orgId,
        promptVersion: version,
        passCount,
        failCount: results.length - passCount,
        results: results.map(({ caseId, pass, actual, detail }) => ({
          caseId, pass, actualAction: actual, detail,
        })),
      },
    }),
  });
  const d = await res.json();
  console.log(d.status === "success"
    ? `recorded eval run in Convex (${d.value})`
    : `convex push failed: ${d.errorMessage}`);
} else {
  console.log("(pass --org <orgId> to record this eval run in Convex)");
}

// Baseline gate ------------------------------------------------------------
const baselinePath = `${dir}baseline.json`;
if (snapshotBaseline) {
  writeFileSync(baselinePath, JSON.stringify({ version, passCount }, null, 2));
  console.log(`baseline set: ${passCount} passes @ ${version}`);
} else if (existsSync(baselinePath)) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (passCount < baseline.passCount) {
    console.error(
      `REGRESSION: ${passCount} < baseline ${baseline.passCount} ` +
      `(${baseline.version}). Blocking.`
    );
    process.exit(1);
  }
  console.log(`no regression vs baseline (${baseline.passCount} @ ${baseline.version})`);
}
