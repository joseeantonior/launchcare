// LaunchCare — core Convex functions (multi-tenant: every function is
// org-scoped). The gateway hooks its tool-call lifecycle to logStep so the
// trace builds itself. Every mentor drill maps to one query below.

import { action, internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { defaultCrew } from "./defaultCrew.js";
import { api, internal } from "./_generated/api";

const now = () => Date.now();

// ---------------------------------------------------------- organizations
async function insertOrgWithDefaults(ctx: any, args: {
  name: string; website?: string; auth0UserId?: string;
}) {
  const orgId = await ctx.db.insert("organizations", {
    ...args,
    createdAt: now(),
  });
  const defaults: Array<[string, any]> = [
    ["costSpikeUsd", 1.5],
    ["maxRefundAutoUsd", 25],
    ["perTicketBudgetUsd", 0.5],
    ["compBudgetPerCustomerUsd", 30],
    ["managerModel", "pa/claude-opus-4-8-cc"], // Novita partner model id; edit in dashboard
    // $/MTok per model — fill from your Novita account-manager pricing.
    ["modelPricesUsdPerMTok", {}],
    ["agencyName", "LaunchCare"],
    ["productName", args.name],
  ];
  for (const [key, value] of defaults) {
    await ctx.db.insert("settings", { orgId, key, value, updatedAt: now() });
  }
  return orgId;
}

// Admin/CLI bootstrap (org + settings, no crew):
//   npx convex run agency:createOrganization '{"name":"demo"}'
export const createOrganization = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    auth0UserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => await insertOrgWithDefaults(ctx, args),
});

// Signup from the User Dashboard: org + settings + default crew, bound to
// the signed-in Auth0 user. Idempotent per user — a second call returns
// their existing org. Unauthenticated calls work too (dev mode, no Auth0
// configured) but create an unbound org each time.
export const onboardOrganization = mutation({
  args: { name: v.string(), website: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      const existing = await ctx.db
        .query("organizations")
        .withIndex("by_auth0UserId", (q) => q.eq("auth0UserId", identity.subject))
        .first();
      if (existing) return existing._id;
    }
    const orgId = await insertOrgWithDefaults(ctx, {
      ...args,
      auth0UserId: identity?.subject,
    });
    for (const role of defaultCrew) {
      await ctx.db.insert("agentRoles", {
        orgId, ...role, active: true, createdBy: "founder", createdAt: now(),
      });
    }
    if (args.website) {
      // Build the knowledge pack in the background (convex/scrape.ts).
      await ctx.scheduler.runAfter(0, internal.scrape.scrapeWebsite, { orgId });
    }
    return orgId;
  },
});

export const getOrganization = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => await ctx.db.get(args.orgId),
});

// "Rescan website" from the app — schedules the knowledge-pack rebuild.
export const rescanWebsite = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.scrape.scrapeWebsite, { orgId: args.orgId });
  },
});

// "Connect Telegram" from the app: validate the BotFather token against the
// live API, then store it as an org setting. The org's gateway box watches
// this setting and (re)starts its poller within ~30s.
export const connectTelegram = action({
  args: { orgId: v.id("organizations"), token: v.string() },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const d = await res.json().catch(() => ({ ok: false }));
    if (!d.ok)
      throw new ConvexError("Telegram rejected this token — copy it exactly from @BotFather");
    await ctx.runMutation(api.agency.setSetting, {
      orgId: args.orgId, key: "telegramToken", value: token,
    });
    await ctx.runMutation(api.agency.setSetting, {
      orgId: args.orgId, key: "telegramBotUsername", value: d.result.username,
    });
    return d.result.username;
  },
});

// Auth diagnostic: what identity (if any) Convex sees for this request.
// null while signed in ⇒ token not accepted (env vars on wrong deployment,
// deploy not re-run after env set, or domain/clientId mismatch).
export const whoami = query({
  args: {},
  handler: async (ctx) => await ctx.auth.getUserIdentity(),
});

// The signed-in user's org (null when unauthenticated or not onboarded).
export const myOrganization = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("organizations")
      .withIndex("by_auth0UserId", (q) => q.eq("auth0UserId", identity.subject))
      .first();
  },
});

export const listOrganizations = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("organizations").collect(),
});

// -------------------------------------------------------------- settings
async function getSetting(ctx: any, orgId: any, key: string, fallback: any) {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_org_key", (q: any) => q.eq("orgId", orgId).eq("key", key))
    .first();
  return row ? row.value : fallback;
}

export const listSettings = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("settings")
      .withIndex("by_org_key", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

export const setSetting = mutation({
  args: { orgId: v.id("organizations"), key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_org_key", (q) =>
        q.eq("orgId", args.orgId).eq("key", args.key),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: now() });
    } else {
      await ctx.db.insert("settings", { ...args, updatedAt: now() });
    }
  },
});

// --------------------------------------------------------- tickets & customers
export const upsertCustomer = mutation({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
    name: v.optional(v.string()),
    paymentCustomerId: v.optional(v.string()),
    plan: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_org_email", (q) =>
        q.eq("orgId", args.orgId).eq("email", args.email),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("customers", args);
  },
});

export const createTicket = mutation({
  args: {
    orgId: v.id("organizations"),
    source: v.union(
      v.literal("email"), v.literal("telegram"), v.literal("demo"),
      v.literal("eval"), v.literal("api"),
    ),
    channelRef: v.optional(v.string()),
    customerEmail: v.string(),
    subject: v.string(),
    body: v.string(),
    priority: v.optional(v.union(
      v.literal("low"), v.literal("normal"),
      v.literal("high"), v.literal("urgent"),
    )),
  },
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_org_email", (q) =>
        q.eq("orgId", args.orgId).eq("email", args.customerEmail),
      )
      .first();
    return await ctx.db.insert("tickets", {
      orgId: args.orgId,
      source: args.source,
      channelRef: args.channelRef,
      customerId: customer?._id,
      customerEmail: args.customerEmail,
      subject: args.subject,
      body: args.body,
      status: "new",
      priority: args.priority ?? "normal",
      receivedAt: now(),
    });
  },
});

export const getTicket = query({
  args: { ticketId: v.id("tickets") },
  handler: async (ctx, args) => await ctx.db.get(args.ticketId),
});

// Demo tickets created from the app's main menu, waiting for the org's
// gateway to pick them up (it polls this).
export const pendingDemoTickets = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const fresh = await ctx.db
      .query("tickets")
      .withIndex("by_org_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "new"),
      )
      .collect();
    return fresh.filter((t) => t.source === "demo");
  },
});

// "This user's past" memory layer: hand this to the manager at kickoff.
export const customerContext = query({
  args: { orgId: v.id("organizations"), email: v.string() },
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_org_email", (q) =>
        q.eq("orgId", args.orgId).eq("email", args.email),
      )
      .first();
    const pastTickets = await ctx.db
      .query("tickets")
      .withIndex("by_org_email", (q) =>
        q.eq("orgId", args.orgId).eq("customerEmail", args.email),
      )
      .order("desc")
      .take(10);
    return { customer, pastTickets };
  },
});

// ------------------------------------------------------------------- runs
export const startRun = mutation({
  args: {
    orgId: v.id("organizations"),
    ticketId: v.optional(v.id("tickets")),
    kind: v.union(v.literal("ticket"), v.literal("eval"), v.literal("demo")),
    promptVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const runId = await ctx.db.insert("runs", {
      ...args,
      status: "running",
      startedAt: now(),
      totalTokens: 0,
      totalCostUsd: 0,
      stepCount: 0,
    });
    if (args.ticketId) {
      await ctx.db.patch(args.ticketId, {
        status: "in_progress",
        activeRunId: runId,
      });
    }
    return runId;
  },
});

export const logStep = mutation({
  args: {
    runId: v.id("runs"),
    parentStepId: v.optional(v.id("steps")),
    agentRole: v.string(),
    stepType: v.union(
      v.literal("plan"), v.literal("delegate"), v.literal("tool_call"),
      v.literal("tool_result"), v.literal("draft"), v.literal("review"),
      v.literal("revision_request"), v.literal("escalation"),
      v.literal("resume"), v.literal("spawn_role"), v.literal("final"),
      v.literal("note"),
    ),
    toolName: v.optional(v.string()),
    inputSummary: v.string(),
    outputSummary: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("ok"), v.literal("error"), v.literal("bounced"),
    )),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("unknown runId");
    const stepId = await ctx.db.insert("steps", {
      ...args,
      orgId: run.orgId, // steps inherit the run's org
      status: args.status ?? "ok",
      startedAt: now(),
    });
    // Roll up totals onto the run.
    const totalCostUsd = run.totalCostUsd + (args.costUsd ?? 0);
    await ctx.db.patch(args.runId, {
      totalTokens:
        run.totalTokens + (args.tokensIn ?? 0) + (args.tokensOut ?? 0),
      totalCostUsd,
      stepCount: run.stepCount + 1,
    });
    // Cost-spike alert (Observability L5: "an alert that actually fired").
    const spikeLimit = await getSetting(ctx, run.orgId, "costSpikeUsd", 1.5);
    if (totalCostUsd > spikeLimit && run.totalCostUsd <= spikeLimit) {
      await ctx.db.insert("alerts", {
        orgId: run.orgId,
        type: "cost_spike",
        runId: args.runId,
        message: `Run cost $${totalCostUsd.toFixed(2)} exceeded $${spikeLimit}`,
        thresholdInfo: `costSpikeUsd=${spikeLimit}`,
        firedAt: now(),
        acknowledged: false,
      });
    }
    return stepId;
  },
});

export const finishRun = mutation({
  args: {
    runId: v.id("runs"),
    status: v.union(
      v.literal("succeeded"), v.literal("escalated"), v.literal("failed"),
    ),
    finalAction: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    resolutionSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      finishedAt: now(),
      finalAction: args.finalAction,
      failureReason: args.failureReason,
    });
    const run = await ctx.db.get(args.runId);
    if (run?.ticketId) {
      await ctx.db.patch(run.ticketId, {
        status:
          args.status === "succeeded" ? "resolved"
          : args.status === "escalated" ? "escalated"
          : "failed",
        resolutionSummary: args.resolutionSummary,
        resolvedAt: args.status === "succeeded" ? now() : undefined,
      });
    }
    if (args.status === "failed" && run) {
      await ctx.db.insert("alerts", {
        orgId: run.orgId,
        type: "run_failed",
        runId: args.runId,
        message: args.failureReason ?? "Run failed",
        firedAt: now(),
        acknowledged: false,
      });
    }
  },
});

// ----------------------------------------------------------- observability
// Mentor: "pull up a specific run and show me what each agent did."
export const getRunTree = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const steps = await ctx.db
      .query("steps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    return { run, steps }; // client builds the tree via parentStepId
  },
});

// Mentor: "which agent spent the most this morning?"
export const costByAgent = query({
  args: { orgId: v.id("organizations"), sinceMs: v.number() },
  handler: async (ctx, args) => {
    const steps = await ctx.db
      .query("steps")
      .withIndex("by_org_startedAt", (q) =>
        q.eq("orgId", args.orgId).gte("startedAt", args.sinceMs),
      )
      .collect();
    const totals: Record<string, { costUsd: number; tokens: number; steps: number }> = {};
    for (const s of steps) {
      const t = (totals[s.agentRole] ??= { costUsd: 0, tokens: 0, steps: 0 });
      t.costUsd += s.costUsd ?? 0;
      t.tokens += (s.tokensIn ?? 0) + (s.tokensOut ?? 0);
      t.steps += 1;
    }
    return Object.entries(totals)
      .map(([agentRole, t]) => ({ agentRole, ...t }))
      .sort((a, b) => b.costUsd - a.costUsd);
  },
});

// List/search runs; call twice with two runIds + getRunTree for the diff view.
export const listRuns = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let runs = await ctx.db
      .query("runs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(args.limit ?? 50);
    if (args.status) runs = runs.filter((r) => r.status === args.status);
    if (args.promptVersion)
      runs = runs.filter((r) => r.promptVersion === args.promptVersion);
    return runs;
  },
});

// Explicit alert (e.g. escalation raised by the gateway).
export const raiseAlert = mutation({
  args: {
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("run_failed"), v.literal("cost_spike"),
      v.literal("latency_spike"), v.literal("escalation"),
    ),
    runId: v.optional(v.id("runs")),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("alerts", {
      ...args,
      firedAt: now(),
      acknowledged: false,
    });
  },
});

export const openAlerts = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("alerts")
      .withIndex("by_org_firedAt", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(25),
});

// -------------------------------------------------------------- agent roles
export const createRole = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    job: v.string(),
    tools: v.array(v.string()),
    model: v.string(),
    guardrails: v.object({
      maxCostUsdPerTask: v.number(),
      maxToolCalls: v.number(),
      maxRefundUsd: v.optional(v.number()),
      requiresReviewFor: v.optional(v.array(v.string())),
    }),
    systemPrompt: v.string(),
    createdBy: v.union(
      v.literal("founder"), v.literal("manager_agent"), v.literal("volunteer"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRoles", {
      ...args,
      active: true,
      createdAt: now(),
    });
  },
});

// Patch a role after creation — e.g. set the real Novita model id, retire a
// role, or tighten guardrails.
export const updateRole = mutation({
  args: {
    roleId: v.id("agentRoles"),
    model: v.optional(v.string()),
    active: v.optional(v.boolean()),
    job: v.optional(v.string()),
    tools: v.optional(v.array(v.string())),
    systemPrompt: v.optional(v.string()),
    guardrails: v.optional(v.object({
      maxCostUsdPerTask: v.number(),
      maxToolCalls: v.number(),
      maxRefundUsd: v.optional(v.number()),
      requiresReviewFor: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    const { roleId, ...patch } = args;
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(roleId, defined);
  },
});

export const activeRoles = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("agentRoles")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", args.orgId).eq("active", true),
      )
      .collect(),
});

// --------------------------------------------------------------- knowledge
export const listKnowledge = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("knowledge")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect(),
});

// Called by the scrape action: replaces the org's knowledge pack.
export const replaceKnowledge = internalMutation({
  args: {
    orgId: v.id("organizations"),
    pages: v.array(v.object({
      url: v.string(),
      title: v.optional(v.string()),
      content: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("knowledge")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    for (const row of old) await ctx.db.delete(row._id);
    for (const page of args.pages) {
      await ctx.db.insert("knowledge", { orgId: args.orgId, ...page, fetchedAt: now() });
    }
    return args.pages.length;
  },
});

// ------------------------------------------------------------------- evals
export const recordEvalRun = mutation({
  args: {
    orgId: v.id("organizations"),
    promptVersion: v.string(),
    passCount: v.number(),
    failCount: v.number(),
    notes: v.optional(v.string()),
    results: v.array(v.object({
      caseId: v.string(),
      pass: v.boolean(),
      actualAction: v.optional(v.string()),
      detail: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const evalRunId = await ctx.db.insert("evalRuns", {
      orgId: args.orgId,
      promptVersion: args.promptVersion,
      startedAt: now(),
      finishedAt: now(),
      passCount: args.passCount,
      failCount: args.failCount,
      notes: args.notes,
    });
    for (const r of args.results) {
      await ctx.db.insert("evalResults", { evalRunId, ...r });
    }
    return evalRunId;
  },
});
