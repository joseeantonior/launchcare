# Deployment

**Start here: the [ELI5 production walkthrough](#eli5-going-to-production-from-zero)**
takes you from nothing to a live product, one step at a time. Reference
sections for each piece follow it.

Three deployable pieces:

| Piece | Where it runs | You manage |
|---|---|---|
| Data layer (`backend/convex/`) | Convex cloud | nothing — they host it |
| Website + User Dashboard (`website/`) | Cloudflare Worker | 3 environment variables |
| Gateway (`backend/gateway/`) | one Linode per tenant | the box + its `.env` |

---

## ELI5 — going to production from zero

Do these in order. Every command is copy-pasteable; every click is spelled
out. You need: a GitHub account (you have the repo), a credit card for
Linode, and ~45 minutes.

### Step 1 — Put the data layer on Convex cloud (~5 min)

Convex is the database + API. They host it; there is no server to run.

```bash
cd backend
npm install                       # once, if you haven't
npx convex login                  # opens a browser; log in with GitHub
npx convex dev --configure new    # answer the prompts: new project, name it "launchcare"
```

When it says "Convex functions ready", press Ctrl-C. Now push to
**production** (Convex gives every project a separate prod deployment):

```bash
npx convex deploy
```

It prints your production URL, like `https://brave-otter-123.convex.cloud`.
**Write it down — you'll paste it 3 more times.** (Also findable any time at
https://dashboard.convex.dev → your project → Settings → URL.)

Convex will refuse to deploy until the Auth0 variables exist. Create them
empty for now (Step 4 fills them). **Careful: `env set` targets the DEV
deployment by default — production needs `--prod`:**

```bash
npx convex env set AUTH0_DOMAIN -- ""
npx convex env set AUTH0_CLIENT_ID -- ""
npx convex env set --prod AUTH0_DOMAIN -- ""
npx convex env set --prod AUTH0_CLIENT_ID -- ""
```

### Step 2 — Put the website on Cloudflare (~5 min)

```bash
npm i -g wrangler          # Cloudflare's CLI, once
cd ../website
wrangler login             # opens a browser
wrangler deploy            # reads wrangler.jsonc, deploys worker + all pages
```

It prints your site URL, like `https://launchcare.<your-subdomain>.workers.dev`.
Open it — the landing page should be live. **Write the URL down.**

### Step 3 — Give the website its variables (~2 min)

The app (`/app.html`) reads its configuration from the Worker's environment
variables. To set them:

1. Go to https://dash.cloudflare.com → **Workers & Pages** → click
   **launchcare**.
2. **Settings** tab → **Variables and Secrets** → **Add**.
3. Add these three, as plain text (they are not secrets):
   - `CONVEX_URL` = your Convex prod URL from Step 1
   - `AUTH0_DOMAIN` = leave empty for now (Step 4)
   - `AUTH0_CLIENT_ID` = leave empty for now (Step 4)
4. Click **Deploy** (Cloudflare applies variables immediately).

(Equivalent without clicking: edit the `"vars"` block in
`website/wrangler.jsonc` and run `wrangler deploy` again. Dashboard values
override wrangler.jsonc values.)

Check: open `https://<your-site>/config.js` — you should see your Convex URL
in it. Until Step 4 is done, the app runs in **dev mode** (no sign-in — fine
for testing, don't onboard real customers yet).

### Step 4 — Turn on sign-in with Auth0 (~10 min)

1. Create a free account at https://auth0.com.
2. In https://manage.auth0.com: **Applications → Create Application** →
   name "LaunchCare" → pick **Single Page Web Applications** → Create.
3. In the new app's **Settings** tab, scroll to Application URIs and set all
   three of these to your site URL from Step 2:
   - **Allowed Callback URLs**: `https://<your-site>/app.html`
   - **Allowed Logout URLs**: `https://<your-site>/app.html`
   - **Allowed Web Origins**: `https://<your-site>`
   Click **Save Changes** (bottom of page).
4. From the same Settings page, copy **Domain** (looks like
   `dev-abc123.us.auth0.com`) and **Client ID**.
   **Using an Auth0 custom domain** (e.g. `auth.yourdomain.com`, configured
   under Auth0 → Branding → Custom Domains)? Then use the **custom domain
   everywhere** in the next two steps instead of the tenant domain — tokens
   are issued by whichever domain the app signs in through, and Convex
   rejects tokens whose issuer doesn't match its `AUTH0_DOMAIN` exactly.
5. Paste both into the Cloudflare variables from Step 3 (`AUTH0_DOMAIN`,
   `AUTH0_CLIENT_ID`).
6. Tell Convex to trust Auth0 tokens — **on the production deployment**
   (`--prod`; without it you only set the dev deployment and sign-ins won't
   bind orgs in prod):
   ```bash
   cd backend
   npx convex env set --prod AUTH0_DOMAIN dev-abc123.us.auth0.com
   npx convex env set --prod AUTH0_CLIENT_ID <the client id>
   npx convex deploy
   ```

Check: open `https://<your-site>/app.html` → you should see a **Sign in**
button → signing up with any email works → you land on the onboarding form →
filling it creates your org **with its 4-agent crew already registered**.

**If you're signed in but the app shows a yellow warning** ("Convex did not
accept your identity"), one of these is wrong — fix and `npx convex deploy`
again:
- Auth0 vars were set without `--prod` (they went to the dev deployment);
- you didn't re-run `npx convex deploy` after setting them (auth config is
  applied at deploy time);
- the domain doesn't match the token issuer (custom domain vs tenant
  domain — must be the same value in the Cloudflare vars and in Convex).
Orgs created while auth was broken are unbound to your user — just onboard
again after fixing; the strays are harmless.

### Step 5 — One server per customer (~15 min per box, until the provisioner automates it)

Each onboarded company gets a box that runs their agent crew.

1. https://cloud.linode.com → **Create → Linode** → pick Ubuntu 24.04 LTS,
   the smallest shared plan is fine to start → set a root password → Create.
2. When it's running, copy its IP and SSH in: `ssh root@<ip>`.
3. On the box, paste this block:
   ```bash
   apt update && apt install -y curl git
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
   git clone https://github.com/joseeantonior/launchcare.git
   cd launchcare/backend && npm install
   cp .env.example .env
   nano .env
   ```
4. In the editor, fill in (then Ctrl-O, Enter, Ctrl-X to save):
   - `CONVEX_URL` = your Convex prod URL
   - `ORG_ID` = the customer's org id — find it in the ops dashboard
     (`https://<your-site>/dashboard.html`, org dropdown shows every org;
     or `npx convex run agency:listOrganizations` locally)
   - `NOVITA_API_KEY` = from https://novita.ai/settings/key-management
   - `STRIPE_KEY` = the customer's restricted key (charges:read,
     refunds:write) — they create it in their Stripe dashboard
   - `PROMPT_VERSION` = the git tag you deployed, e.g. `v0.1`
5. Make it a service that survives reboots:
   ```bash
   cat >/etc/systemd/system/launchcare.service <<'EOF'
   [Unit]
   Description=LaunchCare gateway
   After=network.target
   [Service]
   WorkingDirectory=/root/launchcare/backend
   EnvironmentFile=/root/launchcare/backend/.env
   ExecStart=/usr/bin/node gateway/index.mjs
   Restart=always
   [Install]
   WantedBy=multi-user.target
   EOF
   systemctl enable --now launchcare
   ```
6. Check it's alive: `curl localhost:8787/health` → `{"ok":true,...}`.
7. Send it a test ticket:
   ```bash
   curl -X POST localhost:8787/tickets -H 'Content-Type: application/json' \
     -d '{"customerEmail":"test@example.com","subject":"test","body":"Where do I export my data?"}'
   ```
   Then open the ops dashboard → Runs — you should see the run and its
   trace tree.

### Step 6 — Fill in Novita prices (when your account manager sends them)

Ops dashboard → Settings → `modelPricesUsdPerMTok` → set e.g.
`{"pa/claude-sonnet-5":{"in":3,"out":15},"pa/claude-opus-4-8":{"in":15,"out":75}}`
→ save. From then on every step's dollar cost is real; before that, tokens
are still counted but cost shows $0.

**You're live.** Remaining known gaps before charging customers:
lock down Convex (see Security in [architecture.md](architecture.md)) and
wire the email/Telegram channels ([architecture.md](architecture.md) → build
order).

---

## Reference

### Data layer → Convex cloud

```bash
cd backend
npx convex login
npx convex dev --configure new   # DEV deployment (separate data from prod)
npx convex deploy                # PROD deployment
# per tenant (CLI path; app onboarding does this automatically with the crew):
npx convex run agency:createOrganization '{"name":"<company>","website":"https://…"}'
node scripts/register-roles.mjs --org <orgId> --url https://<name>.convex.cloud
```

- One shared Convex deployment serves every org — data is org-scoped; the
  per-tenant isolation lives at the box level.
- Auth vars (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`) must exist on every
  deployment, even empty. See [user-dashboard.md](user-dashboard.md).
- Convex functions are currently publicly callable — see Security notes in
  [architecture.md](architecture.md).

### Website → Cloudflare Worker

`website/wrangler.jsonc` defines the deployment: `worker.js` (serves
`/config.js` from the Worker's env vars) + every static file in `website/`.

```bash
cd website && wrangler deploy
```

Worker variables (`CONVEX_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`): set in
the Cloudflare dashboard (Workers & Pages → launchcare → Settings →
Variables and Secrets) or in wrangler.jsonc `"vars"`. Dashboard values win.
They are configuration, not secrets — they end up in the browser by design.

Any other static host also works (Netlify/Vercel/GitHub Pages/nginx) — but
then `/config.js` isn't generated for you: create `website/config.js` from
`config.example.js` before uploading. Serve over HTTPS; an HTTPS page cannot
call an `http://` Convex URL.

### Gateway → tenant box (Linode)

See Step 5 of the walkthrough above — that section *is* the reference; the
future provisioner automates exactly those commands via the Linode API +
cloud-init. Tenant secrets live only in that box's `.env` — never in git,
never in Convex. Expose port 8787 only to your channel webhook sources (or
front it with nginx + HTTPS).

### Gotchas

- A deployed site must point at a **cloud** Convex URL — the local
  anonymous deployment (`127.0.0.1:3210`) is only reachable from your
  machine.
- The internal ops dashboard (`dashboard.html`) remembers the Convex URL in
  localStorage (or takes `?url=`); the customer app gets it from
  `/config.js`.
- Changing a Worker variable in the Cloudflare dashboard applies on save —
  no redeploy needed. Changing `wrangler.jsonc` requires `wrangler deploy`.
