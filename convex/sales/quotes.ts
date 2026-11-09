import { ConvexError, v } from "convex/values";
import {
  discountPercentError,
  normalizeOverrideReason,
  overrideReasonError,
  priceOverride,
  type OverrideStatus,
} from "../../lib/priceOverrides";
import { priceDay, priceDayFromInput, resolveQtyError } from "../../lib/pricing";
import {
  quoteLapsed,
  quoteNoteError,
  quoteStatusError,
  quoteTotals,
  taxOnLine,
  validityError,
  type QuoteStatus,
  type TaxCategory,
} from "../../lib/quotes";
import { appendAudit, auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { resolveStoredPrice } from "./prices";

/**
 * Quotes (PH2-11). A draft prices each line with `resolvePrice`,
 * snapshots the tax, and can take a line discount. Above 10% the
 * discount waits for `priceOverrides.confirm`. Sending, accepting,
 * rejecting, and expiring follow the status list. An accepted quote
 * converts once into a draft sales order that keeps the lines and
 * the prices. The order's own workflow is PH2-12.
 *
 * Reads are `sales.view`. Writes are `sales.create`, so warehouse
 * (sales.edit is fulfillment) cannot change a quote.
 */

type ReadCtx = QueryCtx | MutationCtx;

function snapshotAddress(row: Doc<"customerAddresses">) {
  return {
    line1: row.line1,
    ...(row.line2 !== undefined && row.line2 !== "" ? { line2: row.line2 } : {}),
    city: row.city,
    ...(row.region !== undefined && row.region !== "" ? { region: row.region } : {}),
    ...(row.postalCode !== undefined && row.postalCode !== ""
      ? { postalCode: row.postalCode }
      : {}),
    country: row.country,
  };
}

async function requireQuote(ctx: ReadCtx, quoteId: Id<"quotes">) {
  const quote = await ctx.db.get(quoteId);
  if (quote === null) throw new ConvexError("Quote not found.");
  return quote;
}

function requireDraft(quote: Doc<"quotes">) {
  if (quote.status !== "draft") throw new ConvexError("Only a draft quote can be changed.");
}

async function linesOf(ctx: ReadCtx, quoteId: Id<"quotes">) {
  const rows = await ctx.db
    .query("quoteLines")
    .withIndex("by_quote", (q) => q.eq("quoteId", quoteId))
    .collect();
  return rows.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
}

async function overridesOf(ctx: ReadCtx, quoteId: Id<"quotes">) {
  return await ctx.db
    .query("priceOverrides")
    .withIndex("by_line", (q) => q.eq("documentKind", "quote").eq("documentId", quoteId))
    .collect();
}

function assertToday(now: number) {
  const today = priceDay(now);
  if (today === null) throw new ConvexError("Enter a real date.");
  return today;
}

function refuseIfLapsed(quote: Doc<"quotes">, now: number) {
  if (quoteLapsed(quote.validUntil, now)) throw new ConvexError("This quote has expired.");
}

async function refuseIfPending(ctx: ReadCtx, quoteId: Id<"quotes">) {
  const pending = (await overridesOf(ctx, quoteId)).some((row) => row.status === "pending");
  if (pending) throw new ConvexError("A line is still waiting for a price approval.");
}

async function taxFor(
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

function amountsFor(
  quote: Doc<"quotes">,
  line: { qty: number; rateBps: number; inclusive: boolean },
  unitPrice: number,
) {
  return taxOnLine({
    unitPrice,
    qty: line.qty,
    decimalPlaces: quote.decimalPlaces,
    rateBps: line.rateBps,
    inclusive: line.inclusive,
  });
}

async function customerAddress(
  ctx: ReadCtx,
  customerId: Id<"customers">,
  addressId: Id<"customerAddresses">,
) {
  const address = await ctx.db.get(addressId);
  if (address === null || address.customerId !== customerId) {
    throw new ConvexError("That address is not on this customer.");
  }
  return snapshotAddress(address);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const quotes = await ctx.db.query("quotes").collect();
    const customers = await ctx.db.query("customers").collect();
    const names = new Map(customers.map((row) => [row._id, row]));
    const presented = [];
    for (const quote of quotes) {
      const lines = await linesOf(ctx, quote._id);
      const totals = quoteTotals(lines, quote.decimalPlaces);
      const customer = names.get(quote.customerId);
      presented.push({
        _id: quote._id,
        docNumber: quote.docNumber,
        customerId: quote.customerId,
        customerName: customer?.name ?? "Customer",
        customerCode: customer?.code ?? "",
        status: quote.status,
        currency: quote.currency,
        decimalPlaces: quote.decimalPlaces,
        validUntil: quote.validUntil,
        gross: totals.gross,
        createdAt: quote.createdAt,
      });
    }
    presented.sort((a, b) => b.createdAt - a.createdAt || a._id.localeCompare(b._id));
    return presented;
  },
});

export const get = query({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const quote = await ctx.db.get(args.quoteId);
    if (quote === null) return null;
    const customer = await ctx.db.get(quote.customerId);
    const lines = await linesOf(ctx, quote._id);
    const overrides = await overridesOf(ctx, quote._id);
    const byLine = new Map(overrides.map((row) => [row.lineId, row]));
    const salesOrder =
      quote.salesOrderId === undefined ? null : await ctx.db.get(quote.salesOrderId);
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .unique();
    return {
      companyName: org?.name ?? "Company",
      quote: {
        ...quote,
        customerName: customer?.name ?? "Customer",
        customerCode: customer?.code ?? "",
      },
      lines: lines.map((line) => {
        const override = byLine.get(line._id) ?? null;
        return {
          ...line,
          overrideStatus: override?.status ?? null,
          needsApproval: override?.needsApproval ?? false,
        };
      }),
      totals: quoteTotals(lines, quote.decimalPlaces),
      salesOrder:
        salesOrder === null ? null : { _id: salesOrder._id, docNumber: salesOrder.docNumber },
    };
  },
});

export const create = auditedMutation({
  entity: "quotes",
  action: "create",
  args: {
    customerId: v.id("customers"),
    validUntil: v.string(),
    notes: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const customer = await ctx.db.get(args.customerId);
    if (customer === null) throw new ConvexError("Customer not found.");
    if (customer.status === "closed") throw new ConvexError("That customer is closed.");
    const today = assertToday(Date.now());
    const until = priceDayFromInput(args.validUntil);
    if ("error" in until) throw new ConvexError(until.error);
    const range = validityError(today, until.ms);
    if (range !== null) throw new ConvexError(range);
    let notes: string | undefined;
    if (args.notes !== null && args.notes.trim() !== "") {
      const message = quoteNoteError(args.notes);
      if (message !== null) throw new ConvexError(message);
      notes = args.notes.trim();
    }
    const currency = await ctx.db
      .query("currencies")
      .withIndex("by_code", (q) => q.eq("code", customer.currency))
      .unique();
    if (currency === null) throw new ConvexError("Currency not found.");
    if (!currency.active) throw new ConvexError("That currency is inactive.");
    if (
      !Number.isInteger(currency.decimalPlaces) ||
      currency.decimalPlaces < 0 ||
      currency.decimalPlaces > 6
    ) {
      throw new ConvexError("That currency has no decimal places.");
    }
    const addresses = await ctx.db
      .query("customerAddresses")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const bill = addresses.find((row) => row.isDefaultBill);
    const ship = addresses.find((row) => row.isDefaultShip);
    const now = Date.now();
    const docNumber = await nextSequence(ctx, "quote");
    const quoteId = await ctx.db.insert("quotes", {
      docNumber,
      customerId: customer._id,
      status: "draft",
      currency: currency.code,
      decimalPlaces: currency.decimalPlaces,
      quoteDate: today,
      validUntil: until.ms,
      paymentTermsDays: customer.paymentTermsDays,
      ...(customer.taxGroupId !== undefined ? { taxGroupId: customer.taxGroupId } : {}),
      ...(bill !== undefined ? { billTo: snapshotAddress(bill) } : {}),
      ...(ship !== undefined ? { shipTo: snapshotAddress(ship) } : {}),
      ...(notes !== undefined ? { notes } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: quoteId,
      audit: { entityId: quoteId, after: { docNumber, customerId: customer._id, status: "draft" } },
    };
  },
});

export const update = auditedMutation({
  entity: "quotes",
  action: "update",
  args: {
    quoteId: v.id("quotes"),
    validUntil: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    billToAddressId: v.optional(v.union(v.id("customerAddresses"), v.null())),
    shipToAddressId: v.optional(v.union(v.id("customerAddresses"), v.null())),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const quote = await requireQuote(ctx, args.quoteId);
    requireDraft(quote);
    let validUntil = quote.validUntil;
    if (args.validUntil !== undefined) {
      const until = priceDayFromInput(args.validUntil);
      if ("error" in until) throw new ConvexError(until.error);
      const range = validityError(quote.quoteDate, until.ms);
      if (range !== null) throw new ConvexError(range);
      validUntil = until.ms;
    }
    let notes = quote.notes;
    if (args.notes !== undefined) {
      if (args.notes === null || args.notes.trim() === "") {
        notes = undefined;
      } else {
        const message = quoteNoteError(args.notes);
        if (message !== null) throw new ConvexError(message);
        notes = args.notes.trim();
      }
    }
    let billTo = quote.billTo;
    if (args.billToAddressId !== undefined) {
      billTo =
        args.billToAddressId === null
          ? undefined
          : await customerAddress(ctx, quote.customerId, args.billToAddressId);
    }
    let shipTo = quote.shipTo;
    if (args.shipToAddressId !== undefined) {
      shipTo =
        args.shipToAddressId === null
          ? undefined
          : await customerAddress(ctx, quote.customerId, args.shipToAddressId);
    }
    const now = Date.now();
    await ctx.db.replace(quote._id, {
      docNumber: quote.docNumber,
      customerId: quote.customerId,
      status: quote.status,
      currency: quote.currency,
      decimalPlaces: quote.decimalPlaces,
      quoteDate: quote.quoteDate,
      validUntil,
      paymentTermsDays: quote.paymentTermsDays,
      ...(quote.taxGroupId !== undefined ? { taxGroupId: quote.taxGroupId } : {}),
      ...(billTo !== undefined ? { billTo } : {}),
      ...(shipTo !== undefined ? { shipTo } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(quote.salesOrderId !== undefined ? { salesOrderId: quote.salesOrderId } : {}),
      createdAt: quote.createdAt,
      updatedAt: now,
    });
    return {
      result: quote._id,
      audit: {
        entityId: quote._id,
        before: { validUntil: quote.validUntil, notes: quote.notes ?? null },
        after: { validUntil, notes: notes ?? null },
      },
    };
  },
});

export const addLine = auditedMutation({
  entity: "quoteLines",
  action: "create",
  args: {
    quoteId: v.id("quotes"),
    productId: v.id("products"),
    variantId: v.union(v.id("variants"), v.null()),
    qty: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const quote = await requireQuote(ctx, args.quoteId);
    requireDraft(quote);
    const qtyMessage = resolveQtyError(args.qty);
    if (qtyMessage !== null) throw new ConvexError(qtyMessage);
    const product = await ctx.db.get(args.productId);
    if (product === null) throw new ConvexError("Product not found.");
    if (product.status === "archived") throw new ConvexError("That product is archived.");
    if (args.variantId !== null) {
      const variant = await ctx.db.get(args.variantId);
      if (variant === null) throw new ConvexError("Variant not found.");
      if (variant.productId !== product._id) {
        throw new ConvexError("That variant is not on this product.");
      }
    }
    const resolved = await resolveStoredPrice(ctx, {
      customerId: quote.customerId,
      productId: product._id,
      variantId: args.variantId,
      qty: args.qty,
      date: quote.quoteDate,
      currency: quote.currency,
    });
    if (resolved.unitPrice === null) {
      throw new ConvexError(`This product has no price in ${quote.currency}.`);
    }
    const tax = await taxFor(ctx, product, quote.taxGroupId);
    const amounts = taxOnLine({
      unitPrice: resolved.unitPrice,
      qty: args.qty,
      decimalPlaces: quote.decimalPlaces,
      rateBps: tax.rateBps,
      inclusive: tax.inclusive,
    });
    const existing = await linesOf(ctx, quote._id);
    const variant = args.variantId === null ? null : await ctx.db.get(args.variantId);
    const now = Date.now();
    const lineId = await ctx.db.insert("quoteLines", {
      quoteId: quote._id,
      productId: product._id,
      ...(args.variantId !== null ? { variantId: args.variantId } : {}),
      description: product.name,
      sku: variant?.sku ?? product.sku,
      qty: args.qty,
      resolvedUnitPrice: resolved.unitPrice,
      discountPercent: 0,
      unitPrice: resolved.unitPrice,
      taxCategory: tax.taxCategory,
      ...(tax.taxRateId !== undefined ? { taxRateId: tax.taxRateId } : {}),
      rateBps: tax.rateBps,
      inclusive: tax.inclusive,
      net: amounts.net,
      tax: amounts.tax,
      gross: amounts.gross,
      sort: existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.sort)) + 1,
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: lineId,
      audit: {
        entityId: lineId,
        after: {
          quoteId: quote._id,
          sku: variant?.sku ?? product.sku,
          unitPrice: resolved.unitPrice,
        },
      },
    };
  },
});

export const removeLine = auditedMutation({
  entity: "quoteLines",
  action: "delete",
  args: { lineId: v.id("quoteLines") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const line = await ctx.db.get(args.lineId);
    if (line === null) throw new ConvexError("That line is no longer on the quote.");
    const quote = await requireQuote(ctx, line.quoteId);
    requireDraft(quote);
    const override = (await overridesOf(ctx, quote._id)).find((row) => row.lineId === line._id);
    if (override !== undefined) await ctx.db.delete(override._id);
    await ctx.db.delete(line._id);
    return {
      result: null,
      audit: {
        entityId: line._id,
        before: { quoteId: quote._id, sku: line.sku, unitPrice: line.unitPrice },
      },
    };
  },
});

export const setDiscount = auditedMutation({
  entity: "quoteLines",
  action: "update",
  args: { lineId: v.id("quoteLines"), discountPercent: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const requestedBy = await requirePermission(ctx, "sales", "create");
    const line = await ctx.db.get(args.lineId);
    if (line === null) throw new ConvexError("That line is no longer on the quote.");
    const quote = await requireQuote(ctx, line.quoteId);
    requireDraft(quote);
    const percentMessage = discountPercentError(args.discountPercent);
    if (percentMessage !== null) throw new ConvexError(percentMessage);
    const reasonMessage = overrideReasonError(args.reason);
    if (reasonMessage !== null) throw new ConvexError(reasonMessage);
    const decision = priceOverride({
      resolvedUnitPrice: line.resolvedUnitPrice,
      decimalPlaces: quote.decimalPlaces,
      mode: "discount",
      discountPercent: args.discountPercent,
    });
    if ("error" in decision) throw new ConvexError(decision.error);
    const status: OverrideStatus = decision.needsApproval ? "pending" : "applied";
    const charged = status === "applied" ? decision.unitPrice : line.resolvedUnitPrice;
    const amounts = amountsFor(quote, line, charged);
    const now = Date.now();
    const existing = (await overridesOf(ctx, quote._id)).find((row) => row.lineId === line._id);
    const stored = {
      documentKind: "quote" as const,
      documentId: quote._id,
      lineId: line._id,
      currency: quote.currency,
      mode: "discount" as const,
      unitPrice: decision.unitPrice,
      needsApproval: decision.needsApproval,
      status,
      reason: normalizeOverrideReason(args.reason),
      requestedBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      resolvedUnitPrice: line.resolvedUnitPrice,
      requestedDiscountPercent: args.discountPercent,
      ...(decision.discountPercent === null ? {} : { discountPercent: decision.discountPercent }),
    };
    const overrideId =
      existing === undefined ? await ctx.db.insert("priceOverrides", stored) : existing._id;
    if (existing !== undefined) await ctx.db.replace(existing._id, stored);
    await appendAudit(ctx, {
      entity: "priceOverrides",
      action: "set",
      entityId: overrideId,
      ...(existing === undefined
        ? {}
        : { before: { status: existing.status, unitPrice: existing.unitPrice } }),
      after: { status, unitPrice: decision.unitPrice, needsApproval: decision.needsApproval },
    });
    await ctx.db.patch(line._id, {
      discountPercent: args.discountPercent,
      unitPrice: charged,
      net: amounts.net,
      tax: amounts.tax,
      gross: amounts.gross,
      updatedAt: now,
    });
    return {
      result: line._id,
      audit: {
        entityId: line._id,
        before: { unitPrice: line.unitPrice, discountPercent: line.discountPercent },
        after: { unitPrice: charged, discountPercent: args.discountPercent, status },
      },
    };
  },
});

export const clearDiscount = auditedMutation({
  entity: "quoteLines",
  action: "update",
  args: { lineId: v.id("quoteLines") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const line = await ctx.db.get(args.lineId);
    if (line === null) throw new ConvexError("That line is no longer on the quote.");
    const quote = await requireQuote(ctx, line.quoteId);
    requireDraft(quote);
    const existing = (await overridesOf(ctx, quote._id)).find((row) => row.lineId === line._id);
    if (existing !== undefined) {
      await ctx.db.delete(existing._id);
      await appendAudit(ctx, {
        entity: "priceOverrides",
        action: "delete",
        entityId: existing._id,
        before: { status: existing.status, unitPrice: existing.unitPrice },
      });
    }
    const amounts = amountsFor(quote, line, line.resolvedUnitPrice);
    const now = Date.now();
    await ctx.db.patch(line._id, {
      discountPercent: 0,
      unitPrice: line.resolvedUnitPrice,
      net: amounts.net,
      tax: amounts.tax,
      gross: amounts.gross,
      updatedAt: now,
    });
    return {
      result: line._id,
      audit: {
        entityId: line._id,
        before: { unitPrice: line.unitPrice, discountPercent: line.discountPercent },
        after: { unitPrice: line.resolvedUnitPrice, discountPercent: 0 },
      },
    };
  },
});

async function moveStatus(ctx: MutationCtx, quote: Doc<"quotes">, to: QuoteStatus, now: number) {
  const message = quoteStatusError(quote.status, to);
  if (message !== null) throw new ConvexError(message);
  if (to === "sent" && (await linesOf(ctx, quote._id)).length === 0) {
    throw new ConvexError("Add a line before sending the quote.");
  }
  if (to === "sent" || to === "accepted") {
    refuseIfLapsed(quote, now);
    await refuseIfPending(ctx, quote._id);
  }
  if (to === "expired" && !quoteLapsed(quote.validUntil, now)) {
    throw new ConvexError("This quote is still valid.");
  }
  await ctx.db.patch(quote._id, { status: to, updatedAt: now });
}

export const send = auditedMutation({
  entity: "quotes",
  action: "send",
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const quote = await requireQuote(ctx, args.quoteId);
    const now = Date.now();
    await moveStatus(ctx, quote, "sent", now);
    return {
      result: quote._id,
      audit: { entityId: quote._id, before: { status: quote.status }, after: { status: "sent" } },
    };
  },
});

export const accept = auditedMutation({
  entity: "quotes",
  action: "accept",
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const quote = await requireQuote(ctx, args.quoteId);
    const now = Date.now();
    await moveStatus(ctx, quote, "accepted", now);
    return {
      result: quote._id,
      audit: {
        entityId: quote._id,
        before: { status: quote.status },
        after: { status: "accepted" },
      },
    };
  },
});

export const reject = auditedMutation({
  entity: "quotes",
  action: "reject",
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const quote = await requireQuote(ctx, args.quoteId);
    const now = Date.now();
    await moveStatus(ctx, quote, "rejected", now);
    return {
      result: quote._id,
      audit: {
        entityId: quote._id,
        before: { status: quote.status },
        after: { status: "rejected" },
      },
    };
  },
});

export const expire = auditedMutation({
  entity: "quotes",
  action: "expire",
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const quote = await requireQuote(ctx, args.quoteId);
    const now = Date.now();
    await moveStatus(ctx, quote, "expired", now);
    return {
      result: quote._id,
      audit: {
        entityId: quote._id,
        before: { status: quote.status },
        after: { status: "expired" },
      },
    };
  },
});

export const convert = auditedMutation({
  entity: "salesOrders",
  action: "create",
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const quote = await requireQuote(ctx, args.quoteId);
    if (quote.status !== "accepted") {
      throw new ConvexError("Accept the quote before converting it.");
    }
    if (quote.salesOrderId !== undefined) throw new ConvexError("This quote already has an order.");
    await refuseIfPending(ctx, quote._id);
    const lines = await linesOf(ctx, quote._id);
    if (lines.length === 0) throw new ConvexError("Add a line before converting the quote.");
    const now = Date.now();
    const docNumber = await nextSequence(ctx, "salesOrder");
    const salesOrderId = await ctx.db.insert("salesOrders", {
      docNumber,
      customerId: quote.customerId,
      quoteId: quote._id,
      status: "draft",
      channel: "manual",
      currency: quote.currency,
      decimalPlaces: quote.decimalPlaces,
      paymentTermsDays: quote.paymentTermsDays,
      ...(quote.billTo !== undefined ? { billTo: quote.billTo } : {}),
      ...(quote.shipTo !== undefined ? { shipTo: quote.shipTo } : {}),
      ...(quote.notes !== undefined ? { notes: quote.notes } : {}),
      createdAt: now,
      updatedAt: now,
    });
    for (const line of lines) {
      await ctx.db.insert("salesOrderLines", {
        salesOrderId,
        quoteLineId: line._id,
        productId: line.productId,
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxCategory: line.taxCategory,
        ...(line.taxRateId !== undefined ? { taxRateId: line.taxRateId } : {}),
        rateBps: line.rateBps,
        inclusive: line.inclusive,
        net: line.net,
        tax: line.tax,
        gross: line.gross,
        reservedQty: 0,
        fulfilledQty: 0,
        backorder: false,
        sort: line.sort,
        createdAt: now,
      });
    }
    await ctx.db.patch(quote._id, { salesOrderId, updatedAt: now });
    return {
      result: salesOrderId,
      audit: {
        entityId: salesOrderId,
        after: { docNumber, quoteId: quote._id, status: "draft" },
      },
    };
  },
});
