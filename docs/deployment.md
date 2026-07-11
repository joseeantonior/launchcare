# Deployment

The two halves deploy independently: the backend goes to Convex cloud (they
host it — no server to manage), the website goes to any static host.

## 1. Backend → Convex cloud

```bash
cd backend
npx convex login                 # once
npx convex dev --configure new   # create the project; this is your DEV deployment
npx convex run agency:seed       # seed the cloud deployment
npx convex deploy                # push to the PRODUCTION deployment when ready
```

Notes:

- Dev and prod are separate deployments with separate data; run `seed` (and
  register roles — see [usage.md](usage.md) §2) on each.
- Your deployment URLs look like `https://<name>.convex.cloud`. Find them in
  the [Convex dashboard](https://dashboard.convex.dev) → Settings → URL, or
  in `backend/.env.local` for the dev one.
- Anything your agent needs server-side (Stripe keys etc.) goes in the
  Convex dashboard → Settings → Environment Variables — never in git.

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
