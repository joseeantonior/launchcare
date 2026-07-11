// Auth0 → Convex identity. Active only when the env vars are set on the
// deployment (use --prod for production; re-run `npx convex deploy` after —
// auth config is applied at deploy time):
//   npx convex env set AUTH0_DOMAIN your-tenant.us.auth0.com
//   npx convex env set AUTH0_CLIENT_ID <spa client id>
// AUTH0_DOMAIN must match the token ISSUER — i.e. the exact domain the app
// signs in through. Using an Auth0 CUSTOM DOMAIN (auth.yourdomain.com)?
// Then that custom domain goes here AND in the app config; the tenant
// domain won't validate. Without env vars the deployment accepts no
// identities (dev mode: ctx.auth sees null).
// Tolerate "https://tenant.us.auth0.com/" and bare "tenant.us.auth0.com".
const domain = (process.env.AUTH0_DOMAIN ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

export default {
  providers: domain
    ? [
        {
          domain,
          applicationID: process.env.AUTH0_CLIENT_ID!,
        },
      ]
    : [],
};
