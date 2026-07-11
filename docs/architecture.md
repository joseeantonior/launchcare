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

## What's planned (in build order)

1. **Scrape → org designer pipeline** — fetch the tenant's website, extract
   docs/pricing/use-cases into `knowledge/*.md`, draft their `policy.md`, and
   propose the crew (roles + model tiers). **The customer reviews the drafted
   policy before go-live** — policy is the law; scrapers guess numbers wrong.
   (Onboarding currently seeds the default crew; this pipeline personalizes it.)
2. **Provisioner** — Linode API + cloud-init from a golden image: installs
   Node + the backend folder, writes tenant env (Convex URL, org id, Novita
   key, Stripe key), starts the gateway under systemd — exactly the manual
   Step 5 in [deployment.md](deployment.md). Same script works for the
   shared-box tier (one container per tenant) if per-tenant Linodes turn
   out too expensive at the low end.
3. **Channel connectors** — per-tenant inbound email address
   (`acme@inbound.<domain>` via Postmark/SES webhook → `POST /tickets`),
   Telegram bot, phone via ElevenLabs. Plus the escalation resume loop
   (ActionLayer for operator, Telegram for founder).

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

Per-step tokens/cost roll up to runs (`costUsd` via the org's
`modelPricesUsdPerMTok` setting) → per-org COGS is one `costByAgent`-style
query away. Price = token cost × margin + box fee.
