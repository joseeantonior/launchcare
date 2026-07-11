# Architecture — multi-tenant plan

The product: each company that signs up gets its own agent crew on its own
box, configured from their website and policies, resolving their support
tickets end-to-end. Two planes:

```
CONTROL PLANE (build once)                DATA PLANE (one per tenant)
┌─────────────────────────────┐           ┌──────────────────────────────┐
│ User Dashboard (Auth0)      │           │ Linode box                   │
│  • onboarding: name+website │ provision │  • gateway (backend/gateway) │
│  • website scrape →         │ ────────► │  • prompts + policy +        │
│    knowledge pack + policy  │           │    knowledge pack            │
│  • tool connections (Stripe)│           │  • tenant secrets (env)      │
│  • org designer: crew +     │           │  • (Hermes, when it lands)   │
│    model tiers              │           └───────────────┬──────────────┘
│  • billing (token margin)   │                           │
└──────────────┬──────────────┘                           ▼
               │              ┌───────────────────────────────────────────┐
               └────────────► │ Convex cloud — SHARED, org-scoped:        │
                              │ organizations, tickets, customers, runs,  │
                              │ steps, agentRoles, alerts, settings, evals│
                              └───────────────┬───────────────────────────┘
                                              │ HTTP API (CORS)
                              ┌───────────────▼───────────────┐
                              │ website/ — landing + ops      │
                              │ dashboard (org selector)      │
                              └───────────────────────────────┘
```

## What exists today

- **Data plane, fully working**: multi-tenant Convex schema (every table
  org-scoped), the gateway with the Novita-backed crew loop, per-role model
  tiers, guardrails enforced in code, full trace observability, evals with a
  regression gate, the ops dashboard. Verified end-to-end with the mock
  runner; live-LLM path needs `NOVITA_API_KEY`.
- **User Dashboard** (`app.html`): Auth0 sign-in (dev mode without it),
  onboarding that creates the org + settings + default crew in one mutation
  and binds it to the Auth0 user, customer home with the org-locked ops
  view embedded. Config via Cloudflare Worker vars → `/config.js`.
  See [user-dashboard.md](user-dashboard.md).
- **Tenant bootstrap**: app onboarding (full), or CLI
  (`agency:createOrganization` + `scripts/register-roles.mjs`; crew data in
  `convex/defaultCrew.js`).
- **Website scrape → knowledge pack**: Linkup-powered when LINKUP_KEY is set (domain-restricted search, clean content); naive crawler fallback. Onboarding schedules a Convex action
  (`convex/scrape.ts`) that crawls the tenant's site (homepage + ~5
  docs-ish same-origin pages) into the org's `knowledge` table; the crew's
  `docs_search` cites it. "Rescan" in the app rebuilds it.

## What's planned (in build order)

1. **Org designer** (rest of the onboarding pipeline) — use the scraped
   knowledge to draft the tenant's `policy.md` and propose a personalized
   crew (roles + model tiers) instead of the fixed default. **The customer
   reviews the drafted policy before go-live** — policy is the law; scrapers
   guess numbers wrong.
2. **Provisioner** — Linode API + cloud-init from a golden image: installs
   Node + the backend folder, writes tenant env (Convex URL, org id, Novita
   key, Stripe key), starts the gateway under systemd — exactly the manual
   Step 5 in [deployment.md](deployment.md). Same script works for the
   shared-box tier (one container per tenant) if per-tenant Linodes turn
   out too expensive at the low end.
3. **Remaining channel connectors** — Telegram ingress is DONE
   ([channels.md](channels.md), long-polling, no inbound ports). Still to
   build: per-tenant inbound email (`acme@inbound.<domain>` via Postmark/SES
   webhook → `POST /tickets`), phone via ElevenLabs, and the escalation
   resume loop (ActionLayer for operator, outbound Telegram for founder —
   the poller module already exposes the send API).

## Security notes (before real money flows)

- Convex functions are currently public — anyone with the deployment URL can
  call any of them. Auth0 identity is now **used** (onboarding binds orgs,
  `myOrganization`) but not **required** anywhere. Next hardening step:
  require identity on customer-facing mutations, give gateway boxes a
  shared-secret header, restrict the admin dashboard queries.
- Tenant secrets live only on the tenant's box (env), never in Convex.
- Stripe keys should be restricted scope: charges:read + refunds:write.
- PII is masked in every trace summary and dashboard surface.

## Billing model

**Revenue** — per-agent subscriptions ([user-dashboard.md](user-dashboard.md)
→ Pricing): manager $4.99/mo + each specialist $4.99–$19.99/mo by model
tier. Displayed and totaled in the app today; checkout not yet wired.

**COGS** — per-step tokens/cost roll up to runs (`costUsd` via the org's
`modelPricesUsdPerMTok` setting) → per-org cost is one `costByAgent`-style
query away, plus the box fee. The tier prices are set so the margin covers
typical token volume; the cost rollups tell you when a tenant breaks the
model.
