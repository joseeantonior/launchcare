# LaunchCare

Support-ops agency for products that launched today. Each company that signs
up gets its own agent crew — a manager plus specialists on per-role model
tiers — resolving support tickets end-to-end under a written policy, with
full trace observability and eval-gated releases.

Two parts:

- **`backend/`** — the [Convex](https://convex.dev) data layer (multi-tenant,
  org-scoped), the **gateway** (the per-tenant agent service: manager +
  specialist crew on Novita-hosted models), agent prompts, the support
  policy, and the eval suite.
- **`website/`** — the product landing page + ops dashboard. Plain HTML, no
  build step, deploys to any static host.

## Documentation

| Doc | Contents |
|---|---|
| [docs/usage.md](docs/usage.md) | Run everything locally: Convex, org bootstrap, roles, gateway, website, evals |
| [docs/user-dashboard.md](docs/user-dashboard.md) | The customer app: sign-up flow, onboarding, Auth0 setup, config, dev mode |
| [docs/gateway.md](docs/gateway.md) | The agent service: crew loop, tools, Novita models per role, eval mode, runners (incl. `RUNNER=hermes`) |
| [docs/channels.md](docs/channels.md) | **ELI5: connect Telegram** (bot → box → talking to your agent in 5 min), direct HTTP ingress, what's next |
| [docs/architecture.md](docs/architecture.md) | Multi-tenant plan: control plane vs data plane, what exists vs what's next, security, billing |
| [docs/deployment.md](docs/deployment.md) | **ELI5 zero-to-production walkthrough** + reference: Convex cloud, Cloudflare Worker (incl. variables), tenant boxes |
| [docs/hackathon-notes.md](docs/hackathon-notes.md) | Checklist, rubric math, mentor drills, cautions |

## Quickstart

```bash
cd backend && npm install
CONVEX_AGENT_MODE=anonymous npx convex dev              # local data layer, no login
npx serve ../website                                    # / landing, /app.html customer app, /dashboard.html ops
# open /app.html → onboard (dev mode) → org + crew created; then run its gateway:
ORG_ID=<orgId> CONVEX_URL=http://127.0.0.1:3210 NOVITA_API_KEY=<key> node gateway/index.mjs
```

Needs Node ≥ 20.12 — details and every option in [docs/usage.md](docs/usage.md).

## Layout

| Path | What it is |
|---|---|
| `backend/convex/schema.ts` | Multi-tenant tables: organizations, tickets, customers, runs, steps (trace tree), agentRoles (with per-role model), evals, alerts, settings |
| `backend/convex/agency.ts` | Onboarding + org bootstrap, logStep w/ cost rollup + spike alerts, getRunTree, costByAgent, roles CRUD, eval recording |
| `backend/convex/defaultCrew.js` | The default 4-role crew (prompts, tools, guardrails, model tiers) — single source of truth |
| `backend/convex/auth.config.ts` | Auth0 → Convex identity (env-driven; empty = dev mode) |
| `backend/gateway/` | Per-tenant agent service: HTTP ingress, crew loop (manager + specialists via Novita), tools, tracing |
| `backend/prompts/manager.md` | Manager system prompt: plan→delegate→review→act→escalate, role spawning, JSON envelopes |
| `backend/prompts/specialists.md` | Seed crew w/ guardrails + model tiers (single source of truth for `register-roles.mjs`) |
| `backend/policy/policy.md` | The "what the business allows" layer; §numbers cited in every decision |
| `backend/scripts/register-roles.mjs` | Idempotent crew registration for an org |
| `backend/evals/` | 20 cases + runner (POSTs to the gateway; baseline gate exits 1 on regression) |
| `backend/knowledge/` | Per-tenant docs pack searched by `docs_search` (scrape pipeline output) |
| `backend/.env.example` | Every env var a tenant box needs |
| `website/index.html` | Product landing page |
| `website/app.html` | Customer app: Auth0 sign-in, onboarding, crew view, embedded org-locked ops view |
| `website/dashboard.html` | Internal ops dashboard: org selector, runs + trace tree + diff, cost by agent, alerts, roles, settings |
| `website/worker.js` + `wrangler.jsonc` | Cloudflare Worker: serves `/config.js` from Worker vars + all static pages |
| `website/config.example.js` | Local config template (`config.js` is gitignored) |
| `website/lib.mjs` + `test.mjs` | Shared client/logic + its check (`node website/test.mjs`) |
