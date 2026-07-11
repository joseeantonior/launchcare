// Specialist tool definitions + handlers.
// Eval mode answers from the case fixture (payment test doubles); real mode
// hits live APIs where a key is configured, otherwise returns a clear
// "not configured" error so the agent takes the escalation path.
// Billing runs on Dodo Payments (docs.dodopayments.com): Bearer key,
// live/test via DODO_API_BASE.

import { readdirSync, readFileSync } from "node:fs";

const def = (name, description, properties, required) => ({
  type: "function",
  function: {
    name, description,
    parameters: { type: "object", properties, required },
  },
});

export const TOOL_DEFS = {
  dodo_lookup: def("dodo_lookup",
    "Look up a customer and their recent payments/subscription in Dodo Payments by email.",
    { email: { type: "string" } }, ["email"]),
  dodo_refund: def("dodo_refund",
    "Refund a verified payment in Dodo Payments (full refund; cite the payment_id).",
    { paymentId: { type: "string" }, reason: { type: "string" } }, ["paymentId"]),
  dodo_invoice: def("dodo_invoice",
    "Fetch the latest payment's invoice link for a customer email (for resending).",
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

// ctx: { mode: "eval"|"real", fixture, dodoKey, knowledgeDir }
export function makeHandlers(ctx) {
  const DODO_BASE = (process.env.DODO_API_BASE ?? "https://live.dodopayments.com").replace(/\/$/, "");
  const dodo = async (path, init) => {
    const res = await fetch(`${DODO_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${ctx.dodoKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    return await res.json();
  };
  // Dodo payments filter by customer_id, not email — resolve the customer first.
  const dodoCustomerByEmail = async (email) => {
    const d = await dodo(`/customers?email=${encodeURIComponent(email)}&page_size=100`);
    return (d.items ?? []).find((c) => c.email?.toLowerCase() === email.toLowerCase());
  };

  return {
    dodo_lookup: async ({ email }) => {
      if (ctx.mode === "eval")
        return {
          source: "dodo payments (eval fixture)",
          email,
          plan: ctx.fixture?.plan,
          status: ctx.fixture?.paymentStatus ?? "no payment record found",
        };
      if (!ctx.dodoKey) return NOT_CONFIGURED("dodo_lookup");
      const customer = await dodoCustomerByEmail(email);
      if (!customer) return { source: "dodo payments", email, status: "no customer found" };
      const payments = await dodo(`/payments?customer_id=${customer.customer_id}&page_size=5`);
      return {
        source: "dodo payments", customerId: customer.customer_id,
        payments: (payments.items ?? []).map((p) => ({
          id: p.payment_id, amountUsd: p.total_amount / 100, currency: p.currency,
          created: p.created_at, status: p.status,
        })),
      };
    },

    dodo_refund: async ({ paymentId, reason }) => {
      if (ctx.mode === "eval")
        return { source: "dodo payments (eval fixture)", refunded: true, paymentId };
      if (!ctx.dodoKey) return NOT_CONFIGURED("dodo_refund");
      return await dodo("/refunds", {
        method: "POST",
        body: JSON.stringify({ payment_id: paymentId, ...(reason ? { reason } : {}) }),
      });
    },

    dodo_invoice: async ({ email }) => {
      if (ctx.mode === "eval")
        return { source: "dodo payments (eval fixture)", email, invoice: "inv_eval_fixture", status: ctx.fixture?.paymentStatus };
      if (!ctx.dodoKey) return NOT_CONFIGURED("dodo_invoice");
      const customer = await dodoCustomerByEmail(email);
      if (!customer) return { email, status: "no customer found" };
      const payments = await dodo(`/payments?customer_id=${customer.customer_id}&page_size=1&status=succeeded`);
      const p = payments.items?.[0];
      return p
        ? { paymentId: p.payment_id, amountUsd: p.total_amount / 100, status: p.status,
            invoiceUrl: `${DODO_BASE}/invoices/payments/${p.payment_id}` }
        : { email, status: "no payments" };
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
