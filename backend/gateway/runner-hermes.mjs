// RUNNER=hermes — delegate the whole crew run to a Hermes profile instead of
// the built-in Novita loop. THE ASSUMED CONTRACT LIVES ONLY IN THIS FILE;
// when the real Hermes interface is known, adjust here and nothing else.
//
// Contract (from the pack's original notes):
//   - invoke: `hermes run --profile <profile> --json`  (HERMES_BIN /
//     HERMES_PROFILE env override; profile carries the manager system
//     prompt and specialist subagent wiring)
//   - stdin: one JSON object with the full kickoff context:
//       { runId, orgId, mode, ticket, fixture, customerContext, policy,
//         activeRoles, settings, convexUrl }
//     Hermes-side lifecycle hooks use runId+convexUrl to log steps to
//     agency:logStep themselves (that's how the trace builds).
//   - stdout: the LAST JSON object printed is the manager's FINAL envelope
//     { action, summary, policyRefs? }.
//   - non-zero exit or no parseable envelope = failed run.

import { spawn } from "node:child_process";
import { gatherContext } from "./crew.mjs";

const TIMEOUT_MS = 5 * 60 * 1000;

export async function resolveTicketHermes({ convex, orgId, runId, ticket, fixture, mode, dir }) {
  const { context, roles, settings, policy } = await gatherContext({ convex, orgId, ticket, dir });
  const input = JSON.stringify({
    runId, orgId, mode, ticket, fixture,
    customerContext: context, policy,
    activeRoles: roles.map(({ name, job, tools, model, guardrails, systemPrompt }) =>
      ({ name, job, tools, model, guardrails, systemPrompt })),
    settings,
    convexUrl: process.env.CONVEX_URL,
  });

  const bin = process.env.HERMES_BIN ?? "hermes";
  const profile = process.env.HERMES_PROFILE ?? "launchcare";
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(bin, ["run", "--profile", profile, "--json"], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`hermes timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`hermes exited ${code}`));
    });
    child.stdin.end(input);
  });

  // Last JSON object on stdout = the final envelope.
  const jsonLines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  for (const line of jsonLines.reverse()) {
    try {
      const envelope = JSON.parse(line);
      if (envelope.action) return envelope;
    } catch { /* keep scanning up */ }
  }
  throw new Error(`hermes produced no final envelope; stdout tail: ${stdout.slice(-200)}`);
}
