import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Foundation schema (Phase 0). Domain tables (catalog, inventory, sales, …)
 * are added progressively — see docs/development-plan.md.
 *
 * Conventions (docs/development-plan.md §1):
 * - plural camelCase table names, camelCase fields
 * - index everything you filter by: `by_…`
 * - money: integer minor units + currency field
 *
 * `authTables` (Convex Auth) must be spread in; `users` below extends the auth
 * user with app fields — its `email`/`phone` index names are required by the
 * library (it queries `withIndex("email" | "phone")`).
 */
export default defineSchema({
  ...authTables,

  /** Single-company config holder (one document, id kept in settings). */
  organizations: defineTable({
    name: v.string(),
    legalName: v.optional(v.string()),
    slug: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    taxId: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(
      v.object({
        line1: v.optional(v.string()),
        line2: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        postalCode: v.optional(v.string()),
        country: v.optional(v.string()),
      }),
    ),
    baseCurrency: v.string(),
    locale: v.optional(v.string()),
    timezone: v.optional(v.string()),
    invoiceFooter: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_active", ["active"]),

  /**
   * App user profiles — the auth library owns the auth fields (name/email/…)
   * and creates documents here via the `profile()` callback in convex/auth.ts.
   */
  users: defineTable({
    // ── Convex Auth fields (parity with authTables.users) ──
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    // ── App fields ──
    status: v.union(v.literal("active"), v.literal("invited"), v.literal("disabled")),
    invitedBy: v.optional(v.id("users")),
    invitedAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("email", ["email"]) // required by @convex-dev/auth (exact name)
    .index("phone", ["phone"]) // required by @convex-dev/auth (exact name)
    .index("by_status", ["status"]),

  /**
   * Invite codes for admin-invited users (PH0-19). The raw code only ever
   * exists in the emailed link — we store its SHA-256 so a database leak
   * can't take over pending invites.
   */
  invites: defineTable({
    email: v.string(),
    userId: v.id("users"),
    codeHash: v.string(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    invitedBy: v.id("users"),
    /** Role key granted on acceptance (PH0-22); resolved against SYSTEM_ROLES. */
    role: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  /**
   * RBAC (PH0-22): the assignable role catalog. Permission CHECKS never read
   * this table — the matrix lives in code (`convex/_lib/permissions.ts`,
   * transcribed from docs/permissions.md) — rows exist to label assignments
   * in the UI and to leave room for custom roles later. Seeded idempotently
   * when a role is granted (and by the PH0-34 seed script).
   */
  roles: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * RBAC (PH0-22): role assignments. Deny by default — a user with no rows
   * (and no bootstrap claim) can't do anything module-scoped. See
   * docs/permissions.md for the matrix and the bootstrap rule.
   */
  userRoles: defineTable({
    userId: v.id("users"),
    roleId: v.id("roles"),
    grantedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_role", ["userId", "roleId"]),
});
