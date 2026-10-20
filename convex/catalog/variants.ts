import { ConvexError, v } from "convex/values";
import { SKU_MAX_LENGTH, validateSku } from "../../lib/sku";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { applicableAttributes } from "./attributes";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Product variants (PH1-09): the option matrix behind "Color × Config".
 * `sync` reconciles a product's whole matrix from its axes (set-inherited
 * SELECT attributes the merchant picks on the Variants page), `update`
 * edits one row's SKU/barcode/price/flags, `remove` drops one row, `list`
 * feeds the page.
 *
 * Rules enforced HERE (never only in UI — docs/permissions.md rule 1):
 * - Axes must be APPLICABLE to the product (same resolver the editor
 *   renders from — `applicableAttributes`), `select`-typed, with at least
 *   one option; the matrix is the cartesian product of their options in
 *   applicable order, capped at MAX_VARIANTS (a 30×30 typo shouldn't
 *   insert 900 rows).
 * - Sync PRESERVES a combination that still exists (keyed canonically, so
 *   axis order doesn't matter) with all its per-variant edits, inserts new
 *   combinations with product defaults, and deletes orphans (axes/options
 *   shrank). Derived SKUs are `<productSku>-TOKEN-TOKEN` in axis order —
 *   generation-time only; a typed SKU is never rewritten (PH1-07's rule) —
 *   and any collision (in-batch, with another product/variant, even with
 *   the product itself) fails the WHOLE reconcile with the offending SKU
 *   named, before any write.
 * - Variant SKU: `validateSku` verbatim + org-wide uniqueness SHARED WITH
 *   PRODUCTS — a scan must resolve to exactly one thing, so `by_sku`
 *   probes both tables (the product's own parent SKU included).
 * - Barcode optional (same trim/64-cap as products, no uniqueness — the
 *   PH1-06 call); price must be zero-or-more; the five track flags are
 *   full-form booleans (legacy rows read as `false`).
 *
 * Permissions: read → catalog.view; every write → catalog.edit. Variant
 * rows are MATRIX ENTRIES of a product document (not standalone master
 * records), so row-level changes ride the edit ladder like `sync` itself —
 * `catalog.delete` keeps guarding whole products.
 *
 * Audit: `sync` returns ONE product-level entry (a matrix is a product
 * operation) whose after-snapshot names every removed row (SKU +
 * coordinates — deletions must stay reconstructable); `update`/`remove`
 * snapshot the row like other editors; no-op saves record nothing
 * (PH0-30).
 */

/** Cartesian-product cap — an axes typo shouldn't insert hundreds of rows. */
const MAX_VARIANTS = 200;
/** Same barcode cap as the product editor (PH1-07). */
const MAX_BARCODE = 64;

/** The five track flags `variants:update` takes full-form (schema: optional). */
type TrackFlag =
  "serialTracked" | "lotTracked" | "expiryRequired" | "warrantyEligible" | "allowBackorder";

type Variant = Doc<"variants">;
type OptionPin = { attributeId: Id<"attributeDefinitions">; value: string };

/** Canonical identity of a combination — axis-order independent, so a
 * reordered axis list doesn't orphan every row. */
function combinationKey(optionValues: OptionPin[]): string {
  return [...optionValues]
    .sort((a, b) =>
      a.attributeId !== b.attributeId
        ? a.attributeId < b.attributeId
          ? -1
          : 1
        : a.value < b.value
          ? -1
          : a.value > b.value
            ? 1
            : 0,
    )
    .map((entry) => `${entry.attributeId}\u0000${entry.value}`)
    .join("\u0001");
}

/** One option label → a SKU token: uppercase, charset-safe (lib/sku), ≤ 12
 * chars, no separator edges (the WHOLE sku must start/end alnum). */
function skuToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9._/-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 12)
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");
}

/**
 * Initial SKU for a generated variant: `<productSku>-<TOKEN>-<TOKEN>` in
 * axis order. The suffix is the distinguishing half, so the 32-char cap
 * (lib/sku) trims the PRODUCT part first. Uniqueness is still probed at
 * write — a normalization clash fails loudly instead of silently renaming.
 */
function deriveVariantSku(baseSku: string, values: string[]): string {
  const suffix = values
    .map(skuToken)
    .filter((token) => token.length > 0)
    .join("-");
  let sku = suffix.length > 0 ? `${baseSku}-${suffix}` : baseSku;
  if (sku.length > SKU_MAX_LENGTH) {
    const room = SKU_MAX_LENGTH - suffix.length - 1;
    sku = room >= 1 ? `${baseSku.slice(0, room)}-${suffix}` : sku.slice(0, SKU_MAX_LENGTH);
  }
  return sku.replace(/[^A-Z0-9]+$/g, "");
}

function normalizeBarcode(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_BARCODE) {
    throw new ConvexError(`Barcode must be ${MAX_BARCODE} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Org-wide SKU conflict — products AND variants share one scan namespace.
 * Returns the conflicting row's kind/id, or null. `ignoreVariantId` lets
 * `update` probe against itself.
 */
async function skuConflict(
  ctx: QueryCtx | MutationCtx,
  sku: string,
  ignoreVariantId?: Id<"variants">,
): Promise<{ kind: "product" | "variant"; id: string } | null> {
  const product = await ctx.db
    .query("products")
    .withIndex("by_sku", (q) => q.eq("sku", sku))
    .first();
  if (product !== null) return { kind: "product", id: product._id };
  const variant = await ctx.db
    .query("variants")
    .withIndex("by_sku", (q) => q.eq("sku", sku))
    .first();
  if (variant !== null && variant._id !== ignoreVariantId) {
    return { kind: "variant", id: variant._id };
  }
  return null;
}

/** Variants of one product, in matrix (creation) order. */
async function variantsFor(
  ctx: QueryCtx | MutationCtx,
  productId: Id<"products">,
): Promise<Variant[]> {
  return await ctx.db
    .query("variants")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
}

/** The variant row's five flags as explicit booleans (legacy rows → false). */
function flagsOf(row: {
  serialTracked?: boolean;
  lotTracked?: boolean;
  expiryRequired?: boolean;
  warrantyEligible?: boolean;
  allowBackorder?: boolean;
}): Record<TrackFlag, boolean> {
  return {
    serialTracked: row.serialTracked ?? false,
    lotTracked: row.lotTracked ?? false,
    expiryRequired: row.expiryRequired ?? false,
    warrantyEligible: row.warrantyEligible ?? false,
    allowBackorder: row.allowBackorder ?? false,
  };
}

/** The matrix rows for a product — the Variants page's table. */
export const list = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "view");
    if ((await ctx.db.get(args.productId)) === null) {
      throw new ConvexError("This product no longer exists.");
    }
    return await variantsFor(ctx, args.productId);
  },
});

/**
 * Reconcile a product's matrix from its axes (full-form: `axisIds` replaces
 * the stored axes). See the module comment for the rules; the whole
 * operation is one transaction — validation, derived-SKU probes, inserts,
 * and orphan deletes either all land or none.
 */
export const sync = auditedMutation({
  entity: "products",
  action: "update",
  args: { id: v.id("products"), axisIds: v.array(v.id("attributeDefinitions")) },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const product = await ctx.db.get(args.id);
    if (product === null) {
      throw new ConvexError("This product no longer exists.");
    }

    // Validate the picks against the SAME applicability the editor renders
    // from (a category move between saves can't strand an axis), then walk
    // them in APPLICABLE order so matrix order matches the spec editor.
    const applicable = await applicableAttributes(ctx, {
      categoryIds: product.categoryIds,
      attributeSetIds: product.attributeSetIds ?? [],
    });
    const picked = new Set(args.axisIds);
    const axes = applicable.filter((row) => picked.has(row._id));
    if (axes.length !== picked.size) {
      throw new ConvexError("One of those attributes isn't assigned to this product.");
    }
    for (const axis of axes) {
      if (axis.type !== "select") {
        throw new ConvexError(
          `"${axis.name}" isn't a Select attribute — only Select attributes can be variant axes.`,
        );
      }
      if (axis.options.length === 0) {
        throw new ConvexError(
          `"${axis.name}" has no options yet — add options before making it a variant axis.`,
        );
      }
    }

    // The cartesian product, capped BEFORE any write.
    const count = axes.reduce((total, axis) => total * axis.options.length, 1);
    if (count > MAX_VARIANTS) {
      throw new ConvexError(
        `That would create ${count} variants — the limit is ${MAX_VARIANTS}. Remove an axis or some options.`,
      );
    }
    let combos: OptionPin[][] = [[]];
    for (const axis of axes) {
      combos = combos.flatMap((prefix) =>
        axis.options.map((value) => [...prefix, { attributeId: axis._id, value }]),
      );
    }
    const wanted = new Map(
      (axes.length === 0 ? [] : combos).map((values) => [combinationKey(values), values]),
    );

    const existing = await variantsFor(ctx, args.id);
    const byKey = new Map(existing.map((row) => [combinationKey(row.optionValues), row]));
    const orphans = existing.filter((row) => !wanted.has(combinationKey(row.optionValues)));
    // An orphan's derived SKU is free real estate — this transaction is
    // about to delete it.
    const doomed = new Set<string>(orphans.map((row) => row._id));

    const inserts: { values: OptionPin[]; sku: string }[] = [];
    const skusInBatch = new Set<string>();
    for (const [key, values] of wanted) {
      if (byKey.has(key)) continue; // preserved with its per-variant edits
      const sku = deriveVariantSku(
        product.sku,
        values.map((entry) => entry.value),
      );
      const conflict = await skuConflict(ctx, sku);
      const taken =
        skusInBatch.has(sku) ||
        (conflict !== null && !(conflict.kind === "variant" && doomed.has(conflict.id)));
      if (taken) {
        throw new ConvexError(
          `Generated SKU "${sku}" is already in use — rename the product SKU or the options, then regenerate.`,
        );
      }
      skusInBatch.add(sku);
      inserts.push({ values, sku });
    }

    const now = Date.now();
    for (const orphan of orphans) {
      await ctx.db.delete(orphan._id);
    }
    for (const insert of inserts) {
      await ctx.db.insert("variants", {
        productId: args.id,
        optionValues: insert.values,
        sku: insert.sku,
        ...flagsOf(product),
        createdAt: now,
        updatedAt: now,
      });
    }

    const axisIdsNext = axes.map((axis) => axis._id);
    const axesChanged =
      product.variantAxisIds === undefined
        ? axisIdsNext.length > 0
        : product.variantAxisIds.length !== axisIdsNext.length ||
          product.variantAxisIds.some((id, index) => id !== axisIdsNext[index]);
    if (axesChanged) {
      await ctx.db.patch(args.id, { variantAxisIds: axisIdsNext, updatedAt: now });
    }

    const total = existing.length - orphans.length + inserts.length;
    const result = { created: inserts.length, removed: orphans.length, total };
    if (!axesChanged && orphans.length === 0 && inserts.length === 0) {
      return { result, audit: undefined }; // nothing happened (PH0-30)
    }
    return {
      result,
      audit: {
        entityId: args.id,
        before: { variantAxisIds: product.variantAxisIds ?? [], variantCount: existing.length },
        after: {
          variantAxisIds: axisIdsNext,
          variantCount: total,
          created: inserts.length,
          // Deletions stay reconstructable: identity of every removed row.
          removed: orphans.map((row) => ({ sku: row.sku, optionValues: row.optionValues })),
        },
      },
    };
  },
});

/** Full-form edit of one row — SKU/barcode/price/flags, never the pins. */
export const update = auditedMutation({
  entity: "variants",
  action: "update",
  args: {
    id: v.id("variants"),
    sku: v.string(),
    barcode: v.string(),
    listPrice: v.nullable(v.number()),
    serialTracked: v.boolean(),
    lotTracked: v.boolean(),
    expiryRequired: v.boolean(),
    warrantyEligible: v.boolean(),
    allowBackorder: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This variant no longer exists.");
    }

    const { sku, error } = validateSku(args.sku);
    if (error !== null) {
      throw new ConvexError(error); // verbatim, like the product editor
    }
    const conflict = await skuConflict(ctx, sku, args.id);
    if (conflict?.kind === "product") {
      throw new ConvexError(`A product with SKU "${sku}" already exists.`);
    }
    if (conflict?.kind === "variant") {
      throw new ConvexError(`A variant with SKU "${sku}" already exists.`);
    }

    const barcode = normalizeBarcode(args.barcode);
    if (args.listPrice !== null && (!Number.isFinite(args.listPrice) || args.listPrice < 0)) {
      throw new ConvexError("Variant price must be zero or more.");
    }
    const listPrice = args.listPrice === null ? undefined : args.listPrice;

    const before = {
      sku: row.sku,
      barcode: row.barcode,
      listPrice: row.listPrice,
      ...flagsOf(row),
    };
    const after = {
      sku,
      barcode,
      listPrice,
      serialTracked: args.serialTracked,
      lotTracked: args.lotTracked,
      expiryRequired: args.expiryRequired,
      warrantyEligible: args.warrantyEligible,
      allowBackorder: args.allowBackorder,
    };
    const changed = (Object.keys(after) as (keyof typeof after)[]).some(
      (key) => before[key] !== after[key],
    );
    if (!changed) {
      return { result: undefined, audit: undefined };
    }
    await ctx.db.patch(args.id, { ...after, updatedAt: Date.now() });
    return { result: undefined, audit: { entityId: args.id, before, after } };
  },
});

/**
 * Drop one matrix row (reaching for a stray combination without
 * regenerating). CATALOG_EDIT — see the permission note in the module
 * comment; `variants:sync` deletes orphans under the same ladder.
 */
export const remove = auditedMutation({
  entity: "variants",
  action: "delete",
  args: { id: v.id("variants") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This variant no longer exists.");
    }
    await ctx.db.delete(args.id);
    return {
      result: undefined,
      audit: {
        entityId: args.id,
        before: { productId: row.productId, sku: row.sku, optionValues: row.optionValues },
      },
    };
  },
});
