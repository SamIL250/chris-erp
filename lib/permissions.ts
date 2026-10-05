/**
 * The permission matrix (PH0-21 spec → PH0-22/23 executable form).
 *
 * `docs/permissions.md` stays the human-readable source of truth; this file
 * is its code: role → module → allowed actions, deny by default (rule 1).
 *
 * Deliberately OUTSIDE `convex/` and dependency-free: imported by the Convex
 * helpers (`convex/_lib/permissions.ts`) and by the client-side `useCan()`
 * hook (PH0-23) — one source of truth, no server round-trip per check.
 */

export const ROLE_KEYS = ["owner", "admin", "sales", "warehouse", "accountant"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Labels/descriptions for the assignable roles (Storefront is not staff). */
export const SYSTEM_ROLES: { key: RoleKey; name: string; description: string }[] = [
  { key: "owner", name: "Owner", description: "Everything, including dangerous operations." },
  { key: "admin", name: "Admin", description: "Everything except ownership transfer / resets." },
  { key: "sales", name: "Sales", description: "Customers, quotes, orders. No finance close." },
  { key: "warehouse", name: "Warehouse", description: "Stock, receiving, transfers, counting." },
  { key: "accountant", name: "Accountant", description: "Full finance; read-only elsewhere." },
];

export const MODULES = [
  "settings",
  "users",
  "catalog",
  "inventory",
  "sales",
  "procurement",
  "finance",
  "service",
  "storefront",
  "reports",
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "post", "export"] as const;
export type Action = (typeof ACTIONS)[number];

const FULL: Action[] = [...ACTIONS];

/**
 * docs/permissions.md → executable. Role → module → allowed actions.
 * Everything absent is denied (rule 1).
 */
export const ROLE_PERMISSIONS: Record<RoleKey, Partial<Record<Module, Action[]>>> = {
  owner: {
    settings: FULL,
    users: FULL,
    catalog: FULL,
    inventory: FULL,
    sales: FULL,
    procurement: FULL,
    finance: FULL,
    service: FULL,
    storefront: FULL,
    reports: FULL,
  },
  admin: {
    settings: ["view", "create", "edit", "post"],
    users: ["view", "create", "edit"],
    catalog: FULL,
    inventory: FULL,
    sales: FULL,
    procurement: FULL,
    finance: FULL,
    service: FULL,
    storefront: FULL,
    reports: FULL,
  },
  sales: {
    catalog: ["view", "create", "edit"],
    inventory: ["view"],
    sales: FULL, // full + approve
    procurement: ["view"],
    finance: ["view"],
    service: FULL,
    storefront: ["view"],
    reports: ["view"],
  },
  warehouse: {
    catalog: ["view"],
    inventory: FULL, // full + approve adjustments
    sales: ["view", "edit"], // edit fulfillment only (PH1: narrow)
    procurement: ["view", "create"], // receive → create goods receipts
    service: ["view", "edit"],
    reports: ["view"],
  },
  accountant: {
    settings: ["view"],
    catalog: ["view"],
    inventory: ["view"],
    sales: ["view"],
    procurement: ["view", "edit"], // edit bills
    finance: FULL, // full + post (period close stays Owner/Admin)
    service: ["view"],
    storefront: ["view"],
    reports: ["view"],
  },
};

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * Do these effective role keys allow `module.action`? Unknown role keys
 * simply grant nothing (rule 1: deny by default).
 */
export function hasPermission(
  roleKeys: readonly string[],
  module: Module,
  action: Action,
): boolean {
  return roleKeys.some((key) => ROLE_PERMISSIONS[key as RoleKey]?.[module]?.includes(action));
}
