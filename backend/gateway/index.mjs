#!/usr/bin/env node
// LaunchCare gateway — the per-box service. Receives tickets (channel
// webhooks or the eval runner), runs the crew, records everything in Convex.
//
//   ORG_ID=... CONVEX_URL=... NOVITA_API_KEY=... node gateway/index.mjs
//
// Routes:
//   GET  /health            -> { ok, org }
//   POST /tickets           -> { customerEmail, subject, body, source? }  real ticket
//   POST /resolve           -> { case }  eval case (fixture-backed tools, no live spend)

import { createServer } from "node:http";
import { convexClient } from "./convex.mjs";
import { resolveTicket } from "./crew.mjs";

const dir = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const ORG_ID = process.env.ORG_ID;
const CONVEX_URL = process.env.CONVEX_URL;
const PORT = Number(process.env.PORT ?? 8787);
const PROMPT_VERSION = process.env.PROMPT_VERSION ?? "dev";
if (!ORG_ID || !CONVEX_URL) {
  console.error("ORG_ID and CONVEX_URL are required");
  process.exit(1);
}
const convex = convexClient(CONVEX_URL);

async function handleTicket(body) {
  const ticketId = await convex.mutation("agency:createTicket", {
    orgId: ORG_ID,
    source: body.source ?? "api",
    customerEmail: body.customerEmail,
    subject: body.subject,
    body: body.body,
  });
  const runId = await convex.mutation("agency:startRun", {
    orgId: ORG_ID, ticketId, kind: "ticket", promptVersion: PROMPT_VERSION,
  });
  return await runCrew({ runId, ticket: { ...body, source: body.source ?? "api" }, mode: "real" });
}

async function handleEval(body) {
  const c = body.case;
  const ticket = {
    customerEmail: c.customerFixture.email,
    subject: c.subject, body: c.body, source: "eval",
  };
  // Seed the fixture customer so customerContext (the memory layer) is real.
  await convex.mutation("agency:upsertCustomer", {
    orgId: ORG_ID, email: c.customerFixture.email,
    plan: c.customerFixture.plan,
    riskFlags: c.customerFixture.riskFlags,
    notes: c.customerFixture.historySummary,
  });
  const ticketId = await convex.mutation("agency:createTicket", {
    orgId: ORG_ID, source: "eval", customerEmail: ticket.customerEmail,
    subject: ticket.subject, body: ticket.body,
  });
  const runId = await convex.mutation("agency:startRun", {
    orgId: ORG_ID, ticketId, kind: "eval", promptVersion: PROMPT_VERSION,
  });
  return await runCrew({ runId, ticket, fixture: c.customerFixture, mode: "eval" });
}

async function runCrew({ runId, ticket, fixture, mode }) {
  try {
    const final = await resolveTicket({
      convex, orgId: ORG_ID, runId, ticket, fixture, mode, dir,
    });
    const escalated = String(final.action ?? "").startsWith("escalate");
    await convex.mutation("agency:finishRun", {
      runId,
      status: escalated ? "escalated" : "succeeded",
      finalAction: final.action,
      resolutionSummary: final.summary,
    });
    return { runId, ...final };
  } catch (e) {
    await convex.mutation("agency:finishRun", {
      runId, status: "failed", failureReason: String(e.message ?? e).slice(0, 200),
    }).catch(() => {});
    throw e;
  }
}

createServer(async (req, res) => {
  const reply = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === "GET" && req.url === "/health")
      return reply(200, { ok: true, org: ORG_ID, runner: process.env.RUNNER ?? "novita" });

    if (req.method === "POST" && (req.url === "/tickets" || req.url === "/resolve")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const result = req.url === "/tickets"
        ? await handleTicket(body)
        : await handleEval(body);
      return reply(200, result);
    }
    reply(404, { error: "not found" });
  } catch (e) {
    console.error(e);
    reply(500, { action: "ERROR", error: String(e.message ?? e) });
  }
}).listen(PORT, () => console.log(`gateway up on :${PORT} (org ${ORG_ID})`));
