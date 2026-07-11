# LaunchCare

Support-ops agency on Hermes for products that launched today. Working name:
**LaunchCare** ("support ops for products that shipped yesterday") — rename
freely, it's placeholder-ized as {{AGENCY_NAME}} throughout.

Two parts:

- **`backend/`** — a [Convex](https://convex.dev) project: the database schema,
  all queries/mutations (tracing, alerts, roles, evals), the agent prompts,
  the support policy, and the eval runner.
- **`website/`** — the ops dashboard. Plain HTML + one ES module, **no build
  step**. It talks to Convex over its HTTP API, so it deploys to any static
  host as-is.

## Documentation

| Doc | Contents |
|---|---|
| [docs/usage.md](docs/usage.md) | Prerequisites, running backend + dashboard locally, seeding, registering roles, evals, agent wiring |
| [docs/deployment.md](docs/deployment.md) | Backend → Convex cloud, website → Cloudflare Pages / Netlify / your own server |
| [docs/hackathon-notes.md](docs/hackathon-notes.md) | Remaining checklist, rubric math, mentor drills, cautions |

## Quickstart

```bash
cd backend && npm install
CONVEX_AGENT_MODE=anonymous npx convex dev          # local backend, no login
CONVEX_AGENT_MODE=anonymous npx convex run agency:seed   # new terminal
npx serve ../website    # landing page at /, dashboard at /dashboard.html
                        # paste http://127.0.0.1:3210 in the dashboard's top bar
```

Needs Node ≥ 20.12 — details in [docs/usage.md](docs/usage.md).

## Layout

| Path | What it is | Rubric target |
|---|---|---|
| `backend/convex/schema.ts` | Tables: tickets, customers, runs, steps (trace tree), agentRoles, evals, alerts, settings | Observability 7x, Memory 2x, Mgmt-UI 1x |
| `backend/convex/agency.ts` | logStep w/ cost rollup + spike alerts, getRunTree, costByAgent, createRole, eval recording, seed | Observability L4-L5 |
| `backend/prompts/manager.md` | Manager system prompt: plan→delegate→review→act→escalate, role spawning, JSON envelopes | Org structure L4-L5 |
| `backend/prompts/specialists.md` | 4 seed roles w/ guardrail JSON: billing, product, voice_caller, qa_reviewer | Org structure, Working product |
| `backend/policy/policy.md` | The "what the business allows" layer; §numbers referenced everywhere | Memory L5, Working product |
| `backend/evals/cases.jsonl` | 20 cases: T01-T20, expected actions + mustNots | Evals L3 |
| `backend/evals/run.mjs` | Runner: pass/fail vs expected, baseline gate exits 1 on regression | Evals L4 |
| `website/index.html` | Product landing page (hero, features, how-it-works) | Working product |
| `website/dashboard.html` | Ops dashboard: runs + trace tree + 2-run diff, cost by agent, alerts, roles + createRole form, settings editor | Observability L4-L5, Mgmt UI |
| `website/lib.mjs` | Tree builder, PII masking, Convex HTTP client (pure functions) | — |
| `website/test.mjs` | Logic check for lib.mjs — `node website/test.mjs` | — |
