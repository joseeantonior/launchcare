// Cloudflare Worker: serves /config.js from the Worker's environment
// variables (set in wrangler.jsonc "vars" or the Cloudflare dashboard),
// everything else from static assets. This is how the deployed app gets its
// Convex URL and Auth0 config without committing a config file.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/config.js") {
      const cfg = {
        convexUrl: env.CONVEX_URL ?? "",
        auth0Domain: env.AUTH0_DOMAIN ?? "",
        auth0ClientId: env.AUTH0_CLIENT_ID ?? "",
      };
      return new Response(`window.LAUNCHCARE_CONFIG = ${JSON.stringify(cfg)};`, {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
