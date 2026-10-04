import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

/** Admin pages that require a signed-in user (PH0-13). */
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/catalog(.*)",
  "/inventory(.*)",
  "/sales(.*)",
  "/procurement(.*)",
  "/finance(.*)",
  "/service(.*)",
  "/reports(.*)",
  "/settings(.*)",
  "/users(.*)",
]);

/** Sign-in/sign-up pages: send already-authenticated users to the app. */
const isSignInPage = createRouteMatcher(["/login", "/signup", "/forgot-password"]);

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const isAuthenticated = await convexAuth.isAuthenticated();

    if (isSignInPage(request) && isAuthenticated) {
      return nextjsMiddlewareRedirect(request, "/dashboard");
    }

    if (isProtectedRoute(request) && !isAuthenticated) {
      const next = request.nextUrl.pathname + request.nextUrl.search;
      return nextjsMiddlewareRedirect(request, `/login?next=${encodeURIComponent(next)}`);
    }

    // No `?code=` handling on the reset page: that link carries a password
    // reset code our /reset-password page must read itself (it needs the new
    // password). Every other GET page lets the auth middleware exchange codes
    // (OAuth callbacks, magic links) before rendering.
  },
  {
    shouldHandleCode: (request) => !request.nextUrl.pathname.startsWith("/reset-password"),
  },
);

export const config = {
  // Convex Auth recommended matcher: everything except static files.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
