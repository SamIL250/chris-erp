/**
 * Auth page helpers (PH0-17).
 */

/**
 * Read a safe `next=` redirect target from the current URL (used after
 * sign-in). Only same-site absolute paths are allowed — never `//host` or a
 * full URL (open-redirect protection). Falls back to `/dashboard`.
 */
export function safeNextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    return next;
  }
  return "/dashboard";
}
