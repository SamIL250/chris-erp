/**
 * Reorder points (PH1-24). A point belongs to a product, and may name
 * a warehouse. The warehouse point wins at that warehouse; otherwise
 * the product-wide point applies. A slice with no point is never low,
 * however little is free.
 *
 * Low means available is at or below the point. Available is on-hand
 * minus reserved, the same figure the stock list shows.
 */

/** Ledger float dust. A balance this close to the point still counts. */
const QTY_EPSILON = 1e-9;

export const REORDER_QTY_MAX = 1_000_000_000;

export type ReorderPointRef = {
  productId: string;
  warehouseId?: string;
  qty: number;
};

export function reorderQtyError(qty: number): string | null {
  if (!Number.isFinite(qty)) return "Reorder point must be a number.";
  if (qty < 0) return "Reorder point can't be negative.";
  if (qty > REORDER_QTY_MAX) return "Reorder point is too large.";
  return null;
}

/**
 * The point that governs this product at this warehouse. A warehouse
 * row wins over the product-wide row.
 */
export function reorderPointFor(
  points: readonly ReorderPointRef[],
  productId: string,
  warehouseId: string,
): number | undefined {
  let general: number | undefined;
  for (const point of points) {
    if (point.productId !== productId) continue;
    if (point.warehouseId === warehouseId) return point.qty;
    if (point.warehouseId === undefined) general = point.qty;
  }
  return general;
}

/** True when a point is set and available has fallen to it or below. */
export function isLowStock(available: number, point: number | undefined): boolean {
  if (point === undefined || !Number.isFinite(available)) return false;
  return available <= point + QTY_EPSILON;
}
