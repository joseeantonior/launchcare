#!/usr/bin/env node
// Register the default crew (convex/defaultCrew.js) for an org — for orgs
// created via CLI; app-onboarded orgs get the crew automatically.
//   node scripts/register-roles.mjs --org <orgId> [--url <convexUrl>]
// Idempotent: skips roles the org already has.

import { readFileSync } from "node:fs";
import { defaultCrew } from "../convex/defaultCrew.js";

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

const existing = new Set(
  (await call("query", "agency:activeRoles", { orgId })).map((r) => r.name),
);
for (const role of defaultCrew) {
  if (existing.has(role.name)) {
    console.log(`skip  ${role.name} (already registered)`);
    continue;
  }
  await call("mutation", "agency:createRole", { orgId, ...role, createdBy: "founder" });
  console.log(`ok    ${role.name}  model=${role.model}`);
}
console.log(`${defaultCrew.length} roles processed for org ${orgId}`);
