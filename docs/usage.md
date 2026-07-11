# Usage

How to run and use LaunchCare locally. For putting it on the internet, see
[deployment.md](deployment.md).

## Prerequisites

- **Node.js ≥ 20.12** (the Convex CLI uses `util.styleText`; Node 21.1 fails
  with `styleText is not a function`). On this machine nvm's 21.1 shadows
  Homebrew's Node 26 — prefix commands with `PATH="/opt/homebrew/bin:$PATH"`
  or `nvm install 22 && nvm use 22`.
- npm (comes with Node).
- A [Convex account](https://dashboard.convex.dev) — **only for cloud
  deployment**. Local development needs no account.

## 1. Backend — run locally

```bash
cd backend
npm install

# Local, no-login Convex deployment (data lives on your machine):
CONVEX_AGENT_MODE=anonymous npx convex dev
```

`convex dev` validates `schema.ts` + `agency.ts`, pushes them, writes the
deployment URL to `backend/.env.local` (locally that's
`http://127.0.0.1:3210`), and stays running with hot-reload. Leave it up
while developing — **the local backend stops when this process exits.**

Seed the default guardrail settings (new terminal):

```bash
cd backend
CONVEX_AGENT_MODE=anonymous npx convex run agency:seed
```

To use a real Convex cloud dev deployment instead (data persists, shareable
URL), drop the env prefix and log in:

```bash
npx convex dev   # prompts for login + project on first run
```

## 2. Register the specialist roles

The 4 seed roles live in `../backend/prompts/specialists.md`. Register each
one either:

- **Via the dashboard** — Roles tab → "Create role" form (this is also the
  volunteer/Mgmt-UI test), or
- **Via CLI** — one command per role, guardrail JSON copied from
  `specialists.md`:

```bash
npx convex run agency:createRole '{
  "name": "billing_specialist",
  "job": "Verify payment facts in Stripe and execute refunds, credits, and invoice actions within guardrails.",
  "tools": ["stripe_lookup", "stripe_refund", "stripe_invoice", "log_step"],
  "guardrails": { "maxCostUsdPerTask": 0.15, "maxToolCalls": 6, "maxRefundUsd": 25,
                  "requiresReviewFor": ["refund", "credit", "cancel"] },
  "systemPrompt": "<paste the role prompt from specialists.md>",
  "createdBy": "founder"
}'
```

(Prefix with `CONVEX_AGENT_MODE=anonymous` when running against the local
deployment.)

## 3. Website — run locally

No build step. Serve the folder with anything:

```bash
npx serve website          # or: python3 -m http.server 8080 -d website
```

`/` is the product landing page; the ops dashboard is at `/dashboard.html`.
Open the dashboard and paste your Convex deployment URL (the `CONVEX_URL` value from
`backend/.env.local`, e.g. `http://127.0.0.1:3210` locally or
`https://<name>.convex.cloud` in the cloud) into the top bar. It's saved in
localStorage. The page polls every 5 s.

Dashboard tour:

- **Runs** — filter by status/promptVersion; click a run for its trace tree
  (built from `parentStepId`); check two runs to diff them side by side.
- **Cost by agent** — spend/tokens/steps per agent role, last 24 h.
- **Alerts** — cost spikes and failed runs, latest 25.
- **Roles** — the live org chart + the createRole form.
- **Settings** — edit guardrail values (`costSpikeUsd`, `maxRefundAutoUsd`,
  `perTicketBudgetUsd`, `compBudgetPerCustomerUsd`) in place.

Sanity check after editing `website/lib.mjs`:

```bash
node website/test.mjs
```

## 4. Evals

`backend/evals/run.mjs` runs the 20 cases in `cases.jsonl` against your
agent and compares the final envelope `action` to `expected.action`.

**One-time wiring:** edit `resolveTicket()` in `run.mjs` to call your agent
(shell out to your Hermes entrypoint or POST to a local endpoint — both
patterns are in the comment above the function). Keep `mode:"eval"` so
tickets write with source `eval` and never touch the real inbox or Stripe
live mode.

```bash
cd backend
node evals/run.mjs --version v0.2             # run all 20 cases
node evals/run.mjs --version v0.2 --case T11  # a single case
node evals/run.mjs --baseline                 # snapshot current passes as baseline
```

Results are written to `evals/results-<version>.json`. If a `baseline.json`
exists and the pass count drops below it, the runner **exits 1** — wire it
into your merge flow as the regression gate. Push results to Convex for the
dashboard trend with `agency:recordEvalRun` (the runner prints the exact
command).

## 5. Agent wiring (Hermes)

Env vars the agent side expects — set them where your Hermes profile runs,
and in the Convex dashboard (see [deployment.md](deployment.md)) for
anything used inside Convex functions:

```
CONVEX_URL          # from .env.local (dev) or the Convex dashboard (prod)
STRIPE_KEY          # restricted scope: charges:read + refunds:write, capped if possible
ELEVENLABS_KEY      # voice_caller
LINKUP_KEY          # product_specialist live search
DODO_KEY
ACTIONLAYER_TOKEN   # operator escalations
TELEGRAM_TOKEN      # founder escalations
```

- Manager prompt (`backend/prompts/manager.md`) = system prompt; specialists
  run as subagents whose delegations come from the manager's DELEGATE
  envelopes.
- Hook Hermes's plugin lifecycle (pre/post tool call) to `agency:logStep` so
  the trace builds itself; include tokens/cost from the provider response.
  `parentStepId` rules are in `manager.md` → Tracing duties.
- `mode:"eval"` tickets: source `eval`, Stripe test mode, inbox suppressed.

Action vocabulary (manager FINAL envelope = eval comparison key):
`reply_only, refund_full, refund_partial, credit, deny_refund,
resend_access, resend_invoice, retention_offer, cancel_subscription,
schedule_call, merge_duplicate, escalate_operator, escalate_founder`
