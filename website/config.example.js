// Copy to config.js and fill in. Without config.js the app runs in DEV MODE:
// no sign-in, orgs are unbound, and the Convex URL is asked for in the UI.
window.LAUNCHCARE_CONFIG = {
  // Your Convex deployment (https://<name>.convex.cloud)
  convexUrl: "",

  // Auth0 SPA application. Create at https://manage.auth0.com →
  // Applications → Create → Single Page Web App. Set the app's callback,
  // logout, and web-origin URLs to your site origin (and localhost for dev).
  //
  // auth0Domain: tenant domain (dev-xxx.us.auth0.com) — or your Auth0
  // CUSTOM DOMAIN (e.g. auth.yourdomain.com) if you have one configured.
  // Whichever you use, Convex must get the SAME value (it must match the
  // token issuer), and you must `npx convex deploy` after setting it:
  //   npx convex env set --prod AUTH0_DOMAIN <same domain as below>
  //   npx convex env set --prod AUTH0_CLIENT_ID <client id>
  auth0Domain: "",
  auth0ClientId: "",
};
