/**
 * Pricing math (PH1-10): pure helpers shared by the product editor, the
 * read-only facts panel, and later the sales-line margin preview (PH2-09).
 *
 * Margin is a DISPLAY figure computed from the manual `products.costPrice`
 * — never stored, never sent to the storefront. The authoritative moving-
 * average cost is computed from stock receipts once inventory/finance
 * exist (PH1-17+); until then cost is staff-entered display data.
 */

/** Sanity cap on any stored price — a typo guard, not a policy. */
export const MAX_PRICE = 999_999_999.99;

/**
 * Margin percentage: (list − cost) / list × 100, rounded to one decimal
 * (it's a display figure, so the rounding is part of the contract).
 * Returns `null` when it can't be computed — a missing price on either
 * side, or a zero/negative list price (a giveaway has no meaningful rate).
 * A NEGATIVE result is valid and deliberate: selling below cost shows the
 * loss instead of hiding it.
 */
export function marginPercent(
  listPrice: number | undefined,
  costPrice: number | undefined,
): number | null {
  if (listPrice === undefined || costPrice === undefined) return null;
  if (!Number.isFinite(listPrice) || !Number.isFinite(costPrice) || listPrice <= 0) return null;
  return Math.round(((listPrice - costPrice) / listPrice) * 1000) / 10;
}
