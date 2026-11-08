import { ConvexError, v } from "convex/values";
import { reorderQtyError } from "../../lib/reorder";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Reorder points (PH1-24). `set` upserts the product-wide point, or
 * the point at one warehouse. The warehouse point wins there. `clear`
 * removes that one row. The daily low-stock job reads the table.
 */

async function requireProduct(ctx: QueryCtx | MutationCtx, productId: Id<"products">) {
  const product = await ctx.db.get(productId);
  if (product === null) throw new ConvexError("Product not found.");
  return product;
}

async function requireActiveWarehouse(ctx: QueryCtx | MutationCtx, warehouseId: Id<"warehouses">) {
  const warehouse = await ctx.db.get(warehouseId);
  if (warehouse === null) throw new ConvexError("Warehouse not found.");
  if (!warehouse.active) throw new ConvexError("That warehouse is inactive.");
  return warehouse;
}

async function pointFor(
  ctx: QueryCtx | MutationCtx,
  productId: Id<"products">,
  warehouseId: Id<"warehouses"> | undefined,
) {
  const rows = await ctx.db
    .query("reorderPoints")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  return rows.find((row) => row.warehouseId === warehouseId) ?? null;
}

export const forProduct = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    const rows = await ctx.db
      .query("reorderPoints")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();
    return rows.map((row) => ({
      warehouseId: row.warehouseId,
      qty: row.qty,
    }));
  },
});

export const set = auditedMutation({
  entity: "reorderPoints",
  action: "update",
  args: {
    productId: v.id("products"),
    warehouseId: v.optional(v.id("warehouses")),
    qty: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "edit");
    const qtyError = reorderQtyError(args.qty);
    if (qtyError !== null) throw new ConvexError(qtyError);
    await requireProduct(ctx, args.productId);
    if (args.warehouseId !== undefined) await requireActiveWarehouse(ctx, args.warehouseId);

    const existing = await pointFor(ctx, args.productId, args.warehouseId);
    const now = Date.now();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { qty: args.qty, updatedAt: now });
      return {
        result: existing._id,
        audit: {
          entityId: existing._id,
          before: { qty: existing.qty },
          after: { qty: args.qty },
        },
      };
    }

    const id = await ctx.db.insert("reorderPoints", {
      productId: args.productId,
      ...(args.warehouseId !== undefined ? { warehouseId: args.warehouseId } : {}),
      qty: args.qty,
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: id,
      audit: {
        entityId: id,
        after: {
          productId: args.productId,
          warehouseId: args.warehouseId,
          qty: args.qty,
        },
      },
    };
  },
});

export const clear = auditedMutation({
  entity: "reorderPoints",
  action: "delete",
  args: {
    productId: v.id("products"),
    warehouseId: v.optional(v.id("warehouses")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "edit");
    await requireProduct(ctx, args.productId);
    const existing = await pointFor(ctx, args.productId, args.warehouseId);
    if (existing === null) throw new ConvexError("No reorder point is set for that product.");
    await ctx.db.delete(existing._id);
    return {
      result: null,
      audit: {
        entityId: existing._id,
        before: {
          productId: existing.productId,
          warehouseId: existing.warehouseId,
          qty: existing.qty,
        },
      },
    };
  },
});
