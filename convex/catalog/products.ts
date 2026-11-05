import { ConvexError, v } from "convex/values";
import { MAX_PRICE } from "../../lib/pricing";
import { sanitizeRichText } from "../../lib/richText";
import { validateSku } from "../../lib/sku";
import {
  normalizeUoMCode,
  uomCodeError,
  validateConversions,
  validateDocUoM,
  type Conversion,
} from "../../lib/uom";
import { appendAudit, auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { resolveUniqueSlug } from "../_lib/slugs";
import { syncProductCategoryRows } from "../_lib/productCategories";
import { applicableAttributes } from "./attributes";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Product CRUD + list backend (PH1-07/08) — the editor's backend: `get`
 * loads one product WITH its applicable attribute definitions and stored
 * values (the editor renders from one call), `create`/`update`/`remove`
 * enforce every rule server-side, and `list`/`brands`/`bulkStatus` serve
 * the PH1-08 product table.
 *
 * Rules enforced HERE (never only in UI — docs/permissions.md rule 1):
 * - name 1-100; SKU = `validateSku` from `lib/sku` (PH1-06) — format errors
 *   surface VERBATIM, and uniqueness is `by_sku` at write: no auto-derivation
 *   ever rewrites a typed SKU (only slugs derive, from the name)
 * - slug: `resolveUniqueSlug` probing `by_slug` — omitted/blank derives from
 *   the name with -2/-3 suffixes, explicit must be free (PH1-01 rules)
 * - `categoryIds`/`attributeSetIds`/`images` must reference existing rows;
 *   every `categoryIds` write runs `syncProductCategoryRows` in THIS
 *   transaction (PH1-05's join — insert and update alike, so the join
 *   self-heals)
 * - `longDescription` is sanitized at write (`lib/richText`) — the store can
 *   render it as-is later (PH4-04), because no render path can skip this one
 * - pricing (PH1-10): `listPrice`/`costPrice` optional, finite, 0..MAX_PRICE
 *   (`lib/pricing` — typo guard); cost is DISPLAY-ONLY (the moving-average
 *   cost arrives with inventory/finance), margin % derives at read time and
 *   is staff-side — the storefront projects listPrice alone
 * - UoM (PH1-11): `unitOfMeasure`/`purchaseUoM`/`salesUoM` normalize as
 *   codes (trim+lowercase, 1–16) and `conversions` (pack-size edges
 *   `1 unit = factor × parent`) validate through `lib/uom` — the SAME
 *   module the editor's build gate calls, so error messages are identical
 *   on both sides. Chains must terminate at the base UoM; doc-level UoMs
 *   must be the base or a conversion unit (PH2 lines prefill from them)
 * - `attributeValues` (when present) validate against `applicableAttributes`
 *   — the SAME resolver the editor renders from (`lib/attributes.ts` pure
 *   ordering) — one row per value in the definition's typed column
 *   (PH1-05), select values must be listed options, single-valued types
 *   accept exactly one entry. On update the list is a FULL REPLACE diffed
 *   against existing rows (absent arg = leave values untouched, so
 *   status-only saves can't wipe them)
 * - update is full-form: every PH1-06 field explicitly compared, omitted
 *   optionals clear, flags/arrays required (writer always sends them);
 *   no-op saves record nothing (PH0-30 pattern — autosave-safe)
 * - remove runs the PH1-06 category guard's inverse: it cleans `by_product`
 *   join rows AND value rows so no ghost reference can block a later
 *   category/attribute delete. Stock/serial reference guards arrive with
 *   PH2/PH5 — no referrer table exists yet.
 *
 * Permissions per matrix (PH0-21): view → catalog.view, create →
 * catalog.create (owner/admin/sales), edits → catalog.edit (same), delete →
 * catalog.delete (owner/admin only). Every write is audited with the
 * identity/commercial snapshot (+ valueCount); descriptions stay out of
 * snapshots (long HTML would bloat every entry — the entry itself records
 * that they changed).
 */

const MAX_NAME = 100;
const MAX_BARCODE = 64;
const MAX_BRAND = 100;
const MAX_SHORT_DESCRIPTION = 300;
const MAX_LONG_DESCRIPTION = 100_000;
const MAX_SEO_TITLE = 100;
const MAX_SEO_DESCRIPTION = 300;
const MAX_WARRANTY_MONTHS = 1200; // 100 years — a typo guard, not a policy
const MAX_SHELF_LIFE_DAYS = 36_500; // 100 years
const MAX_VALUE_TEXT = 1000;

type Product = Doc<"products">;
type Definition = Doc<"attributeDefinitions">;
type ValueRow = Doc<"attributeValues">;

/** What the editor submits per attribute value (type decided by definition). */
type ValueEntry = { attributeId: Id<"attributeDefinitions">; value: string | number | boolean };

/** A value placed into exactly one of the schema's typed columns. */
type NormalizedValue = {
  attributeId: Id<"attributeDefinitions">;
  valueText?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueDate?: number;
};

/** The product fields create and update share (update adds `id`). */
type ProductArgs = {
  name: string;
  slug?: string;
  sku: string;
  barcode?: string;
  brand?: string;
  listPrice?: number;
  costPrice?: number;
  shortDescription?: string;
  longDescription?: string;
  status: "draft" | "active" | "archived";
  taxCategory?: "standard" | "reduced" | "zero" | "exempt";
  serialTracked: boolean;
  lotTracked: boolean;
  expiryRequired: boolean;
  warrantyEligible: boolean;
  allowBackorder: boolean;
  warrantyMonths?: number;
  shelfLifeDays?: number;
  unitOfMeasure?: string;
  conversions?: Conversion[];
  purchaseUoM?: string;
  salesUoM?: string;
  images: Id<"files">[];
  categoryIds: Id<"categories">[];
  attributeSetIds: Id<"attributeSets">[];
  seoTitle?: string;
  seoDescription?: string;
};

type NormalizedProduct = Omit<ProductArgs, "slug"> & { slug: string };

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    throw new ConvexError(`Product name must be between 1 and ${MAX_NAME} characters.`);
  }
  return name;
}

function normalizeOptional(
  value: string | undefined,
  max: number,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > max) {
    throw new ConvexError(`${label} must be ${max} characters or fewer.`);
  }
  return trimmed;
}

function normalizeCount(value: number | undefined, max: number, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ConvexError(`${label} must be a whole number between 0 and ${max}.`);
  }
  return value;
}

/**
 * Optional UoM code (PH1-11): blank = unset, otherwise normalized
 * (trim+lowercase) then format-checked by `lib/uom` — verbatim errors, the
 * same messages the editor shows (shared module).
 */
function normalizeOptionalUoM(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) return undefined;
  const code = normalizeUoMCode(value);
  const error = uomCodeError(code, label);
  if (error !== null) throw new ConvexError(error);
  return code;
}

/**
 * Prices (PH1-10): optional, finite, 0..MAX_PRICE — the cap is a typo
 * guard, not a pricing policy. NaN/Infinity ride the same error as a
 * negative (Convex v.number() admits them; HTTP/JSON can't send them, but
 * a direct caller can).
 */
function normalizePrice(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError(`${label} must be zero or more.`);
  }
  if (value > MAX_PRICE) {
    throw new ConvexError(`${label} must be ${MAX_PRICE} or fewer.`);
  }
  return value;
}

/** SKU format (verbatim errors) + org-wide uniqueness via `by_sku`. */
async function requireFreeSku(
  ctx: QueryCtx | MutationCtx,
  raw: string,
  selfId?: Id<"products">,
): Promise<string> {
  const { sku, error } = validateSku(raw);
  if (error !== null) throw new ConvexError(error);
  const hit = await ctx.db
    .query("products")
    .withIndex("by_sku", (q) => q.eq("sku", sku))
    .first();
  // `.first()` not `.unique()`: ANY other row with this SKU is a conflict —
  // a cryptic multi-match throw would hide the real, user-facing message.
  if (hit !== null && hit._id !== selfId) {
    throw new ConvexError(`A product with SKU "${sku}" already exists.`);
  }
  return sku;
}

/**
 * Uniqueness probe for `resolveUniqueSlug` on products: index lookup, not
 * a full scan (products are unbounded rows, unlike categories config).
 */
function productSlugTaken(
  ctx: QueryCtx | MutationCtx,
  selfId?: Id<"products">,
): (slug: string) => Promise<boolean> {
  return async (slug) => {
    const hit = await ctx.db
      .query("products")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    return hit !== null && hit._id !== selfId;
  };
}

function dedupe<T>(ids: T[]): T[] {
  return [...new Set(ids)];
}

async function requireCategories(
  ctx: QueryCtx | MutationCtx,
  ids: Id<"categories">[],
): Promise<Id<"categories">[]> {
  const unique = dedupe(ids);
  for (const id of unique) {
    if ((await ctx.db.get(id)) === null) {
      throw new ConvexError("One of those categories no longer exists.");
    }
  }
  return unique;
}

async function requireSets(
  ctx: QueryCtx | MutationCtx,
  ids: Id<"attributeSets">[],
): Promise<Id<"attributeSets">[]> {
  const unique = dedupe(ids);
  for (const id of unique) {
    if ((await ctx.db.get(id)) === null) {
      throw new ConvexError("One of those attribute sets no longer exists.");
    }
  }
  return unique;
}

async function requireImages(
  ctx: QueryCtx | MutationCtx,
  ids: Id<"files">[],
): Promise<Id<"files">[]> {
  const unique = dedupe(ids);
  for (const id of unique) {
    if ((await ctx.db.get(id)) === null) {
      throw new ConvexError("One of those images no longer exists.");
    }
  }
  return unique;
}

/**
 * Validate + type-place submitted attribute values against the definitions
 * applicable to the product. Entries for attributes NOT assigned to the
 * product are an error (the form and the mutation must agree — same
 * resolver). Exact duplicates collapse (multi-select re-taps), single-valued
 * types accept exactly one entry.
 */
function normalizeValues(entries: ValueEntry[], applicable: Definition[]): NormalizedValue[] {
  const byId = new Map(applicable.map((row) => [row._id, row]));
  const singleSeen = new Set<string>();
  const rows = new Map<string, NormalizedValue>(); // key → row (dedupe)

  for (const entry of entries) {
    const definition = byId.get(entry.attributeId);
    if (definition === undefined) {
      throw new ConvexError("One of those attributes isn't assigned to this product.");
    }
    const multi = definition.type === "multi_select";
    if (!multi) {
      if (singleSeen.has(definition._id)) {
        throw new ConvexError(`${definition.name} accepts only one value.`);
      }
      singleSeen.add(definition._id);
    }
    const row = placeValue(definition, entry.value);
    rows.set(valueKey(row), row);
  }
  return [...rows.values()];
}

/** The typed column placement — one error per violated rule, named. */
function placeValue(definition: Definition, value: string | number | boolean): NormalizedValue {
  const name = definition.name;
  switch (definition.type) {
    case "text": {
      if (typeof value !== "string") throw new ConvexError(`${name} expects a text value.`);
      const text = value.trim();
      if (text.length === 0) throw new ConvexError(`${name} can't be empty.`);
      if (text.length > MAX_VALUE_TEXT) {
        throw new ConvexError(`${name} must be ${MAX_VALUE_TEXT} characters or fewer.`);
      }
      return { attributeId: definition._id, valueText: text };
    }
    case "select": {
      if (typeof value !== "string") throw new ConvexError(`${name} expects one of its options.`);
      if (!definition.options.includes(value)) {
        throw new ConvexError(`${name} doesn't include "${value}".`);
      }
      return { attributeId: definition._id, valueText: value };
    }
    case "multi_select": {
      if (typeof value !== "string") throw new ConvexError(`${name} expects one of its options.`);
      if (!definition.options.includes(value)) {
        throw new ConvexError(`${name} doesn't include "${value}".`);
      }
      return { attributeId: definition._id, valueText: value };
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ConvexError(`${name} expects a number value.`);
      }
      return { attributeId: definition._id, valueNumber: value };
    }
    case "boolean": {
      if (typeof value !== "boolean") throw new ConvexError(`${name} expects true or false.`);
      return { attributeId: definition._id, valueBoolean: value };
    }
    case "date": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ConvexError(`${name} expects a date value.`);
      }
      return { attributeId: definition._id, valueDate: value };
    }
  }
}

/** Identity of a value row for diffing (typed column + value, not row id). */
function valueKey(row: NormalizedValue | ValueRow): string {
  if (row.valueText !== undefined) return `${row.attributeId}:text:${row.valueText}`;
  if (row.valueNumber !== undefined) return `${row.attributeId}:number:${row.valueNumber}`;
  if (row.valueBoolean !== undefined) return `${row.attributeId}:boolean:${row.valueBoolean}`;
  if (row.valueDate !== undefined) return `${row.attributeId}:date:${row.valueDate}`;
  /* c8 ignore next */
  return `${row.attributeId}:empty`;
}

/** Validate every field of the shared create/update payload. */
async function normalizeProductInput(
  ctx: MutationCtx,
  args: ProductArgs,
  opts: { selfId?: Id<"products">; currentSlug?: string } = {},
): Promise<NormalizedProduct> {
  const name = normalizeName(args.name);
  const sku = await requireFreeSku(ctx, args.sku, opts.selfId);
  // Omitted slug: create derives from the name; update keeps the stored one
  // (passing it as `provided` round-trips — stored slugs are already
  // slugified). Blank still re-derives, like the category editor.
  const slug = await resolveUniqueSlug(
    productSlugTaken(ctx, opts.selfId),
    name,
    args.slug !== undefined ? args.slug : opts.currentSlug,
    "product",
  );

  let longDescription: string | undefined;
  if (args.longDescription !== undefined && args.longDescription.trim() !== "") {
    if (args.longDescription.length > MAX_LONG_DESCRIPTION) {
      throw new ConvexError(
        `Long description must be ${MAX_LONG_DESCRIPTION} characters or fewer.`,
      );
    }
    longDescription = sanitizeRichText(args.longDescription);
  }

  // UoM (PH1-11): base first, then the conversion chain against it, then
  // the doc-level defaults (which must be reachable through that chain).
  // Each step throws verbatim — same messages as the editor's build gate.
  const unitOfMeasure = normalizeOptionalUoM(args.unitOfMeasure, "Unit of measure");
  const conversionsResult = validateConversions(unitOfMeasure ?? "", args.conversions ?? []);
  if (conversionsResult.error !== null) throw new ConvexError(conversionsResult.error);
  const conversions = conversionsResult.rows;
  const purchase = validateDocUoM(
    "Purchase UoM",
    args.purchaseUoM,
    unitOfMeasure ?? "",
    conversions,
  );
  if (purchase.error !== null) throw new ConvexError(purchase.error);
  const sales = validateDocUoM("Sales UoM", args.salesUoM, unitOfMeasure ?? "", conversions);
  if (sales.error !== null) throw new ConvexError(sales.error);

  return {
    name,
    slug,
    sku,
    barcode: normalizeOptional(args.barcode, MAX_BARCODE, "Barcode"),
    brand: normalizeOptional(args.brand, MAX_BRAND, "Brand"),
    listPrice: normalizePrice(args.listPrice, "List price"),
    costPrice: normalizePrice(args.costPrice, "Cost price"),
    shortDescription: normalizeOptional(
      args.shortDescription,
      MAX_SHORT_DESCRIPTION,
      "Short description",
    ),
    longDescription,
    status: args.status,
    taxCategory: args.taxCategory,
    serialTracked: args.serialTracked,
    lotTracked: args.lotTracked,
    expiryRequired: args.expiryRequired,
    warrantyEligible: args.warrantyEligible,
    allowBackorder: args.allowBackorder,
    warrantyMonths: normalizeCount(args.warrantyMonths, MAX_WARRANTY_MONTHS, "Warranty months"),
    shelfLifeDays: normalizeCount(args.shelfLifeDays, MAX_SHELF_LIFE_DAYS, "Shelf life days"),
    unitOfMeasure,
    conversions,
    purchaseUoM: purchase.code ?? undefined,
    salesUoM: sales.code ?? undefined,
    images: await requireImages(ctx, args.images),
    categoryIds: await requireCategories(ctx, args.categoryIds),
    attributeSetIds: await requireSets(ctx, args.attributeSetIds),
    seoTitle: normalizeOptional(args.seoTitle, MAX_SEO_TITLE, "SEO title"),
    seoDescription: normalizeOptional(args.seoDescription, MAX_SEO_DESCRIPTION, "SEO description"),
  };
}

/** The audited identity/commercial snapshot (descriptions excluded). */
function auditSnapshot(
  source: Product | NormalizedProduct,
  valueCount: number,
): Record<string, unknown> {
  return {
    name: source.name,
    slug: source.slug,
    sku: source.sku,
    status: source.status,
    barcode: source.barcode,
    brand: source.brand,
    listPrice: source.listPrice,
    costPrice: source.costPrice,
    taxCategory: source.taxCategory,
    categoryIds: source.categoryIds,
    attributeSetIds: source.attributeSetIds ?? [],
    unitOfMeasure: source.unitOfMeasure,
    conversions: source.conversions ?? [],
    purchaseUoM: source.purchaseUoM,
    salesUoM: source.salesUoM,
    valueCount,
  };
}

const VALUE_ENTRY = v.object({
  attributeId: v.id("attributeDefinitions"),
  value: v.union(v.string(), v.number(), v.boolean()),
});

/** The product field args create and update share (declared twice for Convex). */
const PRODUCT_ARGS = {
  name: v.string(),
  slug: v.optional(v.string()),
  sku: v.string(),
  barcode: v.optional(v.string()),
  brand: v.optional(v.string()),
  listPrice: v.optional(v.number()),
  costPrice: v.optional(v.number()),
  shortDescription: v.optional(v.string()),
  longDescription: v.optional(v.string()),
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
  taxCategory: v.optional(
    v.union(v.literal("standard"), v.literal("reduced"), v.literal("zero"), v.literal("exempt")),
  ),
  serialTracked: v.boolean(),
  lotTracked: v.boolean(),
  expiryRequired: v.boolean(),
  warrantyEligible: v.boolean(),
  allowBackorder: v.boolean(),
  warrantyMonths: v.optional(v.number()),
  shelfLifeDays: v.optional(v.number()),
  unitOfMeasure: v.optional(v.string()),
  conversions: v.optional(
    v.array(v.object({ unit: v.string(), parent: v.string(), factor: v.number() })),
  ),
  purchaseUoM: v.optional(v.string()),
  salesUoM: v.optional(v.string()),
  images: v.array(v.id("files")),
  categoryIds: v.array(v.id("categories")),
  attributeSetIds: v.array(v.id("attributeSets")),
  seoTitle: v.optional(v.string()),
  seoDescription: v.optional(v.string()),
  attributeValues: v.optional(v.array(VALUE_ENTRY)),
};

/**
 * One product with everything the editor needs: the row, the applicable
 * definitions (category-inherited ∪ its own sets — same resolver the
 * mutations validate against), and its stored values. Returns `null` for a
 * missing OR malformed id (typo'd URLs get "not found", not the error
 * boundary) — errors here are only for permissions.
 */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "view");
    let product: Product | null;
    try {
      product = await ctx.db.get(args.id as Id<"products">);
    } catch {
      return null; // Not a document id at all.
    }
    if (product === null) {
      return null;
    }
    const attributes = await applicableAttributes(ctx, {
      categoryIds: product.categoryIds,
      attributeSetIds: product.attributeSetIds ?? [],
    });
    const values = await ctx.db
      .query("attributeValues")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect();
    return { product, attributes, values };
  },
});

export const create = auditedMutation({
  entity: "products",
  action: "create",
  args: PRODUCT_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "create");
    const product = await normalizeProductInput(ctx, args);

    const desired =
      args.attributeValues === undefined
        ? []
        : normalizeValues(
            args.attributeValues,
            await applicableAttributes(ctx, {
              categoryIds: product.categoryIds,
              attributeSetIds: product.attributeSetIds,
            }),
          );

    const now = Date.now();
    const id = await ctx.db.insert("products", {
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      barcode: product.barcode,
      brand: product.brand,
      listPrice: product.listPrice,
      costPrice: product.costPrice,
      shortDescription: product.shortDescription,
      longDescription: product.longDescription,
      status: product.status,
      taxCategory: product.taxCategory,
      serialTracked: product.serialTracked,
      lotTracked: product.lotTracked,
      expiryRequired: product.expiryRequired,
      warrantyEligible: product.warrantyEligible,
      warrantyMonths: product.warrantyMonths,
      shelfLifeDays: product.shelfLifeDays,
      allowBackorder: product.allowBackorder,
      unitOfMeasure: product.unitOfMeasure,
      conversions: product.conversions,
      purchaseUoM: product.purchaseUoM,
      salesUoM: product.salesUoM,
      images: product.images,
      categoryIds: product.categoryIds,
      attributeSetIds: product.attributeSetIds,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      createdAt: now,
      updatedAt: now,
    });
    // Same-transaction join sync (PH1-05): reads the row we just inserted.
    await syncProductCategoryRows(ctx, id);
    for (const row of desired) {
      await ctx.db.insert("attributeValues", {
        productId: id,
        ...row,
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      result: { id },
      audit: { entityId: id, after: auditSnapshot(product, desired.length) },
    };
  },
});

export const update = auditedMutation({
  entity: "products",
  action: "update",
  args: { id: v.id("products"), ...PRODUCT_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This product no longer exists.");
    }
    const product = await normalizeProductInput(ctx, args, {
      selfId: args.id,
      currentSlug: row.slug,
    });

    const sameList = <T>(a: T[], b: T[]) =>
      a.length === b.length && a.every((item, index) => item === b[index]);
    // Conversions diff as an ORDER-INSENSITIVE key set: rows arrive
    // normalized (codes lowercase, one row per unit), so re-saving with the
    // rows in a different order is still a no-op — cosmetic shuffles never
    // produce an audit entry (PH0-30 autosave pattern).
    const conversionKeys = (rows: Conversion[]) =>
      rows.map((row) => `${row.unit}=${row.factor}x${row.parent}`).sort();
    const changed =
      product.name !== row.name ||
      product.slug !== row.slug ||
      product.sku !== row.sku ||
      product.barcode !== row.barcode ||
      product.brand !== row.brand ||
      product.listPrice !== row.listPrice ||
      product.costPrice !== row.costPrice ||
      product.shortDescription !== row.shortDescription ||
      product.longDescription !== row.longDescription ||
      product.status !== row.status ||
      product.taxCategory !== row.taxCategory ||
      product.serialTracked !== (row.serialTracked ?? false) ||
      product.lotTracked !== (row.lotTracked ?? false) ||
      product.expiryRequired !== (row.expiryRequired ?? false) ||
      product.warrantyEligible !== (row.warrantyEligible ?? false) ||
      product.allowBackorder !== (row.allowBackorder ?? false) ||
      product.warrantyMonths !== row.warrantyMonths ||
      product.shelfLifeDays !== row.shelfLifeDays ||
      product.unitOfMeasure !== row.unitOfMeasure ||
      product.purchaseUoM !== row.purchaseUoM ||
      product.salesUoM !== row.salesUoM ||
      !sameList(conversionKeys(product.conversions ?? []), conversionKeys(row.conversions ?? [])) ||
      product.seoTitle !== row.seoTitle ||
      product.seoDescription !== row.seoDescription ||
      !sameList(product.images, row.images ?? []) ||
      !sameList(product.categoryIds, row.categoryIds) ||
      !sameList(product.attributeSetIds, row.attributeSetIds ?? []);

    // Values: present arg = full replace (diffed), absent = untouched.
    const existing = await ctx.db
      .query("attributeValues")
      .withIndex("by_product", (q) => q.eq("productId", args.id))
      .collect();
    let desired: NormalizedValue[] | null = null;
    let toInsert: NormalizedValue[] = [];
    let toDelete: ValueRow[] = [];
    if (args.attributeValues !== undefined) {
      desired = normalizeValues(
        args.attributeValues,
        await applicableAttributes(ctx, {
          categoryIds: product.categoryIds,
          attributeSetIds: product.attributeSetIds,
        }),
      );
      const existingByKey = new Map(existing.map((value) => [valueKey(value), value]));
      const desiredByKey = new Map(desired.map((value) => [valueKey(value), value]));
      toInsert = desired.filter((value) => !existingByKey.has(valueKey(value)));
      toDelete = existing.filter((value) => !desiredByKey.has(valueKey(value)));
    }
    const valueCount = desired === null ? existing.length : desired.length;

    if (!changed && toInsert.length === 0 && toDelete.length === 0) {
      return { result: undefined, audit: undefined };
    }

    await ctx.db.patch(args.id, {
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      barcode: product.barcode,
      brand: product.brand,
      listPrice: product.listPrice,
      costPrice: product.costPrice,
      shortDescription: product.shortDescription,
      longDescription: product.longDescription,
      status: product.status,
      taxCategory: product.taxCategory,
      serialTracked: product.serialTracked,
      lotTracked: product.lotTracked,
      expiryRequired: product.expiryRequired,
      warrantyEligible: product.warrantyEligible,
      warrantyMonths: product.warrantyMonths,
      shelfLifeDays: product.shelfLifeDays,
      allowBackorder: product.allowBackorder,
      unitOfMeasure: product.unitOfMeasure,
      conversions: product.conversions,
      purchaseUoM: product.purchaseUoM,
      salesUoM: product.salesUoM,
      images: product.images,
      categoryIds: product.categoryIds,
      attributeSetIds: product.attributeSetIds,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      updatedAt: Date.now(),
    });
    // Same-transaction join sync on EVERY categoryIds write (PH1-05) — a
    // full reconcile, so it also heals any historical drift.
    await syncProductCategoryRows(ctx, args.id);
    const now = Date.now();
    for (const value of toInsert) {
      await ctx.db.insert("attributeValues", {
        productId: args.id,
        ...value,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const value of toDelete) {
      await ctx.db.delete(value._id);
    }
    return {
      result: undefined,
      audit: {
        entityId: args.id,
        before: auditSnapshot(row, existing.length),
        after: auditSnapshot(product, valueCount),
      },
    };
  },
});

export const remove = auditedMutation({
  entity: "products",
  action: "delete",
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "delete");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This product no longer exists.");
    }
    // The inverse of the PH1-06 category guard / PH1-04 set guard: clean the
    // join rows (PH1-05), value rows (PH1-05 tables), and variant rows
    // (PH1-09) so no ghost reference outlives the product. (Future referrers
    // — stock, serials, work orders — block this delete instead; no such
    // table exists yet.)
    const values = await ctx.db
      .query("attributeValues")
      .withIndex("by_product", (q) => q.eq("productId", args.id))
      .collect();
    for (const value of values) {
      await ctx.db.delete(value._id);
    }
    const variants = await ctx.db
      .query("variants")
      .withIndex("by_product", (q) => q.eq("productId", args.id))
      .collect();
    for (const variant of variants) {
      await ctx.db.delete(variant._id);
    }
    const joins = await ctx.db
      .query("productCategories")
      .withIndex("by_product", (q) => q.eq("productId", args.id))
      .collect();
    for (const join of joins) {
      await ctx.db.delete(join._id);
    }
    await ctx.db.delete(args.id);
    return {
      result: undefined,
      audit: { entityId: args.id, before: auditSnapshot(row, values.length) },
    };
  },
});

/* ------------------------------------------------------------ list (PH1-08) */

/** The flag columns the list can filter on (AND semantics: all selected must hold). */
type FlagKey =
  "serialTracked" | "lotTracked" | "expiryRequired" | "warrantyEligible" | "allowBackorder";

/** Sortable column keys — the DataTable's `sortable` columns map 1:1. */
type SortKey = "name" | "sku" | "brand" | "status" | "updatedAt";

type ListSort = { key: SortKey; direction: "asc" | "desc" };

/** Case-insensitive text compare that treats missing optionals as empty. */
function compareText(a: string | undefined, b: string | undefined): number {
  const left = (a ?? "").toLowerCase();
  const right = (b ?? "").toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The product list behind the PH1-08 admin table: filters (category, brand,
 * status, tracking flags), search across name/SKU/barcode, column sort, and
 * a bounded page.
 *
 * Shape notes:
 * - One full scan, filtered and sorted in memory — the same "bounded
 *   admin read" rationale as `categories.stats` (PH1-02) and the audit
 *   filters (PH0-26): the single-company products table is small, and
 *   search is a SUBSTRING match over three fields, which no index serves
 *   (a Convex search index exposes one searchable field — name/SKU/barcode
 *   would need three queries merged; revisit if catalogs ever outgrow
 *   this).
 * - Category membership reads `categoryIds` (the source of truth —
 *   PH1-05), not the `productCategories` join: we already hold every row,
 *   so the join would only matter for index-driven scans, and reading the
 *   truth means a stale join can't hide a product from staff.
 * - Default order is newest first (`_creationTime` desc); ties break on
 *   `_id` ascending so pagination never reshuffles rows that share a sort
 *   key (bulk edits stamp identical `updatedAt` values).
 * - `limit` clamps to 1..200 (default 50) so a client can't pull the whole
 *   catalog in one response.
 */
export const list = query({
  args: {
    search: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    brand: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"), v.literal("archived"))),
    flags: v.optional(
      v.array(
        v.union(
          v.literal("serialTracked"),
          v.literal("lotTracked"),
          v.literal("expiryRequired"),
          v.literal("warrantyEligible"),
          v.literal("allowBackorder"),
        ),
      ),
    ),
    sort: v.optional(
      v.object({
        key: v.union(
          v.literal("name"),
          v.literal("sku"),
          v.literal("brand"),
          v.literal("status"),
          v.literal("updatedAt"),
        ),
        direction: v.union(v.literal("asc"), v.literal("desc")),
      }),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "view");

    const needle = (args.search ?? "").trim().toLowerCase();
    const flags: FlagKey[] = args.flags ?? [];
    const sort: ListSort | undefined = args.sort;
    const rows = await ctx.db.query("products").collect();
    const matches = rows.filter(
      (row) =>
        (args.status === undefined || row.status === args.status) &&
        (args.brand === undefined || row.brand === args.brand) &&
        (args.categoryId === undefined || row.categoryIds.includes(args.categoryId)) &&
        flags.every((flag) => row[flag] === true) &&
        (needle === "" ||
          [row.name, row.sku, row.barcode ?? ""].some((field) =>
            field.toLowerCase().includes(needle),
          )),
    );

    const direction = sort === undefined || sort.direction === "desc" ? -1 : 1;
    matches.sort((a, b) => {
      const primary =
        sort === undefined
          ? a._creationTime - b._creationTime
          : sort.key === "updatedAt"
            ? a.updatedAt - b.updatedAt
            : compareText(a[sort.key], b[sort.key]);
      if (primary !== 0) return primary * direction;
      return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
    });

    const requested = args.limit ?? 50;
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 200)
      : 50;
    return {
      rows: matches.slice(0, limit),
      total: matches.length,
      hasMore: matches.length > limit,
    };
  },
});

/**
 * Distinct non-empty brands for the list's brand filter — feeds the
 * dropdown without a second round of state. Full scan by design (see
 * `list`): brands are stored on the product row itself, so there is no
 * index to read them from.
 */
export const brands = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog", "view");
    const rows = await ctx.db.query("products").collect();
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.brand !== undefined && row.brand !== "") seen.add(row.brand);
    }
    return [...seen].sort((a, b) => compareText(a, b) || (a < b ? -1 : 1));
  },
});

/**
 * Bulk status change for the PH1-08 table (Activate / Set draft / Archive
 * on a selection).
 *
 * - `catalog.edit` (same ladder as `products.update`).
 * - Every id must resolve BEFORE anything is patched — a vanished product
 *   fails the whole batch, so a selection can never half-apply.
 * - One audit entry per CHANGED product (`auditedMutation`'s single-entry
 *   shape can't name a batch): rows already in the target status record
 *   nothing and keep their `updatedAt` (PH0-30 no-op rule). The wrapper's
 *   own entry is skipped (`audit: undefined`) because the per-row entries
 *   ARE the trail.
 * - Duplicate ids dedupe first, so a row can't be double-patched or
 *   double-audited.
 */
export const bulkStatus = auditedMutation({
  entity: "products",
  action: "update",
  args: {
    ids: v.array(v.id("products")),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const ids = [...new Set(args.ids)];
    if (ids.length === 0) {
      return { result: { updated: 0, unchanged: 0 }, audit: undefined };
    }
    const rows: Product[] = [];
    for (const id of ids) {
      const row = await ctx.db.get(id);
      if (row === null) {
        throw new ConvexError("One of those products no longer exists.");
      }
      rows.push(row);
    }

    const now = Date.now();
    let updated = 0;
    let unchanged = 0;
    for (const row of rows) {
      if (row.status === args.status) {
        unchanged += 1;
        continue;
      }
      await ctx.db.patch(row._id, { status: args.status, updatedAt: now });
      await appendAudit(ctx, {
        entity: "products",
        action: "update",
        entityId: row._id,
        before: { status: row.status },
        after: { status: args.status },
      });
      updated += 1;
    }
    return { result: { updated, unchanged }, audit: undefined };
  },
});
