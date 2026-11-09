import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** A postal address copied onto a document. Later edits to the master do not rewrite it. */
const documentAddress = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.string(),
});

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
   * Uploaded-file registry (PH0-24 → PH0-27): the row carries metadata +
   * ownership; PH1-13 moved the BYTES to Cloudinary (signed direct upload),
   * so a row holds EITHER a `cloudinaryPublicId` + permanent `url` (current)
   * OR a legacy Convex-storage `storageId` (pre-PH1-13 rows keep reading;
   * their signed URLs are re-minted on read). `kind` buckets usage ("logo",
   * "productImage", "avatar", …); `entityId` links to the owning document
   * when applicable.
   */
  files: defineTable({
    /** Legacy Convex-storage rows only — absent on Cloudinary rows. */
    storageId: v.optional(v.id("_storage")),
    /** PH1-13: Cloudinary asset id — the delete/transform handle. */
    cloudinaryPublicId: v.optional(v.string()),
    /** PH1-13: permanent delivery URL (Cloudinary URLs don't expire). */
    url: v.optional(v.string()),
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
   * slug-based). Two path notions live here: the admin breadcrumb `path`
   * (Id[]) is still computed on read — never stored, so a reparent can't
   * leave stale breadcrumbs — while `urlPath` (PH1-05) is the STORED
   * URL string ("/parent/child/") behind `by_url_path`, so a storefront
   * request resolves its whole URL in one indexed hit (and a branch's
   * subtree scans by prefix). It is re-derived tree-wide after every
   * create/update/move and by the seed — renames/reparents can't leave it
   * stale (tests/storefrontIndexes.test.ts). Optional only so pre-PH1-05
   * rows keep reading; the next write or a seed run heals them.
   * `visible` gates the storefront (Phase 4); product counts derive from
   * `products.categoryIds`.
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
    /**
     * Materialized URL path, "/parent-slug/slug/" (root-level = "/slug/") —
     * PH1-05. Maintained by `syncUrlPaths`; see the table comment.
     */
    urlPath: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_parent_position", ["parentId", "position"])
    .index("by_url_path", ["urlPath"]),

  /**
   * Product master — identity/lifecycle core landed with PH1-02 (the
   * category page's product counts and "uncategorized" stat read it, plan
   * schema-first rule); **PH1-06 completes the field manifest** from the
   * task line. Every PH1-06 field is OPTIONAL so documents written before
   * it keep reading — writers always set them (PH1-07's editor); readers
   * treat absent as `false` / `[]` / unset (e.g. `serialTracked === true`).
   *
   * Field → later task: attributeSetIds[] →
   * product-level sets beyond the category-inherited ones (PH1-07 merges
   * them with `attributes.forCategory`), longDescription → rich HTML,
   * sanitized at write, taxCategory → the PH0-24 `taxGroups.rates` keys
   * ("standard" | "reduced" | "zero") plus "exempt" (category-level, no
   * rate — see the taxGroups comment).
   *
   * `categoryIds[]` is the PH1-06 contract — a product can sit in several
   * categories. Convex indexes an array field as ONE whole-array value
   * (it can't answer "contains this category"), so "products in this
   * category" reads go through the `productCategories` join table
   * (PH1-05), kept in sync with this array by the writer mutations.
   * Lookups: storefront slug (`by_slug`), warehouse/POS scan via barcode
   * (`by_barcode` — a row without a barcode sits under the index's null
   * key, so `eq(value)` lookups never match it), status feeds pickers
   * (archived hidden everywhere, PH1-15). Brand/name filter in JS until
   * scale demands an index (research: Convex keyword search first). SKU
   * format rules live in `lib/sku.ts` (PH1-06); uniqueness is `by_sku` at
   * write time.
   */
  products: defineTable({
    name: v.string(),
    slug: v.string(),
    /** Normalized (trim+uppercase), 3–32, charset-checked by lib/sku. */
    sku: v.string(),
    /** Scanned lookups — optional; `eq` on a real value skips blank rows. */
    barcode: v.optional(v.string()),
    brand: v.optional(v.string()),
    /**
     * Pricing (PH1-10): `listPrice` is the base sell price — the variant
     * row's `listPrice` (PH1-09) OVERRIDES it per combination, and this is
     * its display fallback; price resolution (PH2-07) walks customer →
     * group → list from here. `costPrice` is a manual, DISPLAY-ONLY figure
     * (margin previews in staff UI); the true moving-average cost is
     * computed from stock receipts once inventory/finance exist — never
     * derive accounting numbers from this field. Margin % is derived at
     * read time (lib/pricing), never stored, and staff-side only: the
     * storefront (PH4) must project `listPrice` alone — cost/margin never
     * reach customers.
     */
    listPrice: v.optional(v.number()),
    costPrice: v.optional(v.number()),
    /** One-line storefront/teaser copy (PH1-07 validates the length). */
    shortDescription: v.optional(v.string()),
    /** Rich detail copy — HTML, sanitized by the writer (PH1-07). */
    longDescription: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    taxCategory: v.optional(
      v.union(v.literal("standard"), v.literal("reduced"), v.literal("zero"), v.literal("exempt")),
    ),
    // Tracking flags + quantities (PH1-12 shipped the rules —
    // `lib/tracking`, cross-field: serial ⊥ lot, expiry ⇒ lot,
    // months > 0 ⇒ eligible, shelf life > 0 ⇒ expiry).
    serialTracked: v.optional(v.boolean()),
    lotTracked: v.optional(v.boolean()),
    expiryRequired: v.optional(v.boolean()),
    warrantyEligible: v.optional(v.boolean()),
    warrantyMonths: v.optional(v.number()),
    shelfLifeDays: v.optional(v.number()),
    allowBackorder: v.optional(v.boolean()),
    /**
     * Units of measure (PH1-11): `unitOfMeasure` is the BASE code ("each"
     * by convention) every conversion chain terminates at — all three code
     * fields normalize (trim+lowercase) and format-check through
     * `lib/uom`. `conversions` holds per-product pack-size EDGES:
     * `1 unit = factor × parent` ("1 case = 6 box", "1 box = 12 each").
     * Pack sizes are per-product by nature, so there is no global UoM
     * catalog; `lib/uom` enforces no cycles/duplicate units/dangling
     * parents, factors in (0, 1e9], and at most 12 rows.
     */
    unitOfMeasure: v.optional(v.string()),
    conversions: v.optional(
      v.array(v.object({ unit: v.string(), parent: v.string(), factor: v.number() })),
    ),
    /**
     * Doc-level UoM (PH1-11): defaults prefilling purchase/sales document
     * lines (PH2); each must be the base or a conversion unit so a line can
     * always convert to base stock. The line's OWN UoM may differ — PH2
     * line items carry it and resolve through `conversions`.
     */
    purchaseUoM: v.optional(v.string()),
    salesUoM: v.optional(v.string()),
    /**
     * Cover-first image list (PH1-13): array order IS the display order —
     * index 0 is the cover. Alt text rides the ATTACHMENT (`{ fileId, alt }`)
     * so the same bytes can be described where they're used; empty alt =
     * decorative (stored absent, ≤ 255 chars via `lib/images`).
     */
    images: v.optional(v.array(v.object({ fileId: v.id("files"), alt: v.optional(v.string()) }))),
    categoryIds: v.array(v.id("categories")),
    /** Product-level attribute sets (extra beyond category-inherited). */
    attributeSetIds: v.optional(v.array(v.id("attributeSets"))),
    /**
     * Variant axes (PH1-09): the subset of APPLICABLE Select attributes that
     * vary this product ("Color", "Config") — the matrix is the cartesian
     * product of their option lists, one `variants` row per combination.
     * Written only by `variants:sync` (the Variants page), which validates
     * each pick against the same applicability resolver the editor renders
     * from, so a category move can't strand an axis unnoticed.
     */
    variantAxisIds: v.optional(v.array(v.id("attributeDefinitions"))),
    /** Storefront meta (PH1-07 validates 100/300 like categories). */
    seoTitle: v.optional(v.string()),
    seoDescription: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_sku", ["sku"])
    .index("by_status", ["status"])
    .index("by_barcode", ["barcode"]),

  /**
   * Product↔category membership (PH1-05): the join table Convex needs to
   * answer "products in this category" with an index — an index on
   * `products.categoryIds` would sort by the WHOLE array value, so it can
   * only match arrays equal to / starting with a given array, never
   * "contains category X" (Convex's own guidance: "you can't index an
   * array" → use a join table).
   *
   * `products.categoryIds` stays the source of truth (display, stats,
   * admin editor); this table mirrors it — one row per (product,
   * category) pair — and every mutation that writes `categoryIds` (PH1-07
   * product editor) must call `syncProductCategoryRows` in the same
   * transaction; product deletes remove their rows too (PH1-15). Seeded
   * demo products are reconciled by `seed` (CT-03).
   * Reads: `by_category` → storefront category pages + PH1-08 filters;
   * `by_product` → reverse lookup + the sync helper itself.
   */
  productCategories: defineTable({
    productId: v.id("products"),
    categoryId: v.id("categories"),
  })
    .index("by_category", ["categoryId"])
    .index("by_product", ["productId"]),

  /**
   * Product variants (PH1-09): one row per option combination of the
   * product's `variantAxisIds` — the matrix `variants:sync` reconciles
   * (preserve matched combinations with their per-variant edits, insert
   * new ones from product defaults, delete orphans).
   *
   * `optionValues` pins exactly one option per axis (attributeId + the
   * stored option label). Convex can't index "contains this combination"
   * (the PH1-05 array finding), so combination UNIQUENESS within a product
   * is enforced in JS at write via a canonical key (coordinates sorted by
   * attributeId + value). Lookups: the matrix page reads `by_product`; SKU
   * is the scanning identity (warehouse/POS) and is unique org-wide across
   * products AND variants via `by_sku` probes at write; barcode optional
   * via `by_barcode` (no uniqueness — the same call as products, PH1-06).
   *
   * "Product-level defaults fill variants": the five track flags are COPIED
   * from the product at generation and editable per-variant afterwards;
   * `listPrice` is a pure override of the product-level `listPrice`
   * (PH1-10) — absent = the product's price shows (editor placeholder,
   * read cell); resolvePrice (PH2-07) formalizes the fallback. Status is
   * deliberately absent — variants inherit product lifecycle; per-variant states revisit
   * with PH1-15's archive.
   */
  variants: defineTable({
    productId: v.id("products"),
    /** One pinned option per axis of the product's `variantAxisIds`. */
    optionValues: v.array(
      v.object({ attributeId: v.id("attributeDefinitions"), value: v.string() }),
    ),
    /** Normalized (trim+uppercase), 3–32, charset-checked by lib/sku. */
    sku: v.string(),
    barcode: v.optional(v.string()),
    listPrice: v.optional(v.number()),
    // Tracking flags — copied from the product at generation (PH1-09);
    // per-variant from there on. PH1-12: `variants.update` enforces the
    // shared lib/tracking pairs (serial ⊥ lot, expiry ⇒ lot) at write.
    serialTracked: v.optional(v.boolean()),
    lotTracked: v.optional(v.boolean()),
    expiryRequired: v.optional(v.boolean()),
    warrantyEligible: v.optional(v.boolean()),
    allowBackorder: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_sku", ["sku"])
    .index("by_barcode", ["barcode"]),

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

  /**
   * Attribute sets (PH1-04): named groups of definitions that categories
   * opt into — products in those categories inherit the union of every
   * covering set's attributes (PH1-07 renders inputs from it).
   *
   * Assignment lives on the SET (single-document edits → one audit
   * snapshot, and deleting a set takes its assignments with it — categories
   * never point at sets, so there is nothing to clean up). `by_name` orders
   * the admin list AND backs `attributes.forCategory`, which scans that
   * whole (bounded) list and filters in JS — Convex indexes an array field
   * as one whole-array value, so no index can answer "sets covering this
   * category" without a join table (see `productCategories`, PH1-05);
   * revisit only if sets ever stop being small config data.
   */
  attributeSets: defineTable({
    name: v.string(),
    /** Definitions this set contributes, in display order (deduped). */
    attributeIds: v.array(v.id("attributeDefinitions")),
    /** Categories this set applies to. */
    categoryIds: v.array(v.id("categories")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  /**
   * Product attribute values (PH1-05, schema-first for PH1-07): one row per
   * (product, attribute, value) — multi-select stores one row per chosen
   * option. Values deliberately live OUTSIDE the product document (PH1-06's
   * field list carries no `attributeValues[]`): spec edits never rewrite the
   * product row, and facets scan typed indexes directly.
   *
   * Exactly one value column pairs with the definition's type —
   * text/select/multi_select → `valueText`, number → `valueNumber`,
   * boolean → `valueBoolean`, date → `valueDate` (epoch ms); the mutation
   * that writes a row (PH1-07) enforces the pairing. Faceted filtering
   * (research §4.7 P0): `by_attribute_*` answers "products where attribute
   * X = value" as one indexed range (attributeId is the range prefix, the
   * value narrows it); `by_product` serves the product spec sheet. Empty
   * until PH1-07's editor starts writing rows.
   */
  attributeValues: defineTable({
    productId: v.id("products"),
    attributeId: v.id("attributeDefinitions"),
    valueText: v.optional(v.string()),
    valueNumber: v.optional(v.number()),
    valueBoolean: v.optional(v.boolean()),
    valueDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_attribute_text", ["attributeId", "valueText"])
    .index("by_attribute_number", ["attributeId", "valueNumber"])
    .index("by_attribute_boolean", ["attributeId", "valueBoolean"])
    .index("by_attribute_date", ["attributeId", "valueDate"]),

  /**
   * Warehouses (PH1-16). Stock locations the ledger (PH1-17) will post
   * against. `code` is the short unique label staff type (normalized
   * uppercase). Exactly one row is `isDefault` — receipts and adjustments
   * that don't name a warehouse land there. An inactive warehouse stays
   * readable (history will point at it) but cannot be the default.
   * `address` is one free-text block until customers bring structured
   * addresses (PH2-01).
   */
  warehouses: defineTable({
    code: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    isDefault: v.boolean(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_active", ["active"]),

  /**
   * Unit serials (PH1-14, schema-first — UI and receipt/pick workflows wait
   * for Phase 5). One row per physical unit of a `serialTracked` product.
   * `number` is the scanned identity (trim only — manufacturer codes are
   * case-sensitive); org-wide uniqueness is a future write-time probe on
   * `by_number`, the same split as SKUs. `status` is the lifecycle in
   * `lib/serials` (`available → reserved → shipped → returned → service →
   * disabled`); this row stores the CURRENT state only. Movements name the
   * serial (PH1-17); changing this status stays a Phase 5 workflow.
   *
   * Warranty registration (PH5-13) lives HERE, not in a third table: at
   * shipment the sale snapshots `warrantyStart` (delivery time) and
   * `warrantyMonths` (from the product). `warrantyLookup` in `lib/serials`
   * answers valid / expired / none. No public mutation yet.
   *
   * Which warehouse holds the unit is a ledger fact (PH1-17), not a column
   * here. `customerId` waits for `customers` (PH2-01). On-hand quantity is
   * never stored on the serial; a unit is one, and the ledger references it.
   */
  serials: defineTable({
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    /** Scanned serial. Uniqueness is enforced at write time, not by schema. */
    number: v.string(),
    status: v.union(
      v.literal("available"),
      v.literal("reserved"),
      v.literal("shipped"),
      v.literal("returned"),
      v.literal("service"),
      v.literal("disabled"),
    ),
    /** Set when the unit ships (PH5-13). Epoch ms. */
    warrantyStart: v.optional(v.number()),
    /** Snapshot of the product term at shipment — not a live join. */
    warrantyMonths: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["number"])
    .index("by_product", ["productId"])
    .index("by_product_status", ["productId", "status"])
    .index("by_status", ["status"]),

  /**
   * Lot / batch master (PH1-14, schema-first). One row per supplier batch
   * of a `lotTracked` product — identity, dates, and disposition. Quantity
   * is NOT stored here; on-hand per warehouse is the stock ledger (PH1-17),
   * which will point at `lotId`. FEFO (PH5-06) scans `by_product_expiry`
   * (a lot with no expiry sits under the index's null key, so a range over
   * real dates skips it).
   *
   * `supplier` is the name captured at receipt. `vendorId` waits for the
   * vendors table (PH2-03). `status` is the disposition in `lib/lots`;
   * `effectiveLotStatus` additionally treats a `released` lot whose
   * `expiryDate` has passed as `expired` without rewriting the row — the
   * daily expiry job (PH5-08) is what persists that transition. No public
   * mutation yet.
   */
  lots: defineTable({
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    /** Supplier batch code. Unique per product (`by_product_number`). */
    number: v.string(),
    /** Free-text supplier until `vendors` exists (PH2-03). */
    supplier: v.optional(v.string()),
    /** When we received the batch. Epoch ms. */
    receivedDate: v.number(),
    mfgDate: v.optional(v.number()),
    expiryDate: v.optional(v.number()),
    status: v.union(
      v.literal("released"),
      v.literal("quarantined"),
      v.literal("recalled"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_product_number", ["productId", "number"])
    .index("by_product_expiry", ["productId", "expiryDate"])
    .index("by_status", ["status"]),

  /**
   * Append-only stock ledger (PH1-17). One row per movement; nothing in
   * this module patches or deletes a row — a correction is a new
   * adjustment. `qty` is signed by type (`lib/stock`): receipts, transfer
   * ins, and reservations are positive; issues, transfer outs, and
   * releases are negative; adjustments are either sign except zero.
   * On-hand is the sum of the physical types; reserved is the sum of
   * reservation + release. `available = onHand − reserved` is PH1-18.
   *
   * `unitCost` is the cost per base unit at this moment (moving average
   * is a later read, not a column). `referenceType` + `referenceId` name
   * the document that caused the line; both are absent on a bare post.
   * A manual adjustment (PH1-20) also carries `reason`, an optional
   * `note`, and an optional `photoFileId`. Those three stay absent on
   * every other type.
   * `serialIds` lists the units this line moved — a serial is one, so
   * |qty| equals the list length when the list is not empty. No
   * `updatedAt`: the row is the timestamp.
   */
  stockMovements: defineTable({
    type: v.union(
      v.literal("receipt"),
      v.literal("issue"),
      v.literal("transferIn"),
      v.literal("transferOut"),
      v.literal("adjustment"),
      v.literal("reservation"),
      v.literal("release"),
    ),
    qty: v.number(),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    warehouseId: v.id("warehouses"),
    lotId: v.optional(v.id("lots")),
    serialIds: v.array(v.id("serials")),
    referenceType: v.optional(v.string()),
    referenceId: v.optional(v.string()),
    unitCost: v.optional(v.number()),
    /** Why a manual adjustment changed the count (PH1-20). Absent on other types. */
    reason: v.optional(
      v.union(
        v.literal("damage"),
        v.literal("countCorrection"),
        v.literal("writeOff"),
        v.literal("found"),
      ),
    ),
    /** Warehouse note beside the reason. Blank is stored as absent. */
    note: v.optional(v.string()),
    /** Optional photo of the damage, the count, or the found units. */
    photoFileId: v.optional(v.id("files")),
    actorId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_product", ["productId", "createdAt"])
    .index("by_product_warehouse", ["productId", "warehouseId", "createdAt"])
    .index("by_warehouse", ["warehouseId", "createdAt"])
    .index("by_lot", ["lotId"])
    .index("by_reference", ["referenceType", "referenceId"]),

  /**
   * Warehouse transfer (PH1-21). Draft holds no stock. Shipping posts a
   * transfer out at the source and the document becomes in-transit.
   * Each receipt posts a transfer in at the destination for the quantity
   * that arrived. The document stays in transit until every line is
   * fully received. Cancel is draft-only — once goods have left, the
   * way back is a receipt or another transfer.
   */
  stockTransfers: defineTable({
    /** `TR-0007` from the `stockTransfer` sequence. */
    number: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("inTransit"),
      v.literal("received"),
      v.literal("cancelled"),
    ),
    fromWarehouseId: v.id("warehouses"),
    toWarehouseId: v.id("warehouses"),
    note: v.optional(v.string()),
    shippedAt: v.optional(v.number()),
    /** Set when the last outstanding unit is received. */
    receivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["number"])
    .index("by_status", ["status", "createdAt"])
    .index("by_from", ["fromWarehouseId", "status"])
    .index("by_to", ["toWarehouseId", "status"]),

  /** One product slice on a transfer. `receivedQty` grows with each receipt. */
  stockTransferLines: defineTable({
    transferId: v.id("stockTransfers"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    lotId: v.optional(v.id("lots")),
    /** Serials that leave the source. Empty when the line is not serial-tracked. */
    serialIds: v.array(v.id("serials")),
    /** Subset of `serialIds` already received at the destination. */
    receivedSerialIds: v.array(v.id("serials")),
    /** Positive amount that leaves the source on ship. */
    qty: v.number(),
    receivedQty: v.number(),
    /** Latest source cost, captured at ship and copied onto each receipt. */
    unitCost: v.optional(v.number()),
  }).index("by_transfer", ["transferId"]),

  /**
   * Goods receipt. A manual intake (PH1-22) names a reference note and
   * posts one ledger receipt per line. A purchase-order receipt (PH2-22)
   * sets `purchaseOrderId` and records accepted and rejected quantities.
   * The document is not edited; a correction is another movement.
   */
  goodsReceipts: defineTable({
    /** `GRN-0007` from the `goodsReceipt` sequence. */
    number: v.string(),
    warehouseId: v.id("warehouses"),
    /** Required. Blank is refused. */
    referenceNote: v.string(),
    /**
     * Who supplied the goods, when the intake names them (PH2-04).
     * A unit cost on a line then updates that product↔vendor link's
     * last purchase price. Absent on a manual intake that has no vendor.
     */
    vendorId: v.optional(v.id("vendors")),
    /** Set when the intake is against a purchase order (PH2-22). */
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    createdAt: v.number(),
  })
    .index("by_number", ["number"])
    .index("by_warehouse", ["warehouseId", "createdAt"])
    .index("by_vendor", ["vendorId", "createdAt"])
    .index("by_purchase_order", ["purchaseOrderId", "createdAt"]),

  goodsReceiptLines: defineTable({
    receiptId: v.id("goodsReceipts"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    lotId: v.optional(v.id("lots")),
    serialIds: v.array(v.id("serials")),
    /** Quantity that entered stock. For a purchase-order line this is the accepted quantity. */
    qty: v.number(),
    unitCost: v.optional(v.number()),
    /** The purchase-order line this intake fulfills (PH2-22). */
    purchaseOrderLineId: v.optional(v.id("purchaseOrderLines")),
    qtyAccepted: v.optional(v.number()),
    qtyRejected: v.optional(v.number()),
    /** Moving average at this warehouse after the accepted quantity landed. */
    averageCost: v.optional(v.number()),
    /** The ledger row this line posted. Absent when nothing was accepted. */
    movementId: v.optional(v.id("stockMovements")),
  }).index("by_receipt", ["receiptId"]),

  /**
   * Purchase return to a vendor (PH2-24). One debit note, numbered
   * `DBN-`, for quantity that already entered on a goods receipt.
   * Each line posts a stock issue at the receipt's unit cost. The
   * debit note number is the reference. A journal intent waits for
   * PH2-26. The receipt and the purchase order stay as they were.
   */
  purchaseReturns: defineTable({
    /** `DBN-0007` from the `debitNote` sequence. This is the debit note reference. */
    docNumber: v.string(),
    goodsReceiptId: v.id("goodsReceipts"),
    vendorId: v.optional(v.id("vendors")),
    warehouseId: v.id("warehouses"),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_receipt", ["goodsReceiptId", "createdAt"])
    .index("by_vendor", ["vendorId", "createdAt"]),

  /** Quantity sent back from one receipt line, and the issue that took it out. */
  purchaseReturnLines: defineTable({
    purchaseReturnId: v.id("purchaseReturns"),
    goodsReceiptLineId: v.id("goodsReceiptLines"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitCost: v.optional(v.number()),
    movementId: v.id("stockMovements"),
    createdAt: v.number(),
  })
    .index("by_return", ["purchaseReturnId"])
    .index("by_receipt_line", ["goodsReceiptLineId"]),

  /**
   * Reorder point (PH1-24). One row per product, or per product at one
   * warehouse. A missing `warehouseId` is the product-wide point; a
   * warehouse row overrides it there. `qty` is the available quantity
   * at or below which the slice is low. The daily job reads these.
   */
  reorderPoints: defineTable({
    productId: v.id("products"),
    warehouseId: v.optional(v.id("warehouses")),
    qty: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_product", ["productId"]),

  /**
   * An open low-stock notice (PH1-24). The daily job inserts one when
   * a slice first falls to its reorder point, and sets `open` false
   * once available rises above it. A slice that stays low is not
   * notified again.
   */
  /**
   * Customer groups (PH2-02). A tier such as Retail, Wholesale, or
   * Institutional. `nameKey` is the trimmed lowercase name, so
   * "Wholesale" and "wholesale" are the same group. A group is
   * deactivated, never deleted, while customers may still name it.
   * A customer has at most one group.
   */
  customerGroups: defineTable({
    name: v.string(),
    nameKey: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name_key", ["nameKey"]),

  /**
   * Customer master (PH2-01). One company. Contacts, addresses, and
   * the notes timeline are their own tables. `status` is the account:
   * active, on hold (no new credit sales once orders exist), or closed.
   * `paymentTermsDays` is whole days until due; zero is due on receipt.
   * A missing `creditLimit` means no cap. `currency` is an ISO code
   * from the currency catalog. A missing `groupId` means no tier.
   */
  customers: defineTable({
    code: v.string(),
    name: v.string(),
    status: v.union(v.literal("active"), v.literal("onHold"), v.literal("closed")),
    paymentTermsDays: v.number(),
    taxGroupId: v.optional(v.id("taxGroups")),
    groupId: v.optional(v.id("customerGroups")),
    currency: v.string(),
    creditLimit: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_status", ["status"])
    .index("by_group", ["groupId"]),

  /** People at a customer. At most one row is the primary contact. */
  customerContacts: defineTable({
    customerId: v.id("customers"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    isPrimary: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_customer", ["customerId"]),

  /**
   * Bill-to and ship-to addresses. The two default flags are
   * independent: one address may be both, and each flag is unique
   * per customer.
   */
  customerAddresses: defineTable({
    customerId: v.id("customers"),
    line1: v.string(),
    line2: v.optional(v.string()),
    city: v.string(),
    region: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.string(),
    isDefaultBill: v.boolean(),
    isDefaultShip: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_customer", ["customerId"]),

  /**
   * Notes timeline. Append-only: a correction is another note.
   * `authorId` is the staff user who wrote it.
   */
  customerNotes: defineTable({
    customerId: v.id("customers"),
    body: v.string(),
    authorId: v.id("users"),
    createdAt: v.number(),
  }).index("by_customer", ["customerId", "createdAt"]),

  /**
   * Vendor master (PH2-03). One company we buy from. Contacts and
   * addresses are their own tables. `active` false keeps the row;
   * there is no hard delete. License number, jurisdiction, and expiry
   * are stored here. Phase 5 is what refuses an expired license.
   * `paymentTermsDays` is whole days until we pay; zero is due on
   * receipt. `currency` is an ISO code from the currency catalog.
   */
  vendors: defineTable({
    code: v.string(),
    name: v.string(),
    active: v.boolean(),
    paymentTermsDays: v.number(),
    taxGroupId: v.optional(v.id("taxGroups")),
    taxNumber: v.optional(v.string()),
    currency: v.string(),
    licenseNumber: v.optional(v.string()),
    licenseJurisdiction: v.optional(v.string()),
    licenseExpiresOn: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_active", ["active"]),

  /** People at a vendor. At most one row is the primary contact. */
  vendorContacts: defineTable({
    vendorId: v.id("vendors"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    isPrimary: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_vendor", ["vendorId"]),

  /**
   * Remit-to and ship-from addresses. The two default flags are
   * independent: one address may be both, and each flag is unique
   * per vendor.
   */
  vendorAddresses: defineTable({
    vendorId: v.id("vendors"),
    line1: v.string(),
    line2: v.optional(v.string()),
    city: v.string(),
    region: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    country: v.string(),
    isDefaultRemit: v.boolean(),
    isDefaultShip: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_vendor", ["vendorId"]),

  /**
   * Product↔vendor link (PH2-04). A product may name several vendors.
   * Exactly one of its links is preferred. `vendorSku` is the supplier's
   * code. `lastPurchasePrice` is written by a goods receipt for this
   * vendor, never typed. A missing price means no receipt has costed
   * the product from this vendor yet. Deleting the product removes
   * these rows. The vendor itself is not deleted.
   */
  productVendors: defineTable({
    productId: v.id("products"),
    vendorId: v.id("vendors"),
    vendorSku: v.optional(v.string()),
    preferred: v.boolean(),
    lastPurchasePrice: v.optional(v.number()),
    lastPurchaseAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_vendor", ["vendorId"])
    .index("by_product_vendor", ["productId", "vendorId"]),

  /**
   * Internal request to buy (PH2-20). The requester is the signed-in
   * user. Approval is role-gated (`procurement.approve`), not a money
   * threshold — the rules engine is Phase 6. Converting an approved
   * request creates one draft purchase order. Rejected is terminal.
   */
  requisitions: defineTable({
    docNumber: v.string(),
    requesterId: v.id("users"),
    /** UTC midnight. The date the goods are needed by. */
    needBy: v.number(),
    note: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("rejected")),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.id("users")),
    rejectedAt: v.optional(v.number()),
    rejectReason: v.optional(v.string()),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_status", ["status"])
    .index("by_requester", ["requesterId"]),

  /** One requested product. A product with variants must name one. */
  requisitionLines: defineTable({
    requisitionId: v.id("requisitions"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    sort: v.number(),
    createdAt: v.number(),
  }).index("by_requisition", ["requisitionId"]),

  /**
   * Purchase order (PH2-20 drafts it from a requisition; PH2-21 is the
   * document). `sent` freezes the agreed price and tax. A receipt
   * (PH2-22) sets partially received or received. A vendor bill
   * (PH2-23) sets billed. Email waits for Phase 4.
   */
  purchaseOrders: defineTable({
    docNumber: v.string(),
    vendorId: v.id("vendors"),
    requisitionId: v.id("requisitions"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("partiallyReceived"),
      v.literal("received"),
      v.literal("billed"),
    ),
    currency: v.string(),
    decimalPlaces: v.number(),
    /** UTC midnight. Copied from the requisition, editable while draft. */
    expectedDate: v.number(),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_vendor", ["vendorId"])
    .index("by_requisition", ["requisitionId"])
    .index("by_status", ["status"]),

  /**
   * One ordered product. `unitPrice` is the agreed price. Tax fields
   * are snapshotted from the vendor's tax group; a row written before
   * that snapshot (PH2-20) leaves them empty until the order is edited
   * or sent.
   */
  purchaseOrderLines: defineTable({
    purchaseOrderId: v.id("purchaseOrders"),
    requisitionLineId: v.optional(v.id("requisitionLines")),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    taxCategory: v.optional(
      v.union(v.literal("standard"), v.literal("reduced"), v.literal("zero"), v.literal("exempt")),
    ),
    taxRateId: v.optional(v.id("taxRates")),
    rateBps: v.optional(v.number()),
    inclusive: v.optional(v.boolean()),
    net: v.optional(v.number()),
    tax: v.optional(v.number()),
    gross: v.optional(v.number()),
    sort: v.number(),
    createdAt: v.number(),
  }).index("by_order", ["purchaseOrderId"]),

  /**
   * Vendor bill (PH2-23). Recorded from a received purchase order or
   * on its own. `open` can be edited. Matching writes a `vendorBill`
   * journal intent and, when the bill names an order, marks that order
   * billed. `paid` is reserved for the payment in Phase 3.
   */
  vendorBills: defineTable({
    docNumber: v.string(),
    vendorId: v.id("vendors"),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    status: v.union(v.literal("open"), v.literal("matched"), v.literal("paid")),
    currency: v.string(),
    decimalPlaces: v.number(),
    /** UTC midnight. */
    billDate: v.number(),
    /** The vendor's own invoice number, when they sent one. */
    reference: v.optional(v.string()),
    matchedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_vendor", ["vendorId", "createdAt"])
    .index("by_purchase_order", ["purchaseOrderId"])
    .index("by_status", ["status"]),

  vendorBillLines: defineTable({
    vendorBillId: v.id("vendorBills"),
    purchaseOrderLineId: v.optional(v.id("purchaseOrderLines")),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    taxCategory: v.union(
      v.literal("standard"),
      v.literal("reduced"),
      v.literal("zero"),
      v.literal("exempt"),
    ),
    taxRateId: v.optional(v.id("taxRates")),
    rateBps: v.number(),
    inclusive: v.boolean(),
    net: v.number(),
    tax: v.number(),
    gross: v.number(),
    sort: v.number(),
    createdAt: v.number(),
  }).index("by_bill", ["vendorBillId"]),

  /**
   * A sell-price list (PH2-06). One list is the base. The first list
   * becomes the base, and retiring the base promotes the oldest other
   * list. A list is deactivated, never deleted. `currency` is an ISO
   * code; it cannot change once the list has a price. `nameKey` is the
   * trimmed lowercase name.
   */
  priceLists: defineTable({
    name: v.string(),
    nameKey: v.string(),
    currency: v.string(),
    active: v.boolean(),
    isBase: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name_key", ["nameKey"])
    .index("by_base", ["isBase"]),

  /**
   * One product price on a list. A missing `variantId` is the product
   * itself; a present one must be that product's variant. The currency
   * is the list's. Deleting the product removes these rows.
   */
  priceListPrices: defineTable({
    priceListId: v.id("priceLists"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    price: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_list", ["priceListId"])
    .index("by_list_product", ["priceListId", "productId"])
    .index("by_product", ["productId"]),

  /**
   * A price for one customer group, in one currency. The same product
   * may have a row per currency. A missing `variantId` is the product.
   * An inactive group keeps the rows it already has.
   */
  customerGroupPrices: defineTable({
    customerGroupId: v.id("customerGroups"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    currency: v.string(),
    price: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_group", ["customerGroupId"])
    .index("by_group_product", ["customerGroupId", "productId"])
    .index("by_product", ["productId"]),

  /**
   * A price for one customer, in one currency. A closed customer keeps
   * the rows it already has. A missing `variantId` is the product.
   */
  customerPrices: defineTable({
    customerId: v.id("customers"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    currency: v.string(),
    price: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_product", ["customerId", "productId"])
    .index("by_product", ["productId"]),

  /**
   * A volume break (PH2-06): from `minQty` units, the unit price is
   * `price`. Qty 1 is the parent row, so `minQty` is at least 2. The
   * break hangs off exactly one list, group, or customer price, and
   * that row's currency is the break's currency. Deleting the parent
   * price removes its breaks.
   */
  quantityBreaks: defineTable({
    scope: v.union(v.literal("list"), v.literal("group"), v.literal("customer")),
    priceListPriceId: v.optional(v.id("priceListPrices")),
    customerGroupPriceId: v.optional(v.id("customerGroupPrices")),
    customerPriceId: v.optional(v.id("customerPrices")),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    minQty: v.number(),
    price: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_list_price", ["priceListPriceId"])
    .index("by_group_price", ["customerGroupPriceId"])
    .index("by_customer_price", ["customerPriceId"])
    .index("by_product", ["productId"]),

  /**
   * A dated promotion hook (PH2-06). The window is stored. When two
   * overlap, `resolvePrice` keeps the one that started latest, then
   * the one created latest. `priceListId` points at the list in effect
   * during the window; a missing one means the window is recorded and
   * not aimed at a list yet. Deactivate, never delete. A past window
   * is a valid record.
   */
  promotions: defineTable({
    name: v.string(),
    nameKey: v.string(),
    startsOn: v.number(),
    endsOn: v.number(),
    active: v.boolean(),
    priceListId: v.optional(v.id("priceLists")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_list", ["priceListId"]),

  /**
   * A manual price on a sales-document line (PH2-08). The line tables
   * arrive with the documents (PH2-11+); `documentId` and `lineId` are
   * those ids, stored as text until then. One row per line. A discount
   * above the threshold is `pending` until a second person confirms it.
   * The person who asked cannot confirm their own.
   */
  priceOverrides: defineTable({
    documentKind: v.union(
      v.literal("quote"),
      v.literal("salesOrder"),
      v.literal("invoice"),
      v.literal("creditNote"),
    ),
    documentId: v.string(),
    lineId: v.string(),
    currency: v.string(),
    resolvedUnitPrice: v.optional(v.number()),
    mode: v.union(v.literal("price"), v.literal("discount")),
    manualPrice: v.optional(v.number()),
    requestedDiscountPercent: v.optional(v.number()),
    /** Achieved discount after rounding. Absent when there was no resolved price. */
    discountPercent: v.optional(v.number()),
    unitPrice: v.number(),
    needsApproval: v.boolean(),
    status: v.union(
      v.literal("applied"),
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    reason: v.string(),
    requestedBy: v.id("users"),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_line", ["documentKind", "documentId", "lineId"])
    .index("by_status", ["status"]),

  /**
   * A quote (PH2-11). The number comes from the `quote` sequence.
   * Status moves draft → sent → accepted, and either open state can
   * be rejected or expired. Accepted converts once, into a draft
   * sales order that keeps these lines and prices. Addresses, terms,
   * currency, and tax are copied onto the document so a later change
   * to the customer does not rewrite the quote.
   */
  quotes: defineTable({
    docNumber: v.string(),
    customerId: v.id("customers"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    currency: v.string(),
    decimalPlaces: v.number(),
    /** UTC midnight. */
    quoteDate: v.number(),
    /** UTC midnight. The quote is valid through this day. */
    validUntil: v.number(),
    paymentTermsDays: v.number(),
    taxGroupId: v.optional(v.id("taxGroups")),
    billTo: v.optional(documentAddress),
    shipTo: v.optional(documentAddress),
    notes: v.optional(v.string()),
    salesOrderId: v.optional(v.id("salesOrders")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"])
    .index("by_number", ["docNumber"]),

  /**
   * One quoted product. `unitPrice` is what the line charges now
   * (the resolved price until a discount is applied or approved).
   * Tax rate and amounts are stored so a later tax-rate edit does
   * not change this quote.
   */
  quoteLines: defineTable({
    quoteId: v.id("quotes"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    resolvedUnitPrice: v.number(),
    /** The discount asked for. Zero when the line charges the resolved price. */
    discountPercent: v.number(),
    unitPrice: v.number(),
    taxCategory: v.union(
      v.literal("standard"),
      v.literal("reduced"),
      v.literal("zero"),
      v.literal("exempt"),
    ),
    taxRateId: v.optional(v.id("taxRates")),
    rateBps: v.number(),
    inclusive: v.boolean(),
    net: v.number(),
    tax: v.number(),
    gross: v.number(),
    sort: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_quote", ["quoteId"]),

  /**
   * A sales order opened from a quote (PH2-11, PH2-12). Lines and
   * prices are copied; they are not priced again. Confirming picks
   * one warehouse and reserves what is free. A short line stays
   * `backorder`. Shipping turns that reservation into an issue.
   * `warehouseId` is absent until the order is confirmed.
   */
  salesOrders: defineTable({
    docNumber: v.string(),
    customerId: v.id("customers"),
    quoteId: v.id("quotes"),
    status: v.union(
      v.literal("draft"),
      v.literal("confirmed"),
      v.literal("fulfilling"),
      v.literal("invoiced"),
      v.literal("closed"),
      v.literal("cancelled"),
    ),
    /** `storefront` is written by the shop later. Staff orders are `manual`. */
    channel: v.union(v.literal("manual"), v.literal("storefront")),
    currency: v.string(),
    decimalPlaces: v.number(),
    paymentTermsDays: v.number(),
    warehouseId: v.optional(v.id("warehouses")),
    billTo: v.optional(documentAddress),
    shipTo: v.optional(documentAddress),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_quote", ["quoteId"])
    .index("by_number", ["docNumber"])
    .index("by_status", ["status"]),

  /**
   * One ordered product. `qty` is what was ordered. `reservedQty` is
   * still held. `fulfilledQty` has shipped. Older rows omit the three
   * progress fields; readers treat that as nothing reserved, nothing
   * shipped, and not on backorder.
   */
  salesOrderLines: defineTable({
    salesOrderId: v.id("salesOrders"),
    quoteLineId: v.id("quoteLines"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    discountPercent: v.number(),
    taxCategory: v.union(
      v.literal("standard"),
      v.literal("reduced"),
      v.literal("zero"),
      v.literal("exempt"),
    ),
    taxRateId: v.optional(v.id("taxRates")),
    rateBps: v.number(),
    inclusive: v.boolean(),
    net: v.number(),
    tax: v.number(),
    gross: v.number(),
    reservedQty: v.optional(v.number()),
    fulfilledQty: v.optional(v.number()),
    backorder: v.optional(v.boolean()),
    sort: v.number(),
    createdAt: v.number(),
  }).index("by_order", ["salesOrderId"]),

  /**
   * A packing slip (PH2-14). Packing claims reserved quantity and
   * does not move stock. Shipping posts the goods issue, keeps the
   * unit cost, and writes the cost-of-goods journal intent. The
   * number comes from the `deliveryNote` sequence (`DN-`).
   * A slip that was packed by mistake is cancelled; a shipped slip
   * stays, because the goods have left.
   */
  deliveries: defineTable({
    docNumber: v.string(),
    salesOrderId: v.id("salesOrders"),
    warehouseId: v.id("warehouses"),
    status: v.union(v.literal("packed"), v.literal("shipped"), v.literal("cancelled")),
    carrier: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    /** UTC midnight of the ship date. Absent until the slip ships. */
    shippedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_order", ["salesOrderId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_warehouse", ["warehouseId", "status"]),

  /**
   * One packed product. `unitCost` and `movementId` are written when
   * the goods issue posts. A packed slip leaves both absent.
   */
  deliveryLines: defineTable({
    deliveryId: v.id("deliveries"),
    salesOrderLineId: v.id("salesOrderLines"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitCost: v.optional(v.number()),
    movementId: v.optional(v.id("stockMovements")),
    sort: v.number(),
  })
    .index("by_delivery", ["deliveryId"])
    .index("by_order_line", ["salesOrderLineId"]),

  /**
   * A sales invoice (PH2-16). Generated from shipped quantity on an
   * order or one delivery. The number comes from the `invoice`
   * sequence (`INV-`). Prices and tax rates are copied from the order
   * line and the amounts are worked out for the quantity on this
   * invoice. Draft can be posted or voided. Posting writes the
   * `salesInvoice` journal intent. Paid is a status until a payment
   * is applied in Phase 3; it does not reduce the balance by itself.
   * A posted invoice is corrected by a credit note (PH2-17), not by
   * voiding it.
   */
  salesInvoices: defineTable({
    docNumber: v.string(),
    customerId: v.id("customers"),
    salesOrderId: v.id("salesOrders"),
    deliveryId: v.optional(v.id("deliveries")),
    status: v.union(v.literal("draft"), v.literal("posted"), v.literal("paid"), v.literal("void")),
    currency: v.string(),
    decimalPlaces: v.number(),
    paymentTermsDays: v.number(),
    /** UTC midnight. */
    invoiceDate: v.number(),
    /** UTC midnight. The terms counted from `invoiceDate`. */
    dueDate: v.number(),
    billTo: v.optional(documentAddress),
    shipTo: v.optional(documentAddress),
    postedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_customer", ["customerId"])
    .index("by_order", ["salesOrderId"])
    .index("by_delivery", ["deliveryId"])
    .index("by_status", ["status", "createdAt"]),

  /**
   * One invoiced product. `unitPrice` is the order line's charged
   * price. Tax amounts are for `qty`, not the whole order line.
   */
  salesInvoiceLines: defineTable({
    invoiceId: v.id("salesInvoices"),
    salesOrderLineId: v.id("salesOrderLines"),
    deliveryLineId: v.optional(v.id("deliveryLines")),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    discountPercent: v.number(),
    taxCategory: v.union(
      v.literal("standard"),
      v.literal("reduced"),
      v.literal("zero"),
      v.literal("exempt"),
    ),
    taxRateId: v.optional(v.id("taxRates")),
    rateBps: v.number(),
    inclusive: v.boolean(),
    net: v.number(),
    tax: v.number(),
    gross: v.number(),
    sort: v.number(),
    createdAt: v.number(),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_order_line", ["salesOrderLineId"]),

  /**
   * A credit note (PH2-17). It reduces one posted or paid invoice.
   * The number comes from the `creditNote` sequence (`CR-`). A return
   * may put the goods back in the order's warehouse. An adjustment
   * never does. Posting writes the `creditNote` journal intent. A
   * draft can be voided. A posted note stays. `salesReturnId` is set
   * when the note was the outcome of a return (PH2-18).
   */
  creditNotes: defineTable({
    docNumber: v.string(),
    invoiceId: v.id("salesInvoices"),
    customerId: v.id("customers"),
    salesOrderId: v.id("salesOrders"),
    kind: v.union(v.literal("return"), v.literal("adjustment")),
    /** A return may restock. An adjustment stores false. */
    restock: v.boolean(),
    status: v.union(v.literal("draft"), v.literal("posted"), v.literal("void")),
    currency: v.string(),
    decimalPlaces: v.number(),
    /** UTC midnight. */
    creditDate: v.number(),
    reason: v.string(),
    /** Set when a return puts goods back. */
    warehouseId: v.optional(v.id("warehouses")),
    /** The return that opened this note, when it was not drafted on its own. */
    salesReturnId: v.optional(v.id("salesReturns")),
    postedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_invoice", ["invoiceId"])
    .index("by_customer", ["customerId"])
    .index("by_status", ["status", "createdAt"]),

  /**
   * One credited product. Prices and tax are the invoice line's, for
   * this quantity. `movementId` is the receipt when the line was
   * restocked.
   */
  creditNoteLines: defineTable({
    creditNoteId: v.id("creditNotes"),
    invoiceLineId: v.id("salesInvoiceLines"),
    salesOrderLineId: v.id("salesOrderLines"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    discountPercent: v.number(),
    taxCategory: v.union(
      v.literal("standard"),
      v.literal("reduced"),
      v.literal("zero"),
      v.literal("exempt"),
    ),
    taxRateId: v.optional(v.id("taxRates")),
    rateBps: v.number(),
    inclusive: v.boolean(),
    net: v.number(),
    tax: v.number(),
    gross: v.number(),
    movementId: v.optional(v.id("stockMovements")),
    sort: v.number(),
    createdAt: v.number(),
  }).index("by_credit", ["creditNoteId"]),

  /**
   * A sales return (PH2-18). The number comes from the `rma` sequence
   * (`RMA-`). The request names lines and quantities from a posted
   * invoice or from an order that has shipped. Receiving inspects
   * each line. The outcome is one posted credit note or one draft
   * exchange order. Cancel is only while the return is still a request.
   */
  salesReturns: defineTable({
    docNumber: v.string(),
    customerId: v.id("customers"),
    salesOrderId: v.id("salesOrders"),
    /** Set when the request is opened from an invoice, or the order's lines sit on one. */
    invoiceId: v.optional(v.id("salesInvoices")),
    status: v.union(
      v.literal("requested"),
      v.literal("received"),
      v.literal("credited"),
      v.literal("exchanged"),
      v.literal("cancelled"),
    ),
    reason: v.string(),
    currency: v.string(),
    decimalPlaces: v.number(),
    /** The order's warehouse, copied when the goods are received. */
    warehouseId: v.optional(v.id("warehouses")),
    creditNoteId: v.optional(v.id("creditNotes")),
    exchangeOrderId: v.optional(v.id("salesOrders")),
    receivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_number", ["docNumber"])
    .index("by_customer", ["customerId"])
    .index("by_order", ["salesOrderId"])
    .index("by_invoice", ["invoiceId"])
    .index("by_status", ["status", "createdAt"]),

  /**
   * One product coming back. Prices are the source line's, for this
   * quantity. Disposition and the ledger ids are absent until receive.
   * A restock stores the receipt. A quarantine also stores the hold.
   * A write-off stores the receipt and the write-off.
   */
  salesReturnLines: defineTable({
    salesReturnId: v.id("salesReturns"),
    salesOrderLineId: v.id("salesOrderLines"),
    invoiceLineId: v.optional(v.id("salesInvoiceLines")),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    description: v.string(),
    sku: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    disposition: v.optional(
      v.union(v.literal("restock"), v.literal("quarantine"), v.literal("writeOff")),
    ),
    movementId: v.optional(v.id("stockMovements")),
    holdMovementId: v.optional(v.id("stockMovements")),
    writeOffMovementId: v.optional(v.id("stockMovements")),
    sort: v.number(),
    createdAt: v.number(),
  }).index("by_return", ["salesReturnId"]),

  /**
   * A posting Phase 3 has not consumed. PH2-14 opened the table for
   * cost of goods. PH2-16 adds a sales invoice. PH2-17 adds a credit
   * note. PH2-23 adds a vendor bill. PH2-26 adds a goods receipt, a
   * debit note, and a stock adjustment. `status` stays pending until
   * the posting engine. `amount` is the cost of goods, the invoice
   * gross, the credit gross, the bill gross, the inventory value that
   * entered, the debit-note cost, or the signed adjustment. `net` and
   * `tax` are set on a sales invoice, a credit note, and a vendor bill.
   * A missing unit cost is an amount of zero so the event is still on
   * the backlog. A rejection-only receipt writes nothing.
   */
  journalIntents: defineTable({
    type: v.union(
      v.literal("cogs"),
      v.literal("salesInvoice"),
      v.literal("creditNote"),
      v.literal("vendorBill"),
      v.literal("goodsReceipt"),
      v.literal("debitNote"),
      v.literal("stockAdjustment"),
    ),
    sourceType: v.union(
      v.literal("delivery"),
      v.literal("salesInvoice"),
      v.literal("creditNote"),
      v.literal("vendorBill"),
      v.literal("goodsReceipt"),
      v.literal("purchaseReturn"),
      v.literal("stockAdjustment"),
    ),
    sourceId: v.union(
      v.id("deliveries"),
      v.id("salesInvoices"),
      v.id("creditNotes"),
      v.id("vendorBills"),
      v.id("goodsReceipts"),
      v.id("purchaseReturns"),
      v.id("stockMovements"),
    ),
    status: v.literal("pending"),
    /** `YYYY-MM` of the ship, invoice, credit, bill, receipt, return, or adjustment. */
    period: v.string(),
    currency: v.string(),
    amount: v.number(),
    net: v.optional(v.number()),
    tax: v.optional(v.number()),
    lines: v.array(
      v.object({
        productId: v.id("products"),
        variantId: v.optional(v.id("variants")),
        description: v.string(),
        qty: v.number(),
        unitCost: v.optional(v.number()),
        unitPrice: v.optional(v.number()),
        net: v.optional(v.number()),
        tax: v.optional(v.number()),
        amount: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_type", ["type", "createdAt"]),

  lowStockNotices: defineTable({
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    warehouseId: v.id("warehouses"),
    open: v.boolean(),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_open", ["open"])
    .index("by_product_warehouse", ["productId", "warehouseId"]),
});
