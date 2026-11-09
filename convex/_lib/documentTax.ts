import { ConvexError } from "convex/values";
import { taxOnLine, type TaxCategory } from "../../lib/quotes";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Tax snapshot shared by quotes' idea and purchase orders (PH2-21).
 * An exempt product, a vendor with no tax group, or a group with no
 * rate for the product's category charges nothing. An inactive rate
 * is refused. Inclusive rates treat the line as gross.
 */

type ReadCtx = QueryCtx | MutationCtx;

export type LineTaxSnapshot = {
  taxCategory: TaxCategory;
  taxRateId?: Id<"taxRates">;
  rateBps: number;
  inclusive: boolean;
  net: number;
  tax: number;
  gross: number;
};

function rateForCategory(
  category: TaxCategory,
  rates: { standard?: Id<"taxRates">; reduced?: Id<"taxRates">; zero?: Id<"taxRates"> },
): Id<"taxRates"> | undefined {
  switch (category) {
    case "exempt":
      return undefined;
    case "standard":
      return rates.standard;
    case "reduced":
      return rates.reduced;
    case "zero":
      return rates.zero;
    default: {
      const unreachable: never = category;
      throw new ConvexError(unreachable);
    }
  }
}

export async function taxForProduct(
  ctx: ReadCtx,
  product: Doc<"products">,
  taxGroupId: Id<"taxGroups"> | undefined,
): Promise<{
  taxCategory: TaxCategory;
  taxRateId?: Id<"taxRates">;
  rateBps: number;
  inclusive: boolean;
}> {
  const category: TaxCategory = product.taxCategory ?? "standard";
  const none = { taxCategory: category, rateBps: 0, inclusive: false };
  if (category === "exempt" || taxGroupId === undefined) return none;
  const group = await ctx.db.get(taxGroupId);
  if (group === null || !group.active) return none;
  const rateId = rateForCategory(category, group.rates);
  if (rateId === undefined) return none;
  const rate = await ctx.db.get(rateId);
  if (rate === null) return none;
  if (!rate.active) throw new ConvexError("That tax rate is inactive.");
  return {
    taxCategory: category,
    taxRateId: rate._id,
    rateBps: rate.rateBps,
    inclusive: rate.inclusive,
  };
}

/** Agreed price plus the vendor's tax, rounded to the order currency. */
export async function pricePurchaseLine(
  ctx: ReadCtx,
  input: {
    product: Doc<"products">;
    taxGroupId: Id<"taxGroups"> | undefined;
    qty: number;
    unitPrice: number;
    decimalPlaces: number;
  },
): Promise<LineTaxSnapshot> {
  const tax = await taxForProduct(ctx, input.product, input.taxGroupId);
  const amounts = taxOnLine({
    unitPrice: input.unitPrice,
    qty: input.qty,
    decimalPlaces: input.decimalPlaces,
    rateBps: tax.rateBps,
    inclusive: tax.inclusive,
  });
  return {
    taxCategory: tax.taxCategory,
    ...(tax.taxRateId !== undefined ? { taxRateId: tax.taxRateId } : {}),
    rateBps: tax.rateBps,
    inclusive: tax.inclusive,
    net: amounts.net,
    tax: amounts.tax,
    gross: amounts.gross,
  };
}
