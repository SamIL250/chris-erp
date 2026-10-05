import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * `productCategories` join maintenance (PH1-05): one row per
 * (product, category) pair, mirroring `products.categoryIds` — the source
 * of truth. Convex can't index "array contains" (an index on an array
 * field sorts by the whole array value), so this join is what makes
 * "products in this category" an indexed read (`by_category`).
 *
 * Call `syncProductCategoryRows(ctx, productId)` after ANY insert/patch
 * that touches `categoryIds` (PH1-07's product editor) — inside the same
 * mutation, so the pair of writes is transactional (Convex's documented
 * join-table pattern). Full reconcile: inserts the missing rows, deletes
 * the orphans, returns how many rows it inserted (seed reports that as a
 * created count; a plain call returning 0 wrote nothing).
 *
 * Deleting a product must delete its join rows too (PH1-15) — read them
 * via `by_product` before `ctx.db.delete(productId)`.
 */
export async function syncProductCategoryRows(
  ctx: MutationCtx,
  productId: Id<"products">,
): Promise<number> {
  const product = await ctx.db.get(productId);
  if (product === null) {
    return 0; // Deleted (or never existed) — its rows go with it.
  }
  const wanted = new Set(product.categoryIds);
  const existing = await ctx.db
    .query("productCategories")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();

  let inserted = 0;
  for (const categoryId of wanted) {
    if (existing.some((row) => row.categoryId === categoryId)) continue;
    await ctx.db.insert("productCategories", { productId, categoryId });
    inserted += 1;
  }
  for (const row of existing) {
    if (!wanted.has(row.categoryId)) {
      await ctx.db.delete(row._id);
    }
  }
  return inserted;
}
