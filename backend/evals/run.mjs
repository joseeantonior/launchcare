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
import { execSync } from "node:child_process";

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
// ADAPTER — the only thing you edit. Given one eval case, run your crew and
// return { action, summary }. Two common wirings:
//
// (a) CLI: shell out to your Hermes entrypoint, read the final JSON envelope:
//     const out = execSync(`hermes run --profile launchcare --json`, {
//       input: JSON.stringify({ ticket: c, mode: "eval" }), encoding: "utf8" });
//     return JSON.parse(out);              // expects { action, summary }
//
// (b) HTTP: POST the case to a local endpoint your gateway exposes.
//
// Keep mode:"eval" so tickets write to Convex with source "eval" and never
// touch the real inbox or Stripe live mode.
async function resolveTicket(c) {
  throw new Error(
    "Wire resolveTicket() to your agent entrypoint (see comment above)."
  );
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
console.log(
  "Push to Convex: npx convex run agency:recordEvalRun " +
  "'" + JSON.stringify({
    promptVersion: version,
    passCount,
    failCount: results.length - passCount,
    results: results.map(({ caseId, pass, actual, detail }) => ({
      caseId, pass, actualAction: actual, detail,
    })),
  }).slice(0, 80) + "…'"
);

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
