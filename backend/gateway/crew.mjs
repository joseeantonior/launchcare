// The crew loop: manager plans/delegates/reviews via Novita; specialists run
// as nested conversations with their role's model and tools. Every step
// lands in Convex via logStep so the trace tree builds itself.
//
// When Hermes lands on the box, this file is the only thing it replaces:
// keep resolveTicket's signature and swap the internals for the Hermes
// invocation.

import { chat, extractJson, setModelPrices } from "./llm.mjs";
import { TOOL_DEFS, makeHandlers } from "./tools.mjs";
import { summarize } from "./convex.mjs";
import { readFileSync } from "node:fs";

const MAX_MANAGER_TURNS = 24;

const MANAGER_TOOLS = [
  { type: "function", function: { name: "log_step",
    description: "Log one JSON envelope (plan/review/revision_request/note) into the trace.",
    parameters: { type: "object", properties: {
      stepType: { type: "string", enum: ["plan", "review", "revision_request", "note", "resume"] },
      envelope: { type: "string", description: "the JSON envelope" },
    }, required: ["stepType", "envelope"] } } },
  { type: "function", function: { name: "delegate",
    description: "Delegate one subtask to a specialist role and get its output back.",
    parameters: { type: "object", properties: {
      role: { type: "string" }, goal: { type: "string" },
      context: { type: "string" },
      policyExcerpts: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
    }, required: ["role", "goal", "context"] } } },
  { type: "function", function: { name: "spawn_role",
    description: "Create a new specialist role when no active role fits the subtask.",
    parameters: { type: "object", properties: {
      name: { type: "string" }, job: { type: "string" },
      tools: { type: "array", items: { type: "string" } },
      systemPrompt: { type: "string" },
      maxCostUsdPerTask: { type: "number" }, maxToolCalls: { type: "number" },
    }, required: ["name", "job", "tools", "systemPrompt"] } } },
  { type: "function", function: { name: "escalate",
    description: "Escalate to a human with the full packet (exception only).",
    parameters: { type: "object", properties: {
      destination: { type: "string", enum: ["operator", "founder"] },
      packet: { type: "string", description: "JSON: who, ticketRef, whatHappened, customerHistory, attempts, blocker, recommendation, policyRefs" },
    }, required: ["destination", "packet"] } } },
  { type: "function", function: { name: "finish",
    description: "Emit the FINAL envelope and close the ticket.",
    parameters: { type: "object", properties: {
      action: { type: "string" }, summary: { type: "string" },
      policyRefs: { type: "array", items: { type: "string" } },
      customerReply: { type: "string", description: "the message to send the customer, if any" },
    }, required: ["action", "summary"] } } },
];

// One specialist delegation as a nested tool-use conversation.
async function runSpecialist({ role, delegation, log, handlers, parentStepId }) {
  const tools = role.tools.map((t) => TOOL_DEFS[t]).filter(Boolean);
  const messages = [{
    role: "user",
    content: `DELEGATION:\n${JSON.stringify(delegation, null, 2)}\n\n` +
      `Your guardrails: ${JSON.stringify(role.guardrails)}. ` +
      `When done, reply ONLY with your JSON output object.`,
  }];
  let spentUsd = 0, toolCalls = 0;

  for (let turn = 0; turn < role.guardrails.maxToolCalls + 2; turn++) {
    const r = await chat({ model: role.model, system: role.systemPrompt, messages, tools });
    spentUsd += r.costUsd;

    if (!r.message.tool_calls?.length) {
      const output = extractJson(r.message.content) ?? { raw: r.message.content };
      await log({
        parentStepId, agentRole: role.name, stepType: "draft",
        inputSummary: summarize(delegation.goal),
        outputSummary: summarize(output),
        tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd,
      });
      return output;
    }

    messages.push(r.message);
    for (const tc of r.message.tool_calls) {
      toolCalls++;
      const args = extractJson(tc.function.arguments) ?? {};
      let result;
      if (tc.function.name === "log_step") {
        result = { logged: true };
        await log({ parentStepId, agentRole: role.name, stepType: "note",
          inputSummary: summarize(args.note) });
      } else if (toolCalls > role.guardrails.maxToolCalls) {
        result = { error: "tool budget exhausted; wrap up with what you have" };
      } else {
        const handler = handlers[tc.function.name];
        result = handler ? await handler(args) : { error: `unknown tool ${tc.function.name}` };
        await log({
          parentStepId, agentRole: role.name, stepType: "tool_call",
          toolName: tc.function.name,
          inputSummary: summarize(args),
          outputSummary: summarize(result),
          tokensIn: turn === 0 && tc === r.message.tool_calls[0] ? r.tokensIn : undefined,
          tokensOut: tc === r.message.tool_calls[0] ? r.tokensOut : undefined,
          costUsd: tc === r.message.tool_calls[0] ? r.costUsd : undefined,
          status: result?.error ? "error" : "ok",
        });
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    if (spentUsd > role.guardrails.maxCostUsdPerTask)
      messages.push({ role: "user", content: "Cost guardrail reached. Return your JSON output NOW with needs_escalation if unresolved." });
  }
  return { needs_escalation: true, blocker: "specialist exceeded its turn budget" };
}

// Resolve one ticket end-to-end. Returns the FINAL envelope.
export async function resolveTicket({ convex, orgId, runId, ticket, fixture, mode, dir }) {
  const log = (step) => convex.mutation("agency:logStep", { runId, ...step });

  // ponytail: mock runner proves the plumbing (rows, trace, evals) w/o LLM spend
  if (process.env.RUNNER === "mock") {
    const planId = await log({ agentRole: "manager", stepType: "plan",
      inputSummary: summarize(ticket.subject), outputSummary: "mock plan" });
    await log({ agentRole: "manager", stepType: "final", parentStepId: planId,
      inputSummary: "mock final: reply_only" });
    return { action: "reply_only", summary: "mock runner", policyRefs: [] };
  }

  const [context, roles, settingsRows] = await Promise.all([
    convex.query("agency:customerContext", { orgId, email: ticket.customerEmail }),
    convex.query("agency:activeRoles", { orgId }),
    convex.query("agency:listSettings", { orgId }),
  ]);
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  setModelPrices(settings.modelPricesUsdPerMTok);

  const policy = readFileSync(`${dir}/../policy/policy.md`, "utf8");
  const system = readFileSync(`${dir}/../prompts/manager.md`, "utf8")
    .replaceAll("{{AGENCY_NAME}}", settings.agencyName ?? "LaunchCare")
    .replaceAll("{{PRODUCT_NAME}}", settings.productName ?? "the product");

  const rolesByName = Object.fromEntries(roles.map((r) => [r.name, r]));
  const handlers = makeHandlers({
    mode, fixture, convex, orgId,
    stripeKey: mode === "eval" ? null : process.env.STRIPE_KEY,
    knowledgeDir: `${dir}/../knowledge`,
  });

  const messages = [{
    role: "user",
    content:
      `TICKET:\n${JSON.stringify({ subject: ticket.subject, body: ticket.body, source: ticket.source, email: ticket.customerEmail }, null, 2)}\n\n` +
      `CUSTOMER CONTEXT:\n${JSON.stringify({ ...context, fixture }, null, 2)}\n\n` +
      `POLICY:\n${policy}\n\n` +
      `ACTIVE ROLES:\n${JSON.stringify(roles.map(({ name, job, tools, guardrails }) => ({ name, job, tools, guardrails })), null, 2)}\n\n` +
      `SETTINGS:\n${JSON.stringify(settings)}\n\n` +
      `Work the operating loop now, using your tools for every envelope. End with finish().`,
  }];

  let planStepId; // manager envelopes + delegations parent to the plan
  for (let turn = 0; turn < MAX_MANAGER_TURNS; turn++) {
    const r = await chat({
      model: settings.managerModel ?? "pa/claude-opus-4-8",
      system, messages, tools: MANAGER_TOOLS,
    });
    let usage = { tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd };

    if (!r.message.tool_calls?.length) {
      // Manager replied with prose instead of a tool — nudge once, then fail.
      messages.push(r.message,
        { role: "user", content: "Use your tools (log_step/delegate/finish). Do not reply in prose." });
      continue;
    }

    messages.push(r.message);
    for (const tc of r.message.tool_calls) {
      const args = extractJson(tc.function.arguments) ?? {};
      const name = tc.function.name;
      let result = { ok: true };

      if (name === "log_step") {
        const envelope = extractJson(args.envelope) ?? { raw: args.envelope };
        const stepId = await log({
          agentRole: "manager", stepType: args.stepType,
          parentStepId: args.stepType === "plan" ? undefined : planStepId,
          inputSummary: summarize(envelope),
          status: args.stepType === "revision_request" ? "bounced" : "ok",
          ...usage,
        });
        if (args.stepType === "plan") planStepId = stepId;
      } else if (name === "delegate") {
        const role = rolesByName[args.role];
        if (!role) {
          result = { error: `no active role named ${args.role}; spawn_role first` };
        } else {
          const delegateStepId = await log({
            agentRole: "manager", stepType: "delegate", parentStepId: planStepId,
            inputSummary: summarize(`${args.role}: ${args.goal}`), ...usage,
          });
          result = await runSpecialist({
            role, delegation: args, log, handlers, parentStepId: delegateStepId,
          });
        }
      } else if (name === "spawn_role") {
        // Guardrails clamp: spawned roles are never looser than defaults.
        const guardrails = {
          maxCostUsdPerTask: Math.min(args.maxCostUsdPerTask ?? 0.1, 0.25),
          maxToolCalls: Math.min(args.maxToolCalls ?? 4, 6),
        };
        const roleId = await convex.mutation("agency:createRole", {
          orgId, name: args.name, job: args.job, tools: args.tools,
          model: settings.managerModel ?? "pa/claude-sonnet-5",
          guardrails, systemPrompt: args.systemPrompt, createdBy: "manager_agent",
        });
        rolesByName[args.name] = { _id: roleId, name: args.name, job: args.job,
          tools: args.tools, model: settings.managerModel ?? "pa/claude-sonnet-5",
          guardrails, systemPrompt: args.systemPrompt };
        await log({ agentRole: "manager", stepType: "spawn_role", parentStepId: planStepId,
          inputSummary: summarize(`${args.name}: ${args.job}`), ...usage });
        result = { created: args.name };
      } else if (name === "escalate") {
        const packet = extractJson(args.packet) ?? { raw: args.packet };
        await log({ agentRole: "manager", stepType: "escalation", parentStepId: planStepId,
          inputSummary: summarize(packet), outputSummary: `to ${args.destination}`, ...usage });
        await convex.mutation("agency:raiseAlert", {
          orgId, runId, type: "escalation",
          message: summarize(`[${args.destination}] ${packet.blocker ?? packet.whatHappened ?? args.packet}`),
        });
        // ponytail: ActionLayer/Telegram delivery not wired yet — the alert is
        // the operator surface; resume loop comes with channel integrations.
        result = { escalated: true, note: "human notified; close the run as escalated" };
      } else if (name === "finish") {
        await log({ agentRole: "manager", stepType: "final", parentStepId: planStepId,
          inputSummary: summarize(`${args.action}: ${args.summary}`), ...usage });
        return args;
      }

      usage = {}; // attach LLM usage to the first step of this batch only
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  throw new Error("manager exceeded turn budget without finishing");
}
