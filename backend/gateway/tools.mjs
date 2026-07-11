// Specialist tool definitions + handlers.
// Eval mode answers from the case fixture (Stripe test doubles); real mode
// hits live APIs where a key is configured, otherwise returns a clear
// "not configured" error so the agent takes the escalation path.

import { readdirSync, readFileSync } from "node:fs";

const def = (name, description, properties, required) => ({
  type: "function",
  function: {
    name, description,
    parameters: { type: "object", properties, required },
  },
});

export const TOOL_DEFS = {
  stripe_lookup: def("stripe_lookup",
    "Look up a customer and their recent charges/subscription in Stripe by email.",
    { email: { type: "string" } }, ["email"]),
  stripe_refund: def("stripe_refund",
    "Refund a verified charge (full if amountUsd omitted).",
    { chargeId: { type: "string" }, amountUsd: { type: "number" } }, ["chargeId"]),
  stripe_invoice: def("stripe_invoice",
    "Fetch the latest invoice for a customer email (for resending).",
    { email: { type: "string" } }, ["email"]),
  docs_search: def("docs_search",
    "Search the product documentation/knowledge pack.",
    { query: { type: "string" } }, ["query"]),
  linkup_search: def("linkup_search",
    "Live web search for product issues and workarounds.",
    { query: { type: "string" } }, ["query"]),
  elevenlabs_call: def("elevenlabs_call",
    "Place an outbound phone call with the given script.",
    { phone: { type: "string" }, script: { type: "string" } }, ["phone", "script"]),
  actionlayer_start_task: def("actionlayer_start_task",
    "Hand a browser-based errand to ActionLayer with a full context packet.",
    { goal: { type: "string" }, context: { type: "string" } }, ["goal"]),
  log_step: def("log_step",
    "Log a note into the run trace.",
    { note: { type: "string" } }, ["note"]),
};

const NOT_CONFIGURED = (tool) =>
  ({ error: `${tool} is not configured on this box. Do not retry; report the blocker.` });

// ctx: { mode: "eval"|"real", fixture, stripeKey, knowledgeDir }
export function makeHandlers(ctx) {
  const stripe = async (path) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${ctx.stripeKey}` },
    });
    return await res.json();
  };

  return {
    stripe_lookup: async ({ email }) => {
      if (ctx.mode === "eval")
        return {
          source: "stripe (eval fixture)",
          email,
          plan: ctx.fixture?.plan,
          status: ctx.fixture?.stripeStatus ?? "no Stripe record found",
        };
      if (!ctx.stripeKey) return NOT_CONFIGURED("stripe_lookup");
      const customers = await stripe(`customers?email=${encodeURIComponent(email)}&limit=1`);
      const customer = customers.data?.[0];
      if (!customer) return { source: "stripe", email, status: "no Stripe customer found" };
      const charges = await stripe(`charges?customer=${customer.id}&limit=5`);
      return {
        source: "stripe", customerId: customer.id,
        charges: (charges.data ?? []).map((c) => ({
          id: c.id, amountUsd: c.amount / 100, currency: c.currency,
          created: c.created, status: c.status, refunded: c.refunded,
        })),
      };
    },

    stripe_refund: async ({ chargeId, amountUsd }) => {
      if (ctx.mode === "eval")
        return { source: "stripe (eval fixture)", refunded: true, chargeId, amountUsd: amountUsd ?? "full" };
      if (!ctx.stripeKey) return NOT_CONFIGURED("stripe_refund");
      const body = new URLSearchParams({ charge: chargeId });
      if (amountUsd) body.set("amount", String(Math.round(amountUsd * 100)));
      const res = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.stripeKey}` },
        body,
      });
      return await res.json();
    },

    stripe_invoice: async ({ email }) => {
      if (ctx.mode === "eval")
        return { source: "stripe (eval fixture)", email, invoice: "in_eval_fixture", status: ctx.fixture?.stripeStatus };
      if (!ctx.stripeKey) return NOT_CONFIGURED("stripe_invoice");
      const customers = await stripe(`customers?email=${encodeURIComponent(email)}&limit=1`);
      const customer = customers.data?.[0];
      if (!customer) return { email, status: "no Stripe customer found" };
      const invoices = await stripe(`invoices?customer=${customer.id}&limit=1`);
      const inv = invoices.data?.[0];
      return inv
        ? { id: inv.id, hostedUrl: inv.hosted_invoice_url, amountUsd: inv.total / 100, status: inv.status }
        : { email, status: "no invoices" };
    },

    docs_search: async ({ query }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = [];
      // Primary: the org's scraped knowledge pack in Convex.
      const pages = await ctx.convex
        .query("agency:listKnowledge", { orgId: ctx.orgId })
        .catch(() => []);
      for (const p of pages) {
        for (const sentence of p.content.split(/(?<=[.!?])\s+/)) {
          if (terms.some((t) => sentence.toLowerCase().includes(t)))
            hits.push({ source: p.title ?? p.url, url: p.url, excerpt: sentence.trim().slice(0, 300) });
          if (hits.length >= 12) break;
        }
        if (hits.length >= 12) break;
      }
      // Fallback: markdown files dropped on the box.
      let files = [];
      try { files = readdirSync(ctx.knowledgeDir).filter((f) => f.endsWith(".md")); } catch {}
      for (const f of files) {
        if (hits.length >= 12) break;
        for (const line of readFileSync(`${ctx.knowledgeDir}/${f}`, "utf8").split("\n")) {
          if (terms.some((t) => line.toLowerCase().includes(t)))
            hits.push({ source: f, excerpt: line.trim().slice(0, 300) });
          if (hits.length >= 12) break;
        }
      }
      if (!hits.length && !pages.length && !files.length)
        return { results: [], note: "no knowledge pack for this org yet" };
      return { results: hits };
    },

    linkup_search: async ({ query }) => {
      if (!process.env.LINKUP_KEY) return NOT_CONFIGURED("linkup_search");
      const res = await fetch("https://api.linkup.so/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINKUP_KEY}`,
        },
        body: JSON.stringify({ q: query, depth: "standard", outputType: "sourcedAnswer" }),
      });
      if (!res.ok) return { error: `linkup ${res.status}: ${(await res.text()).slice(0, 200)}` };
      const d = await res.json();
      return {
        answer: d.answer,
        sources: (d.sources ?? []).slice(0, 5).map(({ name, url, snippet }) => ({ name, url, snippet })),
      };
    },
    elevenlabs_call: async () => NOT_CONFIGURED("elevenlabs_call"),
    actionlayer_start_task: async () => NOT_CONFIGURED("actionlayer_start_task"),
    // log_step is intercepted by the crew loop, never dispatched here.
  };
}
