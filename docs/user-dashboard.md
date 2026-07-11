# User Dashboard (website/app.html)

The customer-facing app: sign up, onboard your company, meet your agent
crew, and watch it work. This is the "User Dashboard" from the product spec —
distinct from the internal ops dashboard (`dashboard.html`), which can see
every org and stays an admin tool.

## The flow

1. **Sign in / Sign up** — Auth0 (Universal Login). New and returning users,
   same button.
2. **Onboarding** — company name + website → one Convex mutation
   (`onboardOrganization`) creates the org, seeds its settings (guardrails,
   `managerModel`, prices placeholder), and registers the **default crew**
   from `backend/convex/defaultCrew.js` with per-role model tiers.
   Idempotent: signing in again lands on the existing org.
3. **Home** — your crew, next-steps checklist, support-email setting, and
   the live ops view for *your org only* (the ops dashboard embedded with
   `?org=<id>&embed=1`, selector hidden).

   The **knowledge pack** builds itself: onboarding schedules a scrape of
   the company's website (Convex action, background); the home screen shows
   "N pages scanned" once done, with a **Rescan** button
   (`agency:rescanWebsite`) to rebuild after site changes. The crew's
   `docs_search` answers from these pages, citing URLs.

## Managing the crew

On the home screen users can:

- **Change any agent's model** — a dropdown per row (curated Novita partner
  models: Fable 5 for the hardest work down to Haiku 4.5 for cheap/fast;
  plus GPT/Gemini/Grok options). Saves immediately via `agency:updateRole`.
- **Add an agent** — "+ Add an agent": name, job, model, tool checkboxes,
  and instructions (system prompt). Created via `agency:createRole` with
  fixed sane guardrails ($0.15/task, 5 tool calls — knobs stay hidden until
  someone needs them). The gateway picks new roles up on the next run; the
  manager can delegate to them right away.

## Pricing

- **Manager: $4.99/month** (every agency has one).
- **Each specialist: $4.99–$19.99/month by model tier** — Haiku-class $4.99,
  Sonnet/GPT/Gemini/Grok-class $9.99, Opus-class $14.99, Fable-class $19.99.
  Unknown/custom models bill mid-tier ($9.99) for now.
- The crew screen shows the per-agent price and the live monthly total;
  model changes reprice immediately.
- The price list is the `MODELS` table in `app.html`. **Display only today**
  — checkout/subscription collection isn't wired yet; when real billing
  lands, the price table moves server-side so the client can't argue about
  it.

## Configuration (`/config.js`)

The app loads `config.js` for its Convex URL and Auth0 settings.

- **Production (Cloudflare Worker):** `website/worker.js` serves `/config.js`
  dynamically from the Worker's environment variables — `CONVEX_URL`,
  `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`. Set them in `website/wrangler.jsonc`
  (`vars`) or in the Cloudflare dashboard → your Worker → **Settings →
  Variables and Secrets** → add the three variables → redeploy is not needed
  (dashboard vars apply on save). Step-by-step: [deployment.md](deployment.md).
- **Local:** copy `website/config.example.js` to `website/config.js` (it's
  gitignored). No `config.js` at all → **dev mode**.

## Dev mode (no Auth0 configured)

Missing `auth0Domain`/`auth0ClientId` → the app skips sign-in entirely:
onboarding works unauthenticated, the created org is remembered in the
browser (localStorage) instead of being bound to a user. This keeps local
development running with zero accounts. A "dev mode" pill shows in the
header.

## Auth0 setup (one-time)

1. https://manage.auth0.com → Applications → **Create Application** →
   *Single Page Web Applications*.
2. In the app's Settings, set **Allowed Callback URLs**, **Allowed Logout
   URLs**, and **Allowed Web Origins** to your site origin(s), e.g.
   `https://launchcare.<you>.workers.dev, http://localhost:8080`.
3. Copy the **Domain** and **Client ID** into the Worker variables (prod)
   and/or `website/config.js` (local).
4. Tell Convex to trust those tokens:
   ```bash
   cd backend
   npx convex env set AUTH0_DOMAIN <your-tenant>.us.auth0.com
   npx convex env set AUTH0_CLIENT_ID <client id>
   ```
   (`backend/convex/auth.config.ts` reads these; empty values = no identity
   validation, i.e. dev mode. The vars must exist even if empty — Convex
   refuses to deploy an auth config with unset variables.)

## How auth reaches Convex

The app gets the Auth0 **id_token** and sends it as `Authorization: Bearer`
on every Convex HTTP call (`convexClient(url, token)` in `lib.mjs`). Convex
validates it against `auth.config.ts`; functions see the user via
`ctx.auth.getUserIdentity()`. `onboardOrganization` binds the org to
`identity.subject`; `myOrganization` finds it again on later visits.

## Security state (honest)

Signed-in identity is **used** but not yet **required**: every function
still accepts unauthenticated calls (needed for dev mode, gateway boxes, and
the admin dashboard). Before real tenants: require identity on
customer-facing mutations, move the gateway to a shared-secret header, and
restrict the admin dashboard. Tracked in [architecture.md](architecture.md).
