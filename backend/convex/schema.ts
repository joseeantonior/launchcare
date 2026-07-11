// LaunchCare — Convex schema
// Designed against the AI-as-Agency rubric:
//  - steps.parentStepId        -> trace TREE (who called whom)           [Observability L4]
//  - steps.tokens/cost/latency -> cost per step, cost-by-agent queries    [Observability L4, Cost 1x]
//  - runs.promptVersion        -> compare versions, diff runs             [Evals L3-L5]
//  - alerts                    -> "show an alert that actually fired"     [Observability L5]
//  - agentRoles                -> manager can spawn roles (org L5) and a
//                                 volunteer can create one via UI         [Mgmt UI L5]
//  - customers + tickets       -> "this user's past" memory layer         [Memory L4-L5]

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ---------------------------------------------------------------- tickets
  tickets: defineTable({
    source: v.union(
      v.literal("email"),
      v.literal("telegram"),
      v.literal("demo"),
      v.literal("eval"),
      v.literal("api"),
    ),
    channelRef: v.optional(v.string()), // email message-id / telegram msg id
    customerId: v.optional(v.id("customers")),
    customerEmail: v.string(),
    subject: v.string(),
    body: v.string(),
    language: v.optional(v.string()),
    status: v.union(
      v.literal("new"),
      v.literal("planning"),
      v.literal("in_progress"),
      v.literal("waiting_customer"),
      v.literal("waiting_operator"),
      v.literal("resolved"),
      v.literal("escalated"),
      v.literal("failed"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    category: v.optional(v.string()), // billing | access | product | cancel | other
    resolutionSummary: v.optional(v.string()),
    activeRunId: v.optional(v.id("runs")),
    receivedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_customerEmail", ["customerEmail"])
    .index("by_receivedAt", ["receivedAt"]),

  // -------------------------------------------------------------- customers
  customers: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    plan: v.optional(v.string()), // free | pro | team | ...
    mrrUsd: v.optional(v.number()),
    signupAt: v.optional(v.number()),
    riskFlags: v.optional(v.array(v.string())), // e.g. ["repeat_refunder"]
    notes: v.optional(v.string()),
  }).index("by_email", ["email"]),

  // ------------------------------------------------------------------- runs
  // One run = one full crew execution against one ticket (or eval case).
  runs: defineTable({
    ticketId: v.optional(v.id("tickets")),
    kind: v.union(v.literal("ticket"), v.literal("eval"), v.literal("demo")),
    promptVersion: v.string(), // git tag, e.g. "v0.3" — enables run diffing
    status: v.union(
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("escalated"), // policy-correct escalation counts as success
      v.literal("failed"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    totalTokens: v.number(),
    totalCostUsd: v.number(),
    stepCount: v.number(),
    finalAction: v.optional(v.string()), // action vocabulary — see README
    failureReason: v.optional(v.string()),
  })
    .index("by_ticket", ["ticketId"])
    .index("by_status", ["status"])
    .index("by_promptVersion", ["promptVersion"])
    .index("by_startedAt", ["startedAt"]),

  // ------------------------------------------------------------------ steps
  // The trace. parentStepId gives the who-called-whom tree.
  steps: defineTable({
    runId: v.id("runs"),
    parentStepId: v.optional(v.id("steps")),
    agentRole: v.string(), // "manager" | "billing_specialist" | ...
    stepType: v.union(
      v.literal("plan"),
      v.literal("delegate"),
      v.literal("tool_call"),
      v.literal("tool_result"),
      v.literal("draft"),
      v.literal("review"),
      v.literal("revision_request"), // the L4 org-structure "bounce"
      v.literal("escalation"),
      v.literal("resume"),
      v.literal("spawn_role"), // the L5 org-structure signal
      v.literal("final"),
      v.literal("note"),
    ),
    toolName: v.optional(v.string()),
    inputSummary: v.string(), // keep <= 40 words; PII-masked
    outputSummary: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    status: v.union(v.literal("ok"), v.literal("error"), v.literal("bounced")),
    startedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_parent", ["parentStepId"])
    .index("by_agentRole", ["agentRole"])
    .index("by_startedAt", ["startedAt"]),

  // ------------------------------------------------------------- agentRoles
  // Rows here ARE the org chart. Manager inserts a row when it spawns a
  // role mid-task (org L5). A volunteer inserts one via the dashboard
  // during the management-UI test (UI L5).
  agentRoles: defineTable({
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
    active: v.boolean(),
    createdBy: v.union(
      v.literal("founder"),
      v.literal("manager_agent"),
      v.literal("volunteer"),
    ),
    createdAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_active", ["active"]),

  // ------------------------------------------------------------------ evals
  evalCases: defineTable({
    caseId: v.string(), // "T01"..."T20"
    category: v.string(),
    customerFixture: v.object({
      email: v.string(),
      plan: v.string(),
      historySummary: v.optional(v.string()),
      riskFlags: v.optional(v.array(v.string())),
      stripeStatus: v.optional(v.string()),
    }),
    subject: v.string(),
    body: v.string(),
    expected: v.object({
      action: v.string(),
      keyPoints: v.array(v.string()),
      mustNot: v.optional(v.array(v.string())),
      policyRefs: v.optional(v.array(v.string())),
    }),
  })
    .index("by_caseId", ["caseId"])
    .index("by_category", ["category"]),

  evalRuns: defineTable({
    promptVersion: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    passCount: v.number(),
    failCount: v.number(),
    notes: v.optional(v.string()),
  }).index("by_promptVersion", ["promptVersion"]),

  evalResults: defineTable({
    evalRunId: v.id("evalRuns"),
    caseId: v.string(),
    pass: v.boolean(),
    actualAction: v.optional(v.string()),
    detail: v.optional(v.string()),
    runId: v.optional(v.id("runs")),
  }).index("by_evalRun", ["evalRunId"]),

  // ----------------------------------------------------------------- alerts
  alerts: defineTable({
    type: v.union(
      v.literal("run_failed"),
      v.literal("cost_spike"),
      v.literal("latency_spike"),
      v.literal("escalation"),
    ),
    runId: v.optional(v.id("runs")),
    message: v.string(),
    thresholdInfo: v.optional(v.string()),
    firedAt: v.number(),
    acknowledged: v.boolean(),
  }).index("by_firedAt", ["firedAt"]),

  // --------------------------------------------------------------- settings
  // Editable guardrails surfaced in the dashboard (refund limit, budgets).
  settings: defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
