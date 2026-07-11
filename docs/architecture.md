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
- **Tenant bootstrap, scripted**: `agency:createOrganization` (org + default
  settings) + `scripts/register-roles.mjs` (seed crew from specialists.md).

## What's planned (in build order)

1. **User Dashboard app** — Auth0 sign-in, onboarding wizard (company name +
   website), tool connections. Auth0 org → `organizations.auth0UserId`.
2. **Scrape → org designer pipeline** — fetch the tenant's website, extract
   docs/pricing/use-cases into `knowledge/*.md`, draft their `policy.md`, and
   propose the crew (roles + model tiers). **The customer reviews the drafted
   policy before go-live** — policy is the law; scrapers guess numbers wrong.
3. **Provisioner** — Linode API + cloud-init from a golden image: installs
   Node + the backend folder, writes tenant env (Convex URL, org id, Novita
   key, Stripe key), starts the gateway under systemd. Same script works for
   the shared-box tier (one container per tenant) if per-tenant Linodes turn
   out too expensive at the low end.
4. **Channel connectors** — per-tenant inbound email address
   (`acme@inbound.<domain>` via Postmark/SES webhook → `POST /tickets`),
   Telegram bot, phone via ElevenLabs. Plus the escalation resume loop
   (ActionLayer for operator, Telegram for founder).

## Security notes (before real money flows)

- Convex functions are currently public — anyone with the deployment URL can
  call any of them. Gate mutations behind Convex auth or a shared-secret HTTP
  action before production.
- Tenant secrets live only on the tenant's box (env), never in Convex.
- Stripe keys should be restricted scope: charges:read + refunds:write.
- PII is masked in every trace summary and dashboard surface.

## Billing model

Per-step tokens/cost roll up to runs (`costUsd` via the org's
`modelPricesUsdPerMTok` setting) → per-org COGS is one `costByAgent`-style
query away. Price = token cost × margin + box fee.
