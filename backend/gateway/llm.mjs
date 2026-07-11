// Novita LLM client — OpenAI-compatible chat/completions.
// Model ids are Novita partner names ("pa/claude-sonnet-5", ...); see the
// Novita Partner LLM Model APIs doc.

const BASE = (process.env.NOVITA_BASE_URL ?? "https://api.novita.ai/openai/v1")
  .replace(/\/$/, "");

// $/MTok per model, loaded from the org's modelPricesUsdPerMTok setting
// (fill it from your Novita account-manager pricing). Unknown model -> cost 0,
// tokens are still tracked.
let PRICES = {};
export const setModelPrices = (p) => { PRICES = p ?? {}; };

export function costUsd(model, tokensIn, tokensOut) {
  const p = PRICES[model];
  if (!p) return 0;
  return (tokensIn * (p.in ?? 0) + tokensOut * (p.out ?? 0)) / 1e6;
}

// One chat-completions call. Returns { message, tokensIn, tokensOut, costUsd }.
export async function chat({ model, system, messages, tools, maxTokens = 4096 }) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NOVITA_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    }),
  });
  if (!res.ok) throw new Error(`novita ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error(`novita: empty response ${JSON.stringify(data).slice(0, 200)}`);
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  return { message, tokensIn, tokensOut, costUsd: costUsd(model, tokensIn, tokensOut) };
}

// Best-effort JSON from a model's final text.
export function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
