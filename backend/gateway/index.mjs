#!/usr/bin/env node
// LaunchCare gateway — the box service. Receives tickets (Telegram, HTTP,
// or the app's demo queue), runs the crew, records everything in Convex.
//
//   ORG_ID=... CONVEX_URL=... NOVITA_API_KEY=... node gateway/index.mjs
//   MULTI_ORG=1 → serve EVERY org on the deployment (demo/judging mode):
//   per-org Telegram pollers from each org's app-configured token, per-org
//   demo-ticket queue. The provisioner later replaces this with one box per
//   tenant; the code paths are identical.
//
// Routes:
//   GET  /health            -> { ok, org }
//   POST /tickets           -> { customerEmail, subject, body, source?, orgId? }
//   POST /resolve           -> { case, orgId? }  eval case (fixture-backed tools)

import { createServer } from "node:http";
import { convexClient } from "./convex.mjs";
import { resolveTicket } from "./crew.mjs";
import { resolveTicketHermes } from "./runner-hermes.mjs";
import { startTelegram } from "./telegram.mjs";

// RUNNER=hermes → Hermes profile is the brain; anything else → built-in
// Novita crew loop (RUNNER=mock short-circuits inside crew.mjs).
const resolve = process.env.RUNNER === "hermes" ? resolveTicketHermes : resolveTicket;

const dir = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const ORG_ID = process.env.ORG_ID;
const MULTI_ORG = process.env.MULTI_ORG === "1";
const CONVEX_URL = process.env.CONVEX_URL;
const PORT = Number(process.env.PORT ?? 8787);
const PROMPT_VERSION = process.env.PROMPT_VERSION ?? "dev";
if ((!ORG_ID && !MULTI_ORG) || !CONVEX_URL) {
  console.error("CONVEX_URL and (ORG_ID or MULTI_ORG=1) are required");
  process.exit(1);
}
const convex = convexClient(CONVEX_URL);

async function handleTicket(body, orgId = ORG_ID) {
  const ticketId = await convex.mutation("agency:createTicket", {
    orgId,
    source: body.source ?? "api",
    customerEmail: body.customerEmail,
    subject: body.subject,
    body: body.body,
  });
  return await runTicket({ orgId, ticketId, ticket: { ...body, source: body.source ?? "api" } });
}

async function runTicket({ orgId, ticketId, ticket, fixture, mode = "real", kind = "ticket" }) {
  const runId = await convex.mutation("agency:startRun", {
    orgId, ticketId, kind, promptVersion: PROMPT_VERSION,
  });
  return await runCrew({ orgId, runId, ticket, fixture, mode });
}

async function handleEval(body, orgId = ORG_ID) {
  const c = body.case;
  const ticket = {
    customerEmail: c.customerFixture.email,
    subject: c.subject, body: c.body, source: "eval",
  };
  // Seed the fixture customer so customerContext (the memory layer) is real.
  await convex.mutation("agency:upsertCustomer", {
    orgId, email: c.customerFixture.email,
    plan: c.customerFixture.plan,
    riskFlags: c.customerFixture.riskFlags,
    notes: c.customerFixture.historySummary,
  });
  const ticketId = await convex.mutation("agency:createTicket", {
    orgId, source: "eval", customerEmail: ticket.customerEmail,
    subject: ticket.subject, body: ticket.body,
  });
  return await runTicket({ orgId, ticketId, ticket, fixture: c.customerFixture, mode: "eval", kind: "eval" });
}

async function runCrew({ orgId, runId, ticket, fixture, mode }) {
  try {
    const final = await resolve({ convex, orgId, runId, ticket, fixture, mode, dir });
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
      return reply(200, {
        ok: true, org: MULTI_ORG ? "all" : ORG_ID,
        runner: process.env.RUNNER ?? "novita",
      });

    if (req.method === "POST" && (req.url === "/tickets" || req.url === "/resolve")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const orgId = body.orgId ?? ORG_ID;
      const result = req.url === "/tickets"
        ? await handleTicket(body, orgId)
        : await handleEval(body, orgId);
      return reply(200, result);
    }
    reply(404, { error: "not found" });
  } catch (e) {
    console.error(e);
    reply(500, { action: "ERROR", error: String(e.message ?? e) });
  }
}).listen(PORT, () =>
  console.log(`gateway up on :${PORT} (${MULTI_ORG ? "MULTI-ORG" : `org ${ORG_ID}`})`));

// ---------------------------------------------------------------- watchers
const orgs = async () =>
  MULTI_ORG ? await convex.query("agency:listOrganizations", {}) : [{ _id: ORG_ID }];

// Telegram: box env wins for the primary org; otherwise each org's
// app-configured `telegramToken` setting. Checked every 30s so a newly
// pasted token goes live without a restart; token change restarts the poller.
const tgPollers = new Map(); // orgId -> { token, poller }
async function ensureTelegram() {
  try {
    for (const org of await orgs()) {
      const settings = await convex.query("agency:listSettings", { orgId: org._id });
      const token =
        (org._id === ORG_ID ? process.env.TELEGRAM_TOKEN : null) ||
        settings.find((s) => s.key === "telegramToken")?.value;
      const current = tgPollers.get(org._id);
      if (!token || token === current?.token) continue;
      current?.poller.stop();
      tgPollers.set(org._id, {
        token,
        poller: startTelegram({ token, onTicket: (t) => handleTicket(t, org._id) }),
      });
      console.log(`telegram poller (re)started for org ${org._id}`);
    }
  } catch (e) {
    console.error("telegram setting check:", e.message);
  }
}

// Demo tickets sent from the app's main menu (judges/mentors trying the
// product without a Telegram bot): poll the queue, run each once.
const inFlight = new Set();
async function pumpDemoTickets() {
  try {
    for (const org of await orgs()) {
      const pending = await convex.query("agency:pendingDemoTickets", { orgId: org._id });
      for (const t of pending) {
        if (inFlight.has(t._id)) continue;
        inFlight.add(t._id);
        runTicket({
          orgId: org._id, ticketId: t._id,
          ticket: { customerEmail: t.customerEmail, subject: t.subject, body: t.body, source: "demo" },
        })
          .catch((e) => console.error("demo ticket failed:", e.message))
          .finally(() => inFlight.delete(t._id));
      }
    }
  } catch (e) {
    console.error("demo queue check:", e.message);
  }
}

ensureTelegram();
pumpDemoTickets();
setInterval(ensureTelegram, 30_000);
setInterval(pumpDemoTickets, 2_000);
