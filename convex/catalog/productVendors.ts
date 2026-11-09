import { ConvexError, v } from "convex/values";
import { normalizeVendorSku, vendorSkuError } from "../../lib/productVendors";
import { appendAudit, auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Product↔vendor links (PH2-04). Catalog editors maintain the link
 * and the supplier's SKU. A goods receipt that names the vendor writes
 * the last purchase price; that field is not an argument here. The
 * first link is preferred. Removing the preferred one promotes the
 * oldest remaining link. A new link to an inactive vendor is refused.
 * One already on file may stay.
 */

type ReadCtx = QueryCtx | MutationCtx;

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function linksOf(ctx: ReadCtx, productId: Id<"products">) {
  return await ctx.db
    .query("productVendors")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
}

function oldest(rows: Doc<"productVendors">[]) {
  return [...rows].sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id))[0];
}

function snapshotOf(row: Doc<"productVendors">) {
  return {
    productId: row.productId,
    vendorId: row.vendorId,
    ...(row.vendorSku !== undefined ? { vendorSku: row.vendorSku } : {}),
    preferred: row.preferred,
    ...(row.lastPurchasePrice !== undefined ? { lastPurchasePrice: row.lastPurchasePrice } : {}),
    ...(row.lastPurchaseAt !== undefined ? { lastPurchaseAt: row.lastPurchaseAt } : {}),
  };
}

async function clearPreferred(
  ctx: MutationCtx,
  productId: Id<"products">,
  keep: Id<"productVendors">,
) {
  const now = Date.now();
  for (const row of await linksOf(ctx, productId)) {
    if (row._id !== keep && row.preferred) {
      await ctx.db.patch(row._id, { preferred: false, updatedAt: now });
    }
  }
}

function viewOf(
  row: Doc<"productVendors">,
  vendor: { code: string; name: string; active: boolean } | null,
  product: { name: string; sku: string } | null,
) {
  return {
    _id: row._id,
    productId: row.productId,
    productName: product?.name ?? null,
    productSku: product?.sku ?? null,
    vendorId: row.vendorId,
    vendorCode: vendor?.code ?? null,
    vendorName: vendor?.name ?? null,
    vendorActive: vendor?.active ?? false,
    vendorSku: row.vendorSku ?? null,
    preferred: row.preferred,
    lastPurchasePrice: row.lastPurchasePrice ?? null,
    lastPurchaseAt: row.lastPurchaseAt ?? null,
  };
}

export const listForProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "view");
    const rows = await linksOf(ctx, args.productId);
    const listed = [];
    for (const row of rows) {
      const vendor = await ctx.db.get(row.vendorId);
      listed.push(
        viewOf(
          row,
          vendor === null ? null : { code: vendor.code, name: vendor.name, active: vendor.active },
          null,
        ),
      );
    }
    return listed.sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        (a.vendorName ?? "").localeCompare(b.vendorName ?? "") ||
        a._id.localeCompare(b._id),
    );
  },
});

export const listForVendor = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "view");
    const rows = await ctx.db
      .query("productVendors")
      .withIndex("by_vendor", (q) => q.eq("vendorId", args.vendorId))
      .collect();
    const listed = [];
    for (const row of rows) {
      const product = await ctx.db.get(row.productId);
      const vendor = await ctx.db.get(row.vendorId);
      listed.push(
        viewOf(
          row,
          vendor === null ? null : { code: vendor.code, name: vendor.name, active: vendor.active },
          product === null ? null : { name: product.name, sku: product.sku },
        ),
      );
    }
    return listed.sort(
      (a, b) =>
        (a.productName ?? "").localeCompare(b.productName ?? "") || a._id.localeCompare(b._id),
    );
  },
});

export const link = auditedMutation({
  entity: "productVendors",
  action: "create",
  args: {
    productId: v.id("products"),
    vendorId: v.id("vendors"),
    vendorSku: v.union(v.string(), v.null()),
    preferred: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const product = await ctx.db.get(args.productId);
    if (product === null) throw new ConvexError("Product not found.");
    const vendor = await ctx.db.get(args.vendorId);
    if (vendor === null) throw new ConvexError("Vendor not found.");
    if (!vendor.active) throw new ConvexError("That vendor is inactive.");
    const duplicate = await ctx.db
      .query("productVendors")
      .withIndex("by_product_vendor", (q) =>
        q.eq("productId", args.productId).eq("vendorId", args.vendorId),
      )
      .unique();
    if (duplicate !== null) {
      throw new ConvexError("That vendor is already linked to this product.");
    }
    throwIf(vendorSkuError(args.vendorSku));
    const sku = normalizeVendorSku(args.vendorSku);
    const others = await linksOf(ctx, args.productId);
    const preferred = args.preferred || others.length === 0;
    const now = Date.now();
    const id = await ctx.db.insert("productVendors", {
      productId: args.productId,
      vendorId: args.vendorId,
      ...(sku !== undefined ? { vendorSku: sku } : {}),
      preferred,
      createdAt: now,
      updatedAt: now,
    });
    if (preferred) await clearPreferred(ctx, args.productId, id);
    const row = await ctx.db.get(id);
    if (row === null) throw new ConvexError("Vendor link not found.");
    return { result: id, audit: { entityId: id, after: snapshotOf(row) } };
  },
});

export const update = auditedMutation({
  entity: "productVendors",
  action: "update",
  args: {
    linkId: v.id("productVendors"),
    vendorSku: v.union(v.string(), v.null()),
    preferred: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const existing = await ctx.db.get(args.linkId);
    if (existing === null) throw new ConvexError("Vendor link not found.");
    throwIf(vendorSkuError(args.vendorSku));
    const sku = normalizeVendorSku(args.vendorSku);
    const others = (await linksOf(ctx, existing.productId)).filter(
      (row) => row._id !== existing._id,
    );
    let preferred = args.preferred;
    if (preferred) {
      await clearPreferred(ctx, existing.productId, existing._id);
    } else if (existing.preferred) {
      const next = oldest(others);
      if (next === undefined) {
        preferred = true;
      } else {
        await ctx.db.patch(next._id, { preferred: true, updatedAt: Date.now() });
      }
    }
    const now = Date.now();
    await ctx.db.replace(existing._id, {
      productId: existing.productId,
      vendorId: existing.vendorId,
      ...(sku !== undefined ? { vendorSku: sku } : {}),
      preferred,
      ...(existing.lastPurchasePrice !== undefined
        ? { lastPurchasePrice: existing.lastPurchasePrice }
        : {}),
      ...(existing.lastPurchaseAt !== undefined ? { lastPurchaseAt: existing.lastPurchaseAt } : {}),
      createdAt: existing.createdAt,
      updatedAt: now,
    });
    const row = await ctx.db.get(existing._id);
    if (row === null) throw new ConvexError("Vendor link not found.");
    return {
      result: existing._id,
      audit: { entityId: existing._id, before: snapshotOf(existing), after: snapshotOf(row) },
    };
  },
});

export const remove = auditedMutation({
  entity: "productVendors",
  action: "delete",
  args: { linkId: v.id("productVendors") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const existing = await ctx.db.get(args.linkId);
    if (existing === null) throw new ConvexError("Vendor link not found.");
    await ctx.db.delete(existing._id);
    if (existing.preferred) {
      const next = oldest(await linksOf(ctx, existing.productId));
      if (next !== undefined) {
        await ctx.db.patch(next._id, { preferred: true, updatedAt: Date.now() });
      }
    }
    return { result: null, audit: { entityId: existing._id, before: snapshotOf(existing) } };
  },
});

/**
 * Called from a posted goods receipt. Lines without a unit cost leave
 * the price alone. A product with no link to this vendor is skipped —
 * receiving does not create the link. The last costed line for a
 * product wins. One audit row per link the price touches.
 */
export async function applyLastPurchasePrices(
  ctx: MutationCtx,
  vendorId: Id<"vendors">,
  lines: { productId: Id<"products">; unitCost?: number }[],
) {
  const costs = new Map<Id<"products">, number>();
  for (const line of lines) {
    if (line.unitCost !== undefined) costs.set(line.productId, line.unitCost);
  }
  const now = Date.now();
  for (const [productId, unitCost] of costs) {
    const link = await ctx.db
      .query("productVendors")
      .withIndex("by_product_vendor", (q) => q.eq("productId", productId).eq("vendorId", vendorId))
      .unique();
    if (link === null) continue;
    const before = snapshotOf(link);
    await ctx.db.patch(link._id, {
      lastPurchasePrice: unitCost,
      lastPurchaseAt: now,
      updatedAt: now,
    });
    const after = await ctx.db.get(link._id);
    if (after === null) continue;
    await appendAudit(ctx, {
      entity: "productVendors",
      action: "purchase",
      entityId: link._id,
      before,
      after: snapshotOf(after),
    });
  }
}
