# Deployment

Three deployable pieces: the Convex data layer (they host it), the website
(any static host), and one gateway box per tenant.

## 1. Data layer → Convex cloud

```bash
cd backend
npx convex login                 # once
npx convex dev --configure new   # create the project; this is your DEV deployment
npx convex deploy                # push to the PRODUCTION deployment when ready

# then per tenant, against the deployment you're targeting:
npx convex run agency:createOrganization '{"name":"<company>","website":"https://…"}'
node scripts/register-roles.mjs --org <orgId> --url https://<name>.convex.cloud
```

Notes:

- One shared Convex deployment serves every org — data is org-scoped; the
  per-tenant isolation lives at the box level.
- Dev and prod are separate deployments with separate data; bootstrap orgs on
  each.
- Your deployment URLs look like `https://<name>.convex.cloud`. Find them in
  the [Convex dashboard](https://dashboard.convex.dev) → Settings → URL, or
  in `backend/.env.local` for the dev one.
- Convex functions are currently public — gate mutations behind auth or a
  shared secret before real customer money flows
  (see [architecture.md](architecture.md) → Security notes).

## 1b. Gateway → tenant box (Linode)

Each tenant gets a box running the gateway. Manually today (the provisioner
automates exactly these steps later):

```bash
# on a fresh Ubuntu Linode:
apt install -y nodejs npm            # needs Node >= 20.12; use nodesource if apt's is older
git clone <this repo> && cd launchcare/backend && npm install
cp .env.example .env                 # fill: CONVEX_URL, ORG_ID, NOVITA_API_KEY, STRIPE_KEY…

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
curl localhost:8787/health           # {"ok":true,...}
```

Tenant secrets live only in that box's `.env` — never in git, never in
Convex. Expose port 8787 only to your channel webhook sources (or front it
with nginx + HTTPS like the website below).

## 2. Website → Cloudflare Pages (recommended, +25 on the rubric)

Fastest (no repo hookup):

```bash
npm i -g wrangler
wrangler login
wrangler pages deploy website --project-name launchcare
```

Or via the UI: [Cloudflare dashboard](https://dash.cloudflare.com) →
Workers & Pages → Create → Pages → **Upload assets** → drag the `website/`
folder in. Or connect the git repo and set **build command: none, output
directory: `website`**.

The deployed site serves the landing page at `/` and the ops dashboard at
`/dashboard.html`. Open the dashboard and paste your Convex **prod** URL
(`https://<name>.convex.cloud`) into the top bar once — done. Convex's HTTP
API sends CORS headers, so no proxy or config is needed.

## 3. Website → any other server

It's three static files; any host works:

- **Netlify / Vercel / GitHub Pages:** publish the `website/` directory,
  build command none.
- **Your own VPS (nginx):**

  ```bash
  scp -r website/ you@server:/var/www/launchcare
  ```

  ```nginx
  server {
    listen 80;
    server_name launchcare.example.com;
    root /var/www/launchcare;
    index index.html;
  }
  ```

  Serve over HTTPS (e.g. `certbot --nginx`) — a page on HTTPS cannot call an
  `http://` Convex URL, so pair a hosted site with a cloud Convex deployment.

## Gotchas

- The local anonymous deployment (`127.0.0.1:3210`) is only reachable from
  your machine — deployed dashboards must point at a cloud deployment.
- The dashboard stores the Convex URL in the browser's localStorage; each
  new browser/device needs it pasted once.
