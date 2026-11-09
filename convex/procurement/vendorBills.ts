import { ConvexError, v } from "convex/values";
import { invoicePeriod } from "../../lib/invoices";
import { purchaseOrderBillError, type PurchaseOrderStatus } from "../../lib/purchaseOrders";
import { quoteTotals, taxOnLine } from "../../lib/quotes";
import { roundMoney } from "../../lib/statements";
import {
  billMatchIssues,
  normalizeBillReference,
  vendorBillDateError,
  vendorBillEditError,
  vendorBillMatchError,
  vendorBillPriceError,
  vendorBillQtyError,
  vendorBillReferenceError,
  type VendorBillStatus,
} from "../../lib/vendorBills";
import { appendAudit, auditedMutation } from "../_lib/audit";
import { pricePurchaseLine } from "../_lib/documentTax";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";

/**
 * Vendor bills (PH2-23).
 *
 * Reads are `procurement.view`. Recording and editing an open bill is
 * `procurement.edit` — accountant can, warehouse cannot. Matching is
 * `finance.post`. It writes one pending `vendorBill` intent and marks
 * a linked purchase order billed. Payment is Phase 3.
 */

const LINE_CAP = 100;

type ReadCtx = QueryCtx | MutationCtx;

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function linesFor(ctx: ReadCtx, vendorBillId: Id<"vendorBills">) {
  const lines = await ctx.db
    .query("vendorBillLines")
    .withIndex("by_bill", (q) => q.eq("vendorBillId", vendorBillId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function receivedByLine(ctx: ReadCtx, purchaseOrderId: Id<"purchaseOrders">) {
  const receipts = await ctx.db
    .query("goodsReceipts")
    .withIndex("by_purchase_order", (q) => q.eq("purchaseOrderId", purchaseOrderId))
    .collect();
  const received = new Map<string, number>();
  for (const receipt of receipts) {
    const lines = await ctx.db
      .query("goodsReceiptLines")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id))
      .collect();
    for (const line of lines) {
      if (line.purchaseOrderLineId === undefined) continue;
      received.set(
        line.purchaseOrderLineId,
        (received.get(line.purchaseOrderLineId) ?? 0) + (line.qtyAccepted ?? 0),
      );
    }
  }
  return received;
}

async function describeProduct(
  ctx: MutationCtx,
  productId: Id<"products">,
  variantId: Id<"variants"> | undefined,
) {
  const product = await ctx.db.get(productId);
  if (product === null) throw new ConvexError("That product doesn't exist.");
  if (product.status === "archived") throw new ConvexError(`${product.sku} is archived.`);
  const variants = await ctx.db
    .query("variants")
    .withIndex("by_product", (q) => q.eq("productId", product._id))
    .collect();
  if (variants.length > 0) {
    if (variantId === undefined) throw new ConvexError(`Name the variant for ${product.sku}.`);
    const variant = variants.find((row) => row._id === variantId);
    if (variant === undefined) throw new ConvexError("That variant is not on this product.");
    return {
      product,
      variantId: variant._id,
      sku: variant.sku,
      description: `${product.name} · ${variant.sku}`,
    };
  }
  if (variantId !== undefined) throw new ConvexError(`${product.sku} has no variants.`);
  return { product, variantId: undefined, sku: product.sku, description: product.name };
}

async function currencyOf(ctx: ReadCtx, code: string) {
  const currency = await ctx.db
    .query("currencies")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (currency === null) throw new ConvexError("That currency isn't in the catalog.");
  if (!currency.active) throw new ConvexError("That currency is inactive.");
  return currency;
}

function amountsOf(input: {
  unitPrice: number;
  qty: number;
  decimalPlaces: number;
  rateBps: number;
  inclusive: boolean;
}) {
  const amounts = taxOnLine(input);
  return { net: amounts.net, tax: amounts.tax, gross: amounts.gross };
}

function pricedFields(priced: {
  taxCategory: "standard" | "reduced" | "zero" | "exempt";
  taxRateId?: Id<"taxRates">;
  rateBps: number;
  inclusive: boolean;
  net: number;
  tax: number;
  gross: number;
}) {
  return {
    taxCategory: priced.taxCategory,
    ...(priced.taxRateId !== undefined ? { taxRateId: priced.taxRateId } : {}),
    rateBps: priced.rateBps,
    inclusive: priced.inclusive,
    net: priced.net,
    tax: priced.tax,
    gross: priced.gross,
  };
}

async function comparisonFor(
  ctx: ReadCtx,
  bill: Doc<"vendorBills">,
  line: Doc<"vendorBillLines">,
) {
  if (line.purchaseOrderLineId === undefined || bill.purchaseOrderId === undefined) {
    return {
      orderedQty: null,
      receivedQty: null,
      billedQty: line.qty,
      orderPrice: null,
      billPrice: line.unitPrice,
    };
  }
  const orderLine = await ctx.db.get(line.purchaseOrderLineId);
  const received = await receivedByLine(ctx, bill.purchaseOrderId);
  return {
    orderedQty: orderLine?.qty ?? null,
    receivedQty: received.get(line.purchaseOrderLineId) ?? 0,
    billedQty: line.qty,
    orderPrice: orderLine?.unitPrice ?? null,
    billPrice: line.unitPrice,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "procurement", "view");
    const rows = await ctx.db.query("vendorBills").collect();
    return await Promise.all(
      rows
        .sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id))
        .map(async (row) => {
          const vendor = await ctx.db.get(row.vendorId);
          const order =
            row.purchaseOrderId === undefined ? null : await ctx.db.get(row.purchaseOrderId);
          const lines = await linesFor(ctx, row._id);
          const totals = quoteTotals(lines, row.decimalPlaces);
          return {
            _id: row._id,
            docNumber: row.docNumber,
            status: row.status as VendorBillStatus,
            vendorName: vendor?.name ?? "Unknown",
            purchaseOrderNumber: order?.docNumber ?? null,
            billDate: row.billDate,
            currency: row.currency,
            decimalPlaces: row.decimalPlaces,
            amount: totals.gross,
            createdAt: row.createdAt,
          };
        }),
    );
  },
});

export const forPurchaseOrder = query({
  args: { purchaseOrderId: v.id("purchaseOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const row = await ctx.db
      .query("vendorBills")
      .withIndex("by_purchase_order", (q) => q.eq("purchaseOrderId", args.purchaseOrderId))
      .unique();
    if (row === null) return null;
    return { _id: row._id, docNumber: row.docNumber, status: row.status as VendorBillStatus };
  },
});

export const get = query({
  args: { vendorBillId: v.id("vendorBills") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const row = await ctx.db.get(args.vendorBillId);
    if (row === null) return null;
    const vendor = await ctx.db.get(row.vendorId);
    const order = row.purchaseOrderId === undefined ? null : await ctx.db.get(row.purchaseOrderId);
    const lines = await linesFor(ctx, row._id);
    const compared = await Promise.all(
      lines.map(async (line) => ({ line, comparison: await comparisonFor(ctx, row, line) })),
    );
    const totals = quoteTotals(lines, row.decimalPlaces);
    return {
      _id: row._id,
      docNumber: row.docNumber,
      status: row.status as VendorBillStatus,
      vendorId: row.vendorId,
      vendorName: vendor?.name ?? "Unknown",
      vendorCode: vendor?.code ?? "",
      purchaseOrderId: order?._id ?? null,
      purchaseOrderNumber: order?.docNumber ?? null,
      billDate: row.billDate,
      reference: row.reference ?? null,
      matchedAt: row.matchedAt ?? null,
      currency: row.currency,
      decimalPlaces: row.decimalPlaces,
      amount: totals.gross,
      totals,
      lines: compared.map(({ line, comparison }) => ({
        _id: line._id,
        productId: line.productId,
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        net: line.net,
        tax: line.tax,
        gross: line.gross,
        orderedQty: comparison.orderedQty,
        receivedQty: comparison.receivedQty,
        orderPrice: comparison.orderPrice,
      })),
    };
  },
});

const LINE_ARGS = {
  productId: v.id("products"),
  variantId: v.optional(v.id("variants")),
  qty: v.number(),
  unitPrice: v.number(),
};

export const create = auditedMutation({
  entity: "vendorBills",
  action: "create",
  args: {
    vendorId: v.id("vendors"),
    billDate: v.number(),
    reference: v.optional(v.string()),
    lines: v.array(v.object(LINE_ARGS)),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    throwIf(vendorBillDateError(args.billDate));
    throwIf(vendorBillReferenceError(args.reference));
    const vendor = await ctx.db.get(args.vendorId);
    if (vendor === null) throw new ConvexError("Vendor not found.");
    if (!vendor.active) throw new ConvexError("That vendor is inactive.");
    if (args.lines.length === 0) throw new ConvexError("Add at least one line.");
    if (args.lines.length > LINE_CAP) {
      throw new ConvexError(`A bill can have at most ${LINE_CAP} lines.`);
    }
    const currency = await currencyOf(ctx, vendor.currency);
    const seen = new Set<string>();
    const described = [];
    for (const line of args.lines) {
      throwIf(vendorBillQtyError(line.qty));
      throwIf(vendorBillPriceError(line.unitPrice));
      const key = `${line.productId}:${line.variantId ?? ""}`;
      if (seen.has(key)) throw new ConvexError("That product is already on this bill.");
      seen.add(key);
      const product = await describeProduct(ctx, line.productId, line.variantId);
      const priced = await pricePurchaseLine(ctx, {
        product: product.product,
        taxGroupId: vendor.taxGroupId,
        qty: line.qty,
        unitPrice: roundMoney(line.unitPrice),
        decimalPlaces: currency.decimalPlaces,
      });
      described.push({ line, product, priced, unitPrice: roundMoney(line.unitPrice) });
    }
    await ensureDefaultSequences(ctx);
    const now = Date.now();
    const reference = normalizeBillReference(args.reference);
    const vendorBillId = await ctx.db.insert("vendorBills", {
      docNumber: await nextSequence(ctx, "vendorBill"),
      vendorId: vendor._id,
      status: "open",
      currency: currency.code,
      decimalPlaces: currency.decimalPlaces,
      billDate: args.billDate,
      ...(reference !== undefined ? { reference } : {}),
      createdAt: now,
      updatedAt: now,
    });
    for (const [sort, row] of described.entries()) {
      await ctx.db.insert("vendorBillLines", {
        vendorBillId,
        productId: row.product.product._id,
        ...(row.product.variantId !== undefined ? { variantId: row.product.variantId } : {}),
        description: row.product.description,
        sku: row.product.sku,
        qty: row.line.qty,
        unitPrice: row.unitPrice,
        ...pricedFields(row.priced),
        sort,
        createdAt: now,
      });
    }
    const created = await ctx.db.get(vendorBillId);
    return {
      result: vendorBillId,
      audit: { entityId: vendorBillId, after: { docNumber: created?.docNumber, status: "open" } },
    };
  },
});

export const createFromPurchaseOrder = auditedMutation({
  entity: "vendorBills",
  action: "create",
  args: {
    purchaseOrderId: v.id("purchaseOrders"),
    billDate: v.number(),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    throwIf(vendorBillDateError(args.billDate));
    throwIf(vendorBillReferenceError(args.reference));
    const order = await ctx.db.get(args.purchaseOrderId);
    if (order === null) throw new ConvexError("Purchase order not found.");
    throwIf(purchaseOrderBillError(order.status as PurchaseOrderStatus));
    const existing = await ctx.db
      .query("vendorBills")
      .withIndex("by_purchase_order", (q) => q.eq("purchaseOrderId", order._id))
      .unique();
    if (existing !== null) throw new ConvexError("This purchase order already has a bill.");
    const vendor = await ctx.db.get(order.vendorId);
    if (vendor === null) throw new ConvexError("Vendor not found.");
    const orderLines = await ctx.db
      .query("purchaseOrderLines")
      .withIndex("by_order", (q) => q.eq("purchaseOrderId", order._id))
      .collect();
    orderLines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
    const received = await receivedByLine(ctx, order._id);
    const billLines = [];
    for (const line of orderLines) {
      const qty = received.get(line._id) ?? 0;
      if (qty <= 0) continue;
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new ConvexError("That product doesn't exist.");
      const priced =
        line.taxCategory !== undefined && line.rateBps !== undefined && line.inclusive !== undefined
          ? {
              taxCategory: line.taxCategory,
              ...(line.taxRateId !== undefined ? { taxRateId: line.taxRateId } : {}),
              rateBps: line.rateBps,
              inclusive: line.inclusive,
              ...amountsOf({
                unitPrice: line.unitPrice,
                qty,
                decimalPlaces: order.decimalPlaces,
                rateBps: line.rateBps,
                inclusive: line.inclusive,
              }),
            }
          : await pricePurchaseLine(ctx, {
              product,
              taxGroupId: vendor.taxGroupId,
              qty,
              unitPrice: line.unitPrice,
              decimalPlaces: order.decimalPlaces,
            });
      billLines.push({ line, qty, priced });
    }
    if (billLines.length === 0) {
      throw new ConvexError("Nothing has been received on this purchase order.");
    }
    await ensureDefaultSequences(ctx);
    const now = Date.now();
    const reference = normalizeBillReference(args.reference);
    const vendorBillId = await ctx.db.insert("vendorBills", {
      docNumber: await nextSequence(ctx, "vendorBill"),
      vendorId: vendor._id,
      purchaseOrderId: order._id,
      status: "open",
      currency: order.currency,
      decimalPlaces: order.decimalPlaces,
      billDate: args.billDate,
      ...(reference !== undefined ? { reference } : {}),
      createdAt: now,
      updatedAt: now,
    });
    for (const [sort, row] of billLines.entries()) {
      await ctx.db.insert("vendorBillLines", {
        vendorBillId,
        purchaseOrderLineId: row.line._id,
        productId: row.line.productId,
        ...(row.line.variantId !== undefined ? { variantId: row.line.variantId } : {}),
        description: row.line.description,
        sku: row.line.sku,
        qty: row.qty,
        unitPrice: row.line.unitPrice,
        ...pricedFields(row.priced),
        sort,
        createdAt: now,
      });
    }
    const created = await ctx.db.get(vendorBillId);
    return {
      result: vendorBillId,
      audit: {
        entityId: vendorBillId,
        after: {
          docNumber: created?.docNumber,
          status: "open",
          purchaseOrderId: order._id,
        },
      },
    };
  },
});

export const updateLine = auditedMutation({
  entity: "vendorBills",
  action: "update",
  args: {
    vendorBillId: v.id("vendorBills"),
    lineId: v.id("vendorBillLines"),
    qty: v.number(),
    unitPrice: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const bill = await ctx.db.get(args.vendorBillId);
    if (bill === null) throw new ConvexError("Bill not found.");
    throwIf(vendorBillEditError(bill.status as VendorBillStatus));
    const line = await ctx.db.get(args.lineId);
    if (line === null || line.vendorBillId !== bill._id) {
      throw new ConvexError("That line is not on this bill.");
    }
    throwIf(vendorBillQtyError(args.qty));
    throwIf(vendorBillPriceError(args.unitPrice));
    const unitPrice = roundMoney(args.unitPrice);
    const amounts = amountsOf({
      unitPrice,
      qty: args.qty,
      decimalPlaces: bill.decimalPlaces,
      rateBps: line.rateBps,
      inclusive: line.inclusive,
    });
    const now = Date.now();
    await ctx.db.patch(line._id, { qty: args.qty, unitPrice, ...amounts });
    await ctx.db.patch(bill._id, { updatedAt: now });
    return {
      result: bill._id,
      audit: {
        entityId: bill._id,
        before: { qty: line.qty, unitPrice: line.unitPrice },
        after: { qty: args.qty, unitPrice },
      },
    };
  },
});

export const match = auditedMutation({
  entity: "vendorBills",
  action: "match",
  args: { vendorBillId: v.id("vendorBills") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "finance", "post");
    const bill = await ctx.db.get(args.vendorBillId);
    if (bill === null) throw new ConvexError("Bill not found.");
    throwIf(vendorBillMatchError(bill.status as VendorBillStatus));
    const lines = await linesFor(ctx, bill._id);
    if (lines.length === 0) throw new ConvexError("Add a line.");
    const order = bill.purchaseOrderId === undefined ? null : await ctx.db.get(bill.purchaseOrderId);
    if (bill.purchaseOrderId !== undefined && order === null) {
      throw new ConvexError("Purchase order not found.");
    }
    if (order !== null) throwIf(purchaseOrderBillError(order.status as PurchaseOrderStatus));
    const blocked: string[] = [];
    for (const line of lines) {
      const comparison = await comparisonFor(ctx, bill, line);
      for (const issue of billMatchIssues(comparison)) {
        if (issue.blocks) blocked.push(`${line.sku}: ${issue.message}`);
      }
    }
    const blockedMessage = blocked[0];
    if (blockedMessage !== undefined) throw new ConvexError(blockedMessage);
    const totals = quoteTotals(lines, bill.decimalPlaces);
    const now = Date.now();
    const intentId = await ctx.db.insert("journalIntents", {
      type: "vendorBill",
      sourceType: "vendorBill",
      sourceId: bill._id,
      status: "pending",
      period: invoicePeriod(bill.billDate),
      currency: bill.currency,
      amount: totals.gross,
      net: totals.net,
      tax: totals.tax,
      lines: lines.map((line) => ({
        productId: line.productId,
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
        description: line.description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        net: line.net,
        tax: line.tax,
        amount: line.gross,
      })),
      createdAt: now,
    });
    await ctx.db.patch(bill._id, { status: "matched", matchedAt: now, updatedAt: now });
    if (order !== null) {
      await ctx.db.patch(order._id, { status: "billed", updatedAt: now });
      await appendAudit(ctx, {
        entity: "purchaseOrders",
        action: "bill",
        entityId: order._id,
        before: { status: order.status },
        after: { status: "billed", vendorBillId: bill._id },
      });
    }
    return {
      result: bill._id,
      audit: {
        entityId: bill._id,
        before: { status: "open" },
        after: { status: "matched", intentId, amount: totals.gross },
      },
    };
  },
});
