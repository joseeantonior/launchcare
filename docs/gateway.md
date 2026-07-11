# Gateway — the per-box agent service

`backend/gateway/` is the service that runs on each tenant's box. It receives
tickets, runs the agent crew against Novita-hosted models, and records every
step in Convex so the dashboard's trace tree builds itself.

```
channels / eval runner ──► gateway ──► Novita LLM API (manager + specialists)
                             │
                             └───────► Convex (tickets, runs, steps, alerts)
```

## Files

| File | What it does |
|---|---|
| `gateway/index.mjs` | HTTP server: `/health`, `POST /tickets` (real), `POST /resolve` (eval) — ticket/run lifecycle around the crew; picks the runner; starts channel pollers |
| `gateway/crew.mjs` | Built-in runner: manager plans/delegates/reviews with tool calls; specialists run as nested conversations with their role's model and tools |
| `gateway/runner-hermes.mjs` | `RUNNER=hermes` — delegates the run to a Hermes profile; the assumed CLI contract lives ONLY here |
| `gateway/telegram.mjs` | Telegram ingress via long-polling — see [channels.md](channels.md) |
| `gateway/llm.mjs` | Novita client (OpenAI-compatible `chat/completions`), per-model cost calc, JSON extraction |
| `gateway/tools.mjs` | Specialist tools: Dodo Payments (live or eval-fixture), docs_search over the knowledge pack, linkup_search (live web, cited sources), stubs for the rest |
| `gateway/convex.mjs` | Convex HTTP client + PII masking + 40-word summaries |

## Running

```bash
cd backend
cp .env.example .env   # fill in, then export, or inline:
ORG_ID=<orgId> CONVEX_URL=<url> NOVITA_API_KEY=<key> node gateway/index.mjs
```

`RUNNER=mock` resolves every ticket as `reply_only` without touching the LLM —
use it to test plumbing and CI. Verified: the full eval suite runs through the
mock gateway and records runs, steps, and eval results in Convex.

## How a run executes

1. `POST /tickets` (or `/resolve` for an eval case) → `createTicket` + `startRun`.
2. The crew assembles the manager's kickoff context: ticket, `customerContext`
   (memory), `policy/policy.md` (the law), `activeRoles`, settings.
   `{{AGENCY_NAME}}`/`{{PRODUCT_NAME}}` in `prompts/manager.md` are filled from
   the org's `agencyName`/`productName` settings.
3. The manager (model = `managerModel` setting) works its operating loop with
   five tools: `log_step`, `delegate`, `spawn_role`, `escalate`, `finish`.
4. `delegate` spawns the specialist as a nested conversation — its role row
   supplies the system prompt, **model**, tools, and guardrails. Tool calls and
   drafts are logged as steps parented to the delegation; guardrails
   (`maxToolCalls`, `maxCostUsdPerTask`) are enforced in code, not trusted to
   the model.
5. `spawn_role` registers a new role via `createRole` (guardrails clamped —
   spawned roles are never looser than defaults) and logs the `spawn_role` step.
6. `escalate` logs the escalation step and raises an `escalation` alert.
   ActionLayer/Telegram delivery is not wired yet — the alert is the operator
   surface until channel integrations land.
7. `finish` logs the `final` step; the gateway calls `finishRun`
   (`escalate_*` actions → run status `escalated`, which counts as success).

Failures anywhere mark the run `failed` (which fires a `run_failed` alert).

## Models (Novita)

All LLM calls go to Novita's OpenAI-compatible API
(`https://api.novita.ai/openai/v1`) using **partner model names** from the
"Novita Partner LLM Model APIs" doc. Current tiers:

| Agent | Model |
|---|---|
| manager | `pa/claude-opus-4-8` (org setting `managerModel`) |
| billing_specialist | `pa/claude-sonnet-5` |
| product_specialist | `pa/claude-opus-4-8` |
| voice_caller | `pa/claude-sonnet-5` |
| qa_reviewer | `pa/claude-haiku-4-5-20251001` |

Change a role's model in the dashboard (Roles tab) or via `agency:updateRole`.
Senior roles (e.g. a spawned `sr_tech_support`) can use `pa/claude-fable-5`.

**Cost tracking:** tokens are always recorded per step. Dollar cost uses the
org's `modelPricesUsdPerMTok` setting — `{"pa/claude-sonnet-5": {"in": X, "out": Y}, ...}`
($/MTok). Fill it from your Novita account-manager pricing; unknown models
count as $0 but still track tokens.

## Multi-org (judging/demo) mode

`MULTI_ORG=1` makes one box serve **every org** on the deployment: per-org
Telegram pollers (from each org's app-configured token) and per-org
demo-ticket queues (the app's "Try your agency" card writes `source:"demo"`
tickets; the gateway polls `pendingDemoTickets` every 10s and runs them).
This is what lets a judge sign up on the website and have a live agency with
zero provisioning. One box per tenant (`ORG_ID=...`) remains the production
shape.

## Eval mode

`POST /resolve` seeds the case's fixture customer (so the memory layer is
real), then runs with fixture-backed tools: `dodo_lookup` answers from the
case's `paymentStatus`, refunds are simulated, nothing external is touched.
The eval runner (`evals/run.mjs`) POSTs here — see [usage.md](usage.md) §4.

## Knowledge pack

`docs_search` searches the org's **knowledge table in Convex** — filled
automatically at onboarding by `convex/scrape.ts` (fetches the tenant's
website, follows up to 5 same-origin links preferring docs/help/pricing
paths, strips to plain text, ~8k chars/page) and rebuilt on demand via
`agency:rescanWebsite` (the "Rescan" button in the app). Results cite the
source page URL. Markdown files in `backend/knowledge/` on the box are
searched as a fallback for hand-curated docs.

## Runners (Hermes)

`RUNNER` picks the brain; everything else (channels, HTTP routes, Convex
recording, evals, dashboard) is identical:

- *(unset)* — the built-in Novita crew loop (`crew.mjs`).
- `mock` — resolves everything `reply_only` with no LLM spend (plumbing/CI).
- `hermes` — spawns `hermes -p launchcare --yolo -Q -z "<kickoff>"`
  ([Hermes Agent](https://hermes-agent.nousresearch.com) real CLI;
  `HERMES_BIN`/`HERMES_PROFILE` override). The profile's `SOUL.md` carries
  the manager prompt (`scripts/render-hermes-profile.mjs`); the kickoff
  carries the five context blocks plus that run's trace-logging curl, so
  Hermes logs its own steps to `agency:logStep`. The FINAL envelope is the
  last JSON object in its answer. Box setup: [hermes-setup.md](hermes-setup.md).

The Hermes specifics live ONLY in `runner-hermes.mjs` — verified end-to-end
against a stub binary that speaks the documented CLI.
