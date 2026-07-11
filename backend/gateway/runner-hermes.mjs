// RUNNER=hermes — delegate the run to a Hermes Agent profile
// (https://hermes-agent.nousresearch.com). Contract per the official CLI
// docs: `hermes -p <profile> --yolo -z "<prompt>"` returns the final answer
// as plain text; we require the FINAL envelope as the last JSON object in
// it. The profile's SOUL.md carries the manager system prompt
// (scripts/render-hermes-profile.mjs); the per-run kickoff below carries
// the five context blocks + trace-logging instructions (Hermes logs steps
// itself by curling agency:logStep — it has a terminal).

import { spawn } from "node:child_process";
import { gatherContext } from "./crew.mjs";

// Hermes subagent chains are slow (each spins a full conversation); default
// generously and tell the model its budget in the kickoff instead.
const TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS ?? 10 * 60 * 1000);

function kickoffPrompt({ runId, mode, ticket, fixture, context, roles, settings, policy }) {
  return `Handle this ONE support ticket end-to-end per your operating loop, then stop.

TICKET:
${JSON.stringify({ subject: ticket.subject, body: ticket.body, source: ticket.source, email: ticket.customerEmail }, null, 2)}

CUSTOMER CONTEXT:
${JSON.stringify({ ...context, fixture }, null, 2)}

POLICY (the law — cite §numbers):
${policy}

ACTIVE ROLES (spawn subagents per DELEGATE envelope; use each role's systemPrompt):
${JSON.stringify(roles.map(({ name, job, tools, model, guardrails, systemPrompt }) =>
    ({ name, job, tools, model, guardrails, systemPrompt })), null, 2)}

SETTINGS:
${JSON.stringify(settings)}

MODE: ${mode}${mode === "eval"
    ? " — verify facts against the fixture in CUSTOMER CONTEXT; never touch live systems."
    : ""}

TRACE LOGGING (mandatory): after each envelope (plan/delegate/review/escalation/final),
log it by running this in your terminal (stepType and a <=40-word PII-masked summary):
curl -s -X POST ${process.env.CONVEX_URL}/api/mutation -H 'Content-Type: application/json' \\
  -d '{"path":"agency:logStep","format":"json","args":{"runId":"${runId}","agentRole":"manager","stepType":"plan","inputSummary":"..."}}'

TIME BUDGET: you have ~8 minutes of wall clock. Prefer one batched delegation per
specialist over many small ones; skip lanes this ticket doesn't need.

FINISH: the very LAST line of your reply must be the FINAL envelope as one JSON object:
{"action":"<action vocabulary>","summary":"...","policyRefs":["§..."],"customerReply":"<the message to send the customer>"}`;
}

export async function resolveTicketHermes({ convex, orgId, runId, ticket, fixture, mode, dir }) {
  const { context, roles, settings, policy } = await gatherContext({ convex, orgId, ticket, dir });
  const prompt = kickoffPrompt({ runId, mode, ticket, fixture, context, roles, settings, policy });

  const bin = process.env.HERMES_BIN ?? "hermes";
  const profile = process.env.HERMES_PROFILE ?? "launchcare";
  // Pass provider+model explicitly (org's managerModel setting) — verified
  // working shape; immune to broken default-model resolution in config.yaml.
  const provider = process.env.HERMES_PROVIDER ?? "novita";
  const model = settings.managerModel ?? "pa/claude-opus-4-8-cc";
  const stdout = await new Promise((resolve, reject) => {
    // --yolo: headless runs can't answer approval prompts. -Q keeps output clean.
    const child = spawn(bin, [
      "-p", profile, "--yolo",
      "chat", "--provider", provider, "-m", model, "-Q", "-q", prompt,
    ], {
      stdio: ["ignore", "pipe", "inherit"],
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
  });

  // The FINAL envelope = last JSON object in the answer.
  const jsonMatches = stdout.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) ?? [];
  for (const candidate of jsonMatches.reverse()) {
    try {
      const envelope = JSON.parse(candidate);
      if (envelope.action) return envelope;
    } catch { /* keep scanning up */ }
  }
  throw new Error(`hermes produced no final envelope; output tail: ${stdout.slice(-200)}`);
}
