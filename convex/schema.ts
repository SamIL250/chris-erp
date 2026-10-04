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
});
