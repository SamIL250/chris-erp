import { query } from "./_generated/server";

/**
 * Which sign-in methods are configured on this deployment — the login/signup
 * pages only render buttons that will actually work (Google needs
 * AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET set via `npx convex env set`).
 */
export const list = query({
  args: {},
  handler: async () => {
    return {
      password: true,
      google: !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET,
    };
  },
});
