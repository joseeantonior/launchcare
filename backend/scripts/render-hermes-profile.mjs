#!/usr/bin/env node
// Render the org's Hermes profile: manager.md (placeholders filled from org
// settings) + the live crew roster -> SOUL.md in the Hermes profile dir.
// Run ON the box, after any crew/policy change:
//   node scripts/render-hermes-profile.mjs --org <orgId> [--url <convexUrl>] [--out <dir>]
// Default out: ~/.hermes/profiles/launchcare

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const orgId = flag("org") ?? process.env.ORG_ID;
if (!orgId) { console.error("usage: --org <orgId> [--url <convexUrl>] [--out <dir>]"); process.exit(1); }

const dir = new URL("..", import.meta.url).pathname;
const url = (flag("url") ?? process.env.CONVEX_URL ?? "").replace(/\/$/, "");
if (!url) { console.error("no Convex URL (--url or CONVEX_URL)"); process.exit(1); }
const out = flag("out") ?? `${homedir()}/.hermes/profiles/${process.env.HERMES_PROFILE ?? "launchcare"}`;

const q = async (path, a) => {
  const res = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args: a, format: "json" }),
  });
  const d = await res.json();
  if (d.status !== "success") throw new Error(`${path}: ${d.errorMessage}`);
  return d.value;
};

const [roles, settingsRows] = await Promise.all([
  q("agency:activeRoles", { orgId }),
  q("agency:listSettings", { orgId }),
]);
const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

const soul =
  readFileSync(`${dir}prompts/manager.md`, "utf8")
    .replaceAll("{{AGENCY_NAME}}", settings.agencyName ?? "LaunchCare")
    .replaceAll("{{PRODUCT_NAME}}", settings.productName ?? "the product") +
  `

## Your crew on this box (Hermes subagents)
For each DELEGATE envelope, spawn an isolated subagent with the role's
systemPrompt below; enforce its guardrails yourself (tool budget, cost cap,
refund limit). Current roster (re-rendered from the org chart — do not edit
here, edit via the dashboard):

${roles.map((r) =>
    `### ${r.name} (${r.model})\njob: ${r.job}\ntools: ${r.tools.join(", ")}\nguardrails: ${JSON.stringify(r.guardrails)}\nprompt: ${r.systemPrompt}`,
  ).join("\n\n")}

## Runtime notes
- Each run's kickoff message carries TICKET / CUSTOMER CONTEXT / POLICY /
  ACTIVE ROLES / SETTINGS plus the exact trace-logging curl for that run.
- log_step = the curl command from the kickoff (terminal tool). Log every
  envelope; the ops dashboard renders your trace tree live.
- End every run with the FINAL envelope as the last JSON object you output.
`;

mkdirSync(out, { recursive: true });
writeFileSync(`${out}/SOUL.md`, soul);
console.log(`wrote ${out}/SOUL.md  (${roles.length} roles, agency "${settings.agencyName}")`);
