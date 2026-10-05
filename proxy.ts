import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

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

const authMiddleware = convexAuthNextjsMiddleware(
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
    // password).
  },
  { shouldHandleCode: (request) => !request.nextUrl.pathname.startsWith("/reset-password") },
);

/**
 * Next.js entry (PH0-13) — `proxy.ts` replaces `middleware.ts` in Next 16.
 *
 * Workaround (PH0-20) for an @convex-dev/auth (0.0.96) bug: whenever auth
 * cookies are refreshed (or a refresh fails because the session was revoked /
 * expired), the library rebuilds our response with
 * `NextResponse.next(response)`. Spreading a `Response` object into the init
 * drops its `status` (Response fields are prototype getters, not own
 * properties), so the response falls back to **200 while keeping the
 * `location` header**. Browsers only follow `location` on 3xx, and the null
 * body from the wrapper means the user sees a blank page instead of the
 * redirect to `/login` (or `/dashboard`). Rebuild a real 307 here, keeping
 * the `Set-Cookie` headers (rotated tokens or cleared cookies) intact.
 * Remove this once the library fixes the wrap.
 */
export default async function proxy(
  request: NextRequest,
  event: Parameters<typeof authMiddleware>[1],
) {
  const response = await authMiddleware(request, event);
  if (response == null) {
    // Unreachable — the library always falls through to `NextResponse.next()` —
    // but its return type allows null/undefined.
    return NextResponse.next();
  }

  const location = response.headers.get("location");
  if (response.status === 200 && location !== null) {
    const headers = new Headers(response.headers);
    headers.set("location", location); // stays absolute (NextResponse.redirect normalized it)
    headers.delete("x-middleware-next"); // don't let Next treat it as "continue"
    return new NextResponse(null, { status: 307, headers });
  }
  return response;
}
