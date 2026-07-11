#!/usr/bin/env node
// Register the seed roles from prompts/specialists.md for an org.
//   node scripts/register-roles.mjs --org <orgId> [--url <convexUrl>]
// Idempotent: skips roles the org already has. specialists.md stays the
// single source of truth — this parses its JSON blocks + Prompt paragraphs.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const orgId = flag("org");
if (!orgId) {
  console.error("usage: node scripts/register-roles.mjs --org <orgId> [--url <convexUrl>]");
  process.exit(1);
}

const dir = new URL("..", import.meta.url).pathname;
const url = (flag("url") ?? process.env.CONVEX_URL ??
  readFileSync(`${dir}.env.local`, "utf8").match(/^CONVEX_URL=(.+)$/m)?.[1] ?? ""
).replace(/\/$/, "");
if (!url) { console.error("no Convex URL (--url, CONVEX_URL, or .env.local)"); process.exit(1); }

const call = async (endpoint, path, callArgs) => {
  const res = await fetch(`${url}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args: callArgs, format: "json" }),
  });
  const d = await res.json();
  if (d.status !== "success") throw new Error(`${path}: ${d.errorMessage}`);
  return d.value;
};

// Parse specialists.md: each "## N. role" section has a ```json block
// (name, model, job, tools, guardrails) and a "Prompt: ..." paragraph.
const md = readFileSync(`${dir}prompts/specialists.md`, "utf8");
const roles = [];
for (const section of md.split(/^## \d+\. /m).slice(1)) {
  const json = section.match(/```json\s*([\s\S]*?)```/)?.[1];
  const prompt = section.match(/^Prompt: ([\s\S]*?)(?=\n---|\n## |$)/m)?.[1];
  if (!json || !prompt) {
    console.error(`skipping malformed section: ${section.slice(0, 40)}…`);
    continue;
  }
  roles.push({ ...JSON.parse(json), systemPrompt: prompt.trim().replace(/\n/g, " ") });
}

const existing = new Set(
  (await call("query", "agency:activeRoles", { orgId })).map((r) => r.name),
);
for (const role of roles) {
  if (existing.has(role.name)) {
    console.log(`skip  ${role.name} (already registered)`);
    continue;
  }
  await call("mutation", "agency:createRole", { orgId, ...role, createdBy: "founder" });
  console.log(`ok    ${role.name}  model=${role.model}`);
}
console.log(`${roles.length} roles processed for org ${orgId}`);
