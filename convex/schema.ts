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
    /** Uploaded logo (PH0-29, kind "logo") — resolved to a signed URL on read. */
    logoFileId: v.optional(v.id("files")),
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
    /** Uploaded profile photo (PH0-27) — resolved to a signed URL in `users:me`. */
    avatarFileId: v.optional(v.id("files")),
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

  /**
   * Key/value app settings (PH0-24) — one row per key, JSON value. Domain
   * config that has a real shape lives in its own table instead
   * (organizations, sequences, currencies); this is for small prefs and
   * feature switches (PH0-33, PH6-20).
   */
  settings: defineTable({
    key: v.string(),
    value: v.any(),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Document-number sequences (PH0-24 → PH0-25 `nextSequence`, PH0-30 UI):
   * `INV-` + zero-padded counter, one row per document kind. Never renumber
   * backwards — `next` only grows (except deliberate admin resets, audited).
   */
  sequences: defineTable({
    name: v.string(), // "invoice", "purchaseOrder", "quote", "journal", …
    prefix: v.string(), // "INV-"
    next: v.number(), // next number to issue (starts at 1)
    padding: v.number(), // zero-pad width: 4 → INV-0007
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  /**
   * Currency catalog (PH0-24 → PH0-31). The active base currency is
   * `organizations.baseCurrency` — single source of truth, no isBase flag
   * here. `decimalPlaces` = minor units per unit (JPY → 0).
   */
  currencies: defineTable({
    code: v.string(), // ISO 4217: "USD"
    name: v.string(),
    symbol: v.optional(v.string()),
    decimalPlaces: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_active", ["active"]),

  /**
   * Exchange-rate history (PH0-24 → PH0-31): append-only, one row per
   * observation — "latest rate for a pair" = highest `effectiveAt`. Rates
   * are decimals (1 base = rate quote), not money, so they aren't minor
   * units.
   */
  exchangeRates: defineTable({
    baseCurrency: v.string(),
    quoteCurrency: v.string(),
    rate: v.number(),
    source: v.optional(v.string()), // "manual" now; API feeds later
    effectiveAt: v.number(),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_pair", ["baseCurrency", "quoteCurrency"])
    .index("by_pair_time", ["baseCurrency", "quoteCurrency", "effectiveAt"]),

  /**
   * Tax rates (PH0-24 → PH0-32): integer basis points for exact money math
   * (19.5% → 1950), inclusive = quoted prices already contain the tax.
   */
  taxRates: defineTable({
    name: v.string(), // "VAT 20%"
    code: v.optional(v.string()), // short label shown on documents
    rateBps: v.number(),
    inclusive: v.boolean(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_active", ["active"]),

  /**
   * Tax groups (PH0-24 → PH0-32): assigned to customers (Phase 2) and
   * resolved per product tax category — category → rate. `exempt` is
   * category-level on the product (no rate involved).
   */
  taxGroups: defineTable({
    name: v.string(),
    isDefault: v.boolean(),
    rates: v.object({
      standard: v.optional(v.id("taxRates")),
      reduced: v.optional(v.id("taxRates")),
      zero: v.optional(v.id("taxRates")),
    }),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_active", ["active"]),

  /**
   * Append-only audit trail (PH0-24 → PH0-26). BEFORE/AFTER snapshots are
   * written by the `audit()` helper (secrets redacted there); there is no
   * update/delete API for this table — corrections are new entries.
   * `entityId` is a string so one table covers every future entity.
   */
  auditLog: defineTable({
    actorId: v.optional(v.id("users")), // optional: system actions
    actorLabel: v.optional(v.string()), // email snapshot — actor may be gone
    action: v.string(), // "create" | "update" | "delete" | "invite" | …
    entity: v.string(), // table name: "users", later "products", …
    entityId: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_entity", ["entity", "entityId"])
    .index("by_time", ["createdAt"]),

  /**
   * In-app notifications (PH0-24 → PH0-28): `notify()` inserts, the bell
   * lists by recency, unread = `readAt` undefined (filtered after the
   * by_user index — optional fields stay out of indexes).
   */
  notifications: defineTable({
    userId: v.id("users"),
    title: v.string(),
    body: v.optional(v.string()),
    kind: v.optional(v.string()), // "info" | "success" | "warning"
    href: v.optional(v.string()), // deep link into the app
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_time", ["userId", "createdAt"]),

  /**
   * Uploaded-file registry (PH0-24 → PH0-27): bytes live in Convex storage
   * (`storageId`), this row carries metadata + ownership; signed URLs are
   * minted on read. `kind` buckets usage ("logo", "productImage",
   * "avatar", …); `entityId` links to the owning document when applicable.
   */
  files: defineTable({
    storageId: v.id("_storage"),
    name: v.string(), // original filename
    mimeType: v.string(),
    size: v.number(), // bytes
    kind: v.string(),
    uploadedBy: v.id("users"),
    entityId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_kind", ["kind"])
    .index("by_uploadedBy", ["uploadedBy"]),

  /**
   * Category tree (PH1-01): adjacency list — `parentId` (absent = root) plus
   * manual ordering via `position` (0..n-1 unique per sibling set, maintained
   * by the mutations). Slugs are GLOBALLY unique (storefront URLs are
   * slug-based); breadcrumb paths are computed on read — never stored, so a
   * reparent can't leave stale paths behind. `visible` gates the storefront
   * (Phase 4); product counts derive from `products.categoryIds` (PH1-06).
   */
  categories: defineTable({
    name: v.string(),
    slug: v.string(),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    seoTitle: v.optional(v.string()),
    seoDescription: v.optional(v.string()),
    visible: v.boolean(),
    /** Manual order within the sibling set (parent's children + roots). */
    position: v.number(),
    /** Storefront card image (PH4-02) — schema-first, UI lands later. */
    imageFileId: v.optional(v.id("files")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_parent_position", ["parentId", "position"]),

  /**
   * Product master (PH1-06 completes this table). The identity + lifecycle
   * core lands with PH1-02 because the category page's product counts and
   * "uncategorized" stat read it (plan schema-first rule); barcode, brand,
   * descriptions, taxCategory, track flags, warranty/shelf-life, UoM,
   * images and attribute-set links arrive with PH1-06/07/13.
   * `categoryIds[]` is the PH1-06 contract — a product can sit in several
   * categories. Lookups: storefront slug, warehouse/POS barcode→SKU later,
   * status feeds pickers (archived hidden everywhere, PH1-15).
   */
  products: defineTable({
    name: v.string(),
    slug: v.string(),
    sku: v.string(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    categoryIds: v.array(v.id("categories")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_sku", ["sku"])
    .index("by_status", ["status"]),

  /**
   * Attribute definitions (PH1-03): the spec vocabulary products express
   * themselves with — "Weight" (number, unit kg), "Color" (select with
   * options), "RoHS compliant" (boolean). PH1-04 groups these into sets,
   * sets attach to categories, and the product editor (PH1-07) renders
   * inputs from the set and stores values per product.
   *
   * `unit` is meaningful for `number` only; `options` (admin order,
   * trimmed + deduped) for `select`/`multi_select` only — both enforced in
   * `convex/catalog/attributes.ts`. `by_name` gives the admin list its
   * name-ordered scan.
   */
  attributeDefinitions: defineTable({
    name: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("number"),
      v.literal("select"),
      v.literal("multi_select"),
      v.literal("boolean"),
      v.literal("date"),
    ),
    /** Unit label for number attributes (kg, mm, months); absent otherwise. */
    unit: v.optional(v.string()),
    /** Choices for select/multi-select; empty array otherwise. */
    options: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
});
