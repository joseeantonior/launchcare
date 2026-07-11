// Auth0 → Convex identity. Active only when the env vars are set on the
// deployment:
//   npx convex env set AUTH0_DOMAIN your-tenant.us.auth0.com
//   npx convex env set AUTH0_CLIENT_ID <spa client id>
// Without them the deployment accepts no identities (dev mode: functions
// that use ctx.auth just see null).
export default {
  providers: process.env.AUTH0_DOMAIN
    ? [
        {
          domain: process.env.AUTH0_DOMAIN,
          applicationID: process.env.AUTH0_CLIENT_ID!,
        },
      ]
    : [],
};
