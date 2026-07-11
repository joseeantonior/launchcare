// LaunchCare — core Convex functions.
// Wire Hermes's pre/post tool-call hooks (plugin lifecycle) to logStep so the
// trace builds itself. Every mentor drill maps to one query below.

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const now = () => Date.now();

// -------------------------------------------------------------- settings
async function getSetting(ctx: any, key: string, fallback: any) {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .first();
  return row ? row.value : fallback;
}

export const listSettings = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("settings").collect(),
});

export const setSetting = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
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
    email: v.string(),
    name: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    plan: v.optional(v.string()),
    riskFlags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
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
      .withIndex("by_email", (q) => q.eq("email", args.customerEmail))
      .first();
    return await ctx.db.insert("tickets", {
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

// "This user's past" memory layer: hand this to the manager at kickoff.
export const customerContext = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const customer = await ctx.db
      .query("customers")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    const pastTickets = await ctx.db
      .query("tickets")
      .withIndex("by_customerEmail", (q) => q.eq("customerEmail", args.email))
      .order("desc")
      .take(10);
    return { customer, pastTickets };
  },
});

// ------------------------------------------------------------------- runs
export const startRun = mutation({
  args: {
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
    const stepId = await ctx.db.insert("steps", {
      ...args,
      status: args.status ?? "ok",
      startedAt: now(),
    });
    // Roll up totals onto the run.
    const run = await ctx.db.get(args.runId);
    if (run) {
      const totalCostUsd =
        run.totalCostUsd + (args.costUsd ?? 0);
      await ctx.db.patch(args.runId, {
        totalTokens:
          run.totalTokens + (args.tokensIn ?? 0) + (args.tokensOut ?? 0),
        totalCostUsd,
        stepCount: run.stepCount + 1,
      });
      // Cost-spike alert (Observability L5: "an alert that actually fired").
      const spikeLimit = await getSetting(ctx, "costSpikeUsd", 1.5);
      if (totalCostUsd > spikeLimit && run.totalCostUsd <= spikeLimit) {
        await ctx.db.insert("alerts", {
          type: "cost_spike",
          runId: args.runId,
          message: `Run cost $${totalCostUsd.toFixed(2)} exceeded $${spikeLimit}`,
          thresholdInfo: `costSpikeUsd=${spikeLimit}`,
          firedAt: now(),
          acknowledged: false,
        });
      }
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
    if (args.status === "failed") {
      await ctx.db.insert("alerts", {
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
  args: { sinceMs: v.number() },
  handler: async (ctx, args) => {
    const steps = await ctx.db
      .query("steps")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", args.sinceMs))
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
    status: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let runs = await ctx.db.query("runs").order("desc").take(args.limit ?? 50);
    if (args.status) runs = runs.filter((r) => r.status === args.status);
    if (args.promptVersion)
      runs = runs.filter((r) => r.promptVersion === args.promptVersion);
    return runs;
  },
});

export const openAlerts = query({
  args: {},
  handler: async (ctx) => {
    const alerts = await ctx.db.query("alerts").order("desc").take(25);
    return alerts;
  },
});

// -------------------------------------------------------------- agent roles
export const createRole = mutation({
  args: {
    name: v.string(),
    job: v.string(),
    tools: v.array(v.string()),
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

export const activeRoles = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("agentRoles")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

// ------------------------------------------------------------------- evals
export const recordEvalRun = mutation({
  args: {
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

// Seed the starting org + default guardrail settings. Run once:
//   npx convex run agency:seed
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const defaults: Array<[string, any]> = [
      ["costSpikeUsd", 1.5],
      ["maxRefundAutoUsd", 25],
      ["perTicketBudgetUsd", 0.5],
      ["compBudgetPerCustomerUsd", 30],
    ];
    for (const [key, value] of defaults) {
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      if (!existing)
        await ctx.db.insert("settings", { key, value, updatedAt: now() });
    }
    return "seeded settings — create roles from prompts/specialists.md via createRole";
  },
});
