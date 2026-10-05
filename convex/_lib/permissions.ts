import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import { ConvexError, type GenericId as Id } from "convex/values";
import type schema from "../schema";

/**
 * RBAC core (PH0-22). The matrix below is a transcription of
 * `docs/permissions.md` — that doc stays the human-readable source of truth;
 * this file is its executable form. Deny by default: an unknown
 * module/action/role combination is denied.
 *
 * Enforcement contract (docs/permissions.md rule 2): every state-changing
 * mutation calls `requirePermission(ctx, module, action)` FIRST (self-scoped
 * actions — own profile, own session revoke — are exempt by design), and the
 * UI only mirrors these answers via `useCan()` (PH0-23).
 */

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
/** Context accepted by read paths (queries + mutations). */
export type AppCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;
type MutationCtx = GenericMutationCtx<DataModel>;

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
 * Resolve effective role keys for several users in one pass (users table).
 * Mirrors {@link effectiveRoleKeys}: explicit rows win; while NO user has any
 * assignment, the earliest-created user is the bootstrap Owner.
 */
export async function roleKeysForUsers(
  ctx: AppCtx,
  userIds: readonly Id<"users">[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(userIds.map((id) => [id as string, [] as string[]]));
  if (userIds.length === 0) return result;

  // `userRoles` holds at most one row per user (single-role model), so an
  // unindexed scan is a handful of documents at this scale.
  const assignments = await ctx.db.query("userRoles").collect();
  if (assignments.length > 0) {
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const roleDocs = await Promise.all(roleIds.map((roleId) => ctx.db.get(roleId)));
    const keyByRoleId = new Map(
      roleDocs.flatMap<[string, string]>((role) =>
        role !== null ? [[role._id as string, role.key]] : [],
      ),
    );
    for (const assignment of assignments) {
      const keys = result.get(assignment.userId as string);
      const key = keyByRoleId.get(assignment.roleId as string);
      if (keys !== undefined && key !== undefined) keys.push(key);
    }
    return result;
  }

  const first = await ctx.db.query("users").order("asc").take(1);
  if (first[0] !== undefined && result.has(first[0]._id as string)) {
    result.set(first[0]._id as string, ["owner"]);
  }
  return result;
}

/**
 * The roles an assignment resolution yields may include raw strings (custom
 * roles later); unknown keys simply grant nothing (rule 1).
 */
export function hasPermission(
  roleKeys: readonly string[],
  module: Module,
  action: Action,
): boolean {
  return roleKeys.some((key) => ROLE_PERMISSIONS[key as RoleKey]?.[module]?.includes(action));
}

/**
 * Resolve a user's effective role keys.
 *
 * 1. Explicit `userRoles` rows win (resolved through the `roles` table).
 * 2. Bootstrap: while NO user has any assignment at all (fresh install,
 *    before the seed script runs), the earliest-created user is the Owner —
 *    this guarantees the app can never lock everyone out. Once a single
 *    assignment exists, that fallback is gone forever: unassigned users are
 *    denied (rule 1).
 */
export async function effectiveRoleKeys(ctx: AppCtx, userId: Id<"users">): Promise<string[]> {
  return (await roleKeysForUsers(ctx, [userId])).get(userId as string) ?? [];
}

/**
 * Enforce `module.action` for the signed-in user; returns their user id so
 * callers can record it (audit log, PH0-25). Throws a `ConvexError` with a
 * user-facing message — ConvexError survives production error redaction, so
 * the denial reaches `<FormAlert>`/toasts intact (lib/errors.ts passes it
 * through).
 */
export async function requirePermission(
  ctx: AppCtx,
  module: Module,
  action: Action,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Not authenticated");
  }
  const roleKeys = await effectiveRoleKeys(ctx, userId);
  if (!hasPermission(roleKeys, module, action)) {
    throw new ConvexError(`You don't have permission to ${action} ${module} items.`);
  }
  return userId;
}

/**
 * Extra gate for role grants (docs/permissions.md rule 4): only the Owner
 * may grant or change roles — Admin can still invite users without a role.
 */
export async function requireRole(
  ctx: AppCtx,
  userId: Id<"users">,
  ...roles: RoleKey[]
): Promise<void> {
  const roleKeys = await effectiveRoleKeys(ctx, userId);
  if (!roles.some((role) => roleKeys.includes(role))) {
    throw new ConvexError("Only an owner can grant or change roles.");
  }
}

/**
 * The single write path for role assignments (invites with a role and
 * `users:assignRole`). Replaces any existing assignment (single-role model);
 * `roleKey: null` clears it.
 *
 * Bootstrap invariant: the implicit owner claim (earliest user, see
 * {@link effectiveRoleKeys}) exists only while NO assignment row does — so
 * creating the first row anywhere would silently lock that owner out. The
 * grant therefore materializes an owner row for the granting user in the same
 * transaction, unless the grant itself already is exactly that row.
 */
export async function grantRole(
  ctx: MutationCtx,
  args: { userId: Id<"users">; roleKey: RoleKey | null; grantedBy: Id<"users"> },
): Promise<void> {
  const bootstrap = (await ctx.db.query("userRoles").take(1)).length === 0;
  const roleIds = await ensureSystemRoles(ctx);

  const existing = await ctx.db
    .query("userRoles")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .collect();
  for (const row of existing) {
    await ctx.db.delete(row._id);
  }

  if (args.roleKey !== null) {
    const roleId = roleIds.get(args.roleKey);
    if (roleId === undefined) {
      throw new ConvexError("Unknown role."); // unreachable: ensureSystemRoles seeds all
    }
    await ctx.db.insert("userRoles", {
      userId: args.userId,
      roleId,
      grantedBy: args.grantedBy,
      createdAt: Date.now(),
    });
  }

  const alreadyOwner = args.grantedBy === args.userId && args.roleKey === "owner";
  if (bootstrap && !alreadyOwner) {
    const ownerRoleId = roleIds.get("owner");
    if (ownerRoleId === undefined) {
      throw new ConvexError("Unknown role."); // unreachable: ensureSystemRoles seeds all
    }
    await ctx.db.insert("userRoles", {
      userId: args.grantedBy,
      roleId: ownerRoleId,
      grantedBy: args.grantedBy,
      createdAt: Date.now(),
    });
  }
}

/**
 * Idempotently seed the built-in role catalog so `userRoles` rows always have
 * rows to point at. Mutations must call this BEFORE inserting an assignment
 * (queries can't write — assignments are only created in mutations).
 */
export async function ensureSystemRoles(ctx: MutationCtx): Promise<Map<string, Id<"roles">>> {
  const existing = await ctx.db.query("roles").collect();
  const byKey = new Map(existing.map((role) => [role.key, role._id]));
  for (const role of SYSTEM_ROLES) {
    if (!byKey.has(role.key)) {
      const roleId = await ctx.db.insert("roles", {
        key: role.key,
        name: role.name,
        description: role.description,
        createdAt: Date.now(),
      });
      byKey.set(role.key, roleId);
    }
  }
  return byKey;
}
