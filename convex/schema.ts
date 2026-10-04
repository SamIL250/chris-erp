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
 */
export default defineSchema({
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

  /** App user profiles — linked to Convex Auth accounts in PH0-17. */
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("invited"), v.literal("disabled")),
    invitedBy: v.optional(v.id("users")),
    invitedAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"]),
});
