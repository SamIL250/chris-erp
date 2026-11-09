import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { chargedUnitPrice } from "../../lib/priceOverrides";
import { taxOnLine } from "../../lib/quotes";

/**
 * After a price override is confirmed, the quote line charges the new
 * unit. A rejection puts the resolved price back. Line ids that are
 * not quote lines (the override table also covers later documents)
 * are left alone.
 */
export async function syncQuoteLineCharge(
  ctx: MutationCtx,
  override: Doc<"priceOverrides">,
): Promise<void> {
  if (override.documentKind !== "quote") return;
  const lineId = ctx.db.normalizeId("quoteLines", override.lineId);
  if (lineId === null) return;
  const line = await ctx.db.get(lineId);
  if (line === null) return;
  const quote = await ctx.db.get(line.quoteId);
  if (quote === null) return;
  const charged = chargedUnitPrice({
    status: override.status,
    unitPrice: override.unitPrice,
    resolvedUnitPrice: override.resolvedUnitPrice ?? line.resolvedUnitPrice,
  });
  if (charged === null) return;
  const kept = override.status === "applied" || override.status === "approved";
  const amounts = taxOnLine({
    unitPrice: charged,
    qty: line.qty,
    decimalPlaces: quote.decimalPlaces,
    rateBps: line.rateBps,
    inclusive: line.inclusive,
  });
  await ctx.db.patch(line._id, {
    unitPrice: charged,
    discountPercent: kept ? (override.requestedDiscountPercent ?? 0) : 0,
    net: amounts.net,
    tax: amounts.tax,
    gross: amounts.gross,
    updatedAt: Date.now(),
  });
}
