// Copy to config.js and fill in. Without config.js the app runs in DEV MODE:
// no sign-in, orgs are unbound, and the Convex URL is asked for in the UI.
window.LAUNCHCARE_CONFIG = {
  // Your Convex deployment (https://<name>.convex.cloud)
  convexUrl: "",

  // Auth0 SPA application. Create at https://manage.auth0.com →
  // Applications → Create → Single Page Web App. Set the app's callback,
  // logout, and web-origin URLs to your site origin (and localhost for dev).
  // Then enable it on the Convex deployment:
  //   npx convex env set AUTH0_DOMAIN <your-tenant>.us.auth0.com
  //   npx convex env set AUTH0_CLIENT_ID <client id>
  auth0Domain: "",
  auth0ClientId: "",
};
