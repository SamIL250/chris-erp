import type { Module } from "./permissions";

/**
 * Route → module access map (PH0-23), consumed by the admin layout's
 * `PermissionGate`. A path not listed needs no permission (the auth-level
 * middleware from PH0-13 still applies) — the pages themselves fetch data
 * through permission-gated queries, this only keeps unauthorized users from
 * staring at error states.
 */

/** Paths any signed-in user may open (landing + self-service). */
const ALWAYS_ALLOWED = ["/dashboard", "/settings/profile"];

/** Longest-ordered prefixes: first match wins. */
const ROUTE_MODULES: [prefix: string, module: Module][] = [
  ["/catalog", "catalog"],
  ["/inventory", "inventory"],
  ["/sales", "sales"],
  ["/procurement", "procurement"],
  ["/finance", "finance"],
  ["/service", "service"],
  ["/reports", "reports"],
  ["/users", "users"],
  ["/settings", "settings"], // /settings/profile exempted above; later pages need settings.view
];

/** The module whose `view` permission this path requires (null = open to all). */
export function requiredModuleForPath(pathname: string): Module | null {
  for (const prefix of ALWAYS_ALLOWED) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return null;
  }
  for (const [prefix, requiredModule] of ROUTE_MODULES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return requiredModule;
  }
  return null;
}
