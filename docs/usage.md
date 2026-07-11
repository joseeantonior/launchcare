# Usage

How to run and use LaunchCare locally. Deployment: [deployment.md](deployment.md).
Agent internals: [gateway.md](gateway.md). Big picture: [architecture.md](architecture.md).

## Prerequisites

- **Node.js ≥ 20.12** (the Convex CLI uses `util.styleText`; Node 21.1 fails
  with `styleText is not a function`). On this machine nvm's 21.1 shadows
  Homebrew's Node 26 — prefix commands with `PATH="/opt/homebrew/bin:$PATH"`
  or `nvm install 22 && nvm use 22`.
- A [Convex account](https://dashboard.convex.dev) — **only for cloud
  deployment**. Local development needs no account.
- A Novita API key (https://novita.ai/settings/key-management) for live agent
  runs. Not needed for the mock runner or the dashboard.

## 1. Backend — run locally

```bash
cd backend
npm install

# Local, no-login Convex deployment (data lives on your machine):
CONVEX_AGENT_MODE=anonymous npx convex dev
```

`convex dev` validates and pushes `convex/schema.ts` + `convex/agency.ts`,
writes the deployment URL to `backend/.env.local` (locally
`http://127.0.0.1:3210`), and stays running with hot-reload. **The local
backend stops when this process exits.**

To use a real Convex cloud deployment instead, drop the env prefix and log
in: `npx convex dev`.

## 2. Create an organization

Everything is org-scoped (multi-tenant). Bootstrap one — this also seeds its
default settings (guardrails, `managerModel`, names):

```bash
CONVEX_AGENT_MODE=anonymous npx convex run agency:createOrganization '{"name":"demo","website":"https://example.com"}'
# → returns the orgId; you'll use it everywhere below
```

## 3. Register the specialist crew

`prompts/specialists.md` is the single source of truth (role JSON + prompt +
Novita model per role). Register all four in one command (idempotent):

```bash
node scripts/register-roles.mjs --org <orgId>
```

Or create roles one-off in the dashboard (Roles tab → Create role — this is
also the volunteer/Mgmt-UI test). Patch an existing role (model, guardrails,
retire) with `agency:updateRole`.

## 4. Gateway — run the agent crew

```bash
cd backend
cp .env.example .env   # see the file for every variable
ORG_ID=<orgId> CONVEX_URL=http://127.0.0.1:3210 NOVITA_API_KEY=<key> node gateway/index.mjs
```

- `POST localhost:8787/tickets` `{"customerEmail","subject","body"}` — run a
  real ticket end-to-end.
- `RUNNER=mock` env — every ticket resolves as `reply_only` with no LLM
  spend; use for plumbing tests.

Details of the crew loop, tools, and model tiers: [gateway.md](gateway.md).

## 5. Dashboard — run locally

```bash
npx serve website          # or: python3 -m http.server 8080 -d website
```

`/` is the product landing page; the ops dashboard is at `/dashboard.html`.
Paste your Convex URL in the top bar, then **pick the org** in the dropdown
(both persist in localStorage). Tabs:

- **Runs** — filter, click a run for its trace tree, check two runs to diff.
- **Cost by agent** — spend/tokens/steps per role, last 24 h.
- **Alerts** — cost spikes, failures, escalations.
- **Roles** — the live org chart (with each role's model) + create-role form.
- **Settings** — edit guardrails, `managerModel`, `modelPricesUsdPerMTok`.

Sanity check after editing `website/lib.mjs`: `node website/test.mjs`.

## 6. Evals

The runner POSTs each case to the gateway's `/resolve` (eval mode:
fixture-backed tools, no live Stripe/inbox). Start the gateway first, then:

```bash
cd backend
node evals/run.mjs --version v0.2 --org <orgId>   # all 20 cases + record in Convex
node evals/run.mjs --version v0.2 --case T11      # a single case
node evals/run.mjs --baseline                     # snapshot passes as baseline
```

Results land in `evals/results-<version>.json` and (with `--org`) in Convex
for the dashboard trend. If a `baseline.json` exists and passes drop below
it, the runner **exits 1** — wire it into your merge flow as the regression
gate.

## 7. Channels (not wired yet)

Inbound email/Telegram/phone connectors and the escalation resume loop are
the next build phase — see [architecture.md](architecture.md). Until then,
`POST /tickets` is the ingress, and escalations surface as dashboard alerts.

Action vocabulary (manager FINAL envelope = eval comparison key):
`reply_only, refund_full, refund_partial, credit, deny_refund,
resend_access, resend_invoice, retention_offer, cancel_subscription,
schedule_call, merge_duplicate, escalate_operator, escalate_founder`
