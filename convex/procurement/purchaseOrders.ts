import { ConvexError, v } from "convex/values";
import { quoteTotals } from "../../lib/quotes";
import { roundMoney } from "../../lib/statements";
import {
  purchaseOrderEditError,
  purchaseOrderExpectedError,
  purchaseOrderPriceError,
  purchaseOrderQtyError,
  purchaseOrderSendError,
  type PurchaseOrderStatus,
} from "../../lib/purchaseOrders";
import { auditedMutation } from "../_lib/audit";
import { pricePurchaseLine, type LineTaxSnapshot } from "../_lib/documentTax";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";

/**
 * Purchase orders (PH2-21).
 *
 * Reads are `procurement.view`. Changing a draft (agreed price, expected
 * date, lines) is `procurement.edit` — accountant can, warehouse cannot.
 * Sending is `procurement.approve` — owner and admin. Send freezes tax
 * and does not move stock, and it does not email. A receipt (PH2-22)
 * and a vendor bill (PH2-23) move the later statuses.
 */

type ReadCtx = QueryCtx | MutationCtx;

async function linesFor(ctx: ReadCtx, purchaseOrderId: Id<"purchaseOrders">) {
  const lines = await ctx.db
    .query("purchaseOrderLines")
    .withIndex("by_order", (q) => q.eq("purchaseOrderId", purchaseOrderId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function loadOrder(ctx: MutationCtx, id: Id<"purchaseOrders">) {
  const row = await ctx.db.get(id);
  if (row === null) throw new ConvexError("That purchase order doesn't exist.");
  return row;
}

function storedTax(line: Doc<"purchaseOrderLines">): LineTaxSnapshot | null {
  if (
    line.taxCategory === undefined ||
    line.rateBps === undefined ||
    line.inclusive === undefined ||
    line.net === undefined ||
    line.tax === undefined ||
    line.gross === undefined
  ) {
    return null;
  }
  return {
    taxCategory: line.taxCategory,
    ...(line.taxRateId !== undefined ? { taxRateId: line.taxRateId } : {}),
    rateBps: line.rateBps,
    inclusive: line.inclusive,
    net: line.net,
    tax: line.tax,
    gross: line.gross,
  };
}

async function moneyForLine(
  ctx: ReadCtx,
  order: Doc<"purchaseOrders">,
  taxGroupId: Id<"taxGroups"> | undefined,
  line: Doc<"purchaseOrderLines">,
): Promise<LineTaxSnapshot> {
  const stored = storedTax(line);
  if (stored !== null) return stored;
  const product = await ctx.db.get(line.productId);
  if (product === null) {
    const extended = roundMoney(line.qty * line.unitPrice);
    return {
      taxCategory: "standard",
      rateBps: 0,
      inclusive: false,
      net: extended,
      tax: 0,
      gross: extended,
    };
  }
  return await pricePurchaseLine(ctx, {
    product,
    taxGroupId,
    qty: line.qty,
    unitPrice: line.unitPrice,
    decimalPlaces: order.decimalPlaces,
  });
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

function lineFields(priced: LineTaxSnapshot) {
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

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "procurement", "view");
    const rows = await ctx.db.query("purchaseOrders").collect();
    rows.sort((a, b) => a.docNumber.localeCompare(b.docNumber) || a._id.localeCompare(b._id));
    return await Promise.all(
      rows.map(async (row) => {
        const vendor = await ctx.db.get(row.vendorId);
        const requisition = await ctx.db.get(row.requisitionId);
        const lines = await linesFor(ctx, row._id);
        const priced = await Promise.all(
          lines.map((line) => moneyForLine(ctx, row, vendor?.taxGroupId, line)),
        );
        const totals = quoteTotals(priced, row.decimalPlaces);
        return {
          _id: row._id,
          docNumber: row.docNumber,
          status: row.status as PurchaseOrderStatus,
          vendorName: vendor?.name ?? "Unknown",
          requisitionNumber: requisition?.docNumber ?? "Unknown",
          expectedDate: row.expectedDate,
          currency: row.currency,
          decimalPlaces: row.decimalPlaces,
          amount: totals.gross,
          createdAt: row.createdAt,
        };
      }),
    );
  },
});

export const get = query({
  args: { purchaseOrderId: v.id("purchaseOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const row = await ctx.db.get(args.purchaseOrderId);
    if (row === null) return null;
    const vendor = await ctx.db.get(row.vendorId);
    const requisition = await ctx.db.get(row.requisitionId);
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .unique();
    const lines = await linesFor(ctx, row._id);
    const receipts = await ctx.db
      .query("goodsReceipts")
      .withIndex("by_purchase_order", (q) => q.eq("purchaseOrderId", row._id))
      .collect();
    const progress = new Map<string, { accepted: number; rejected: number }>();
    for (const receipt of receipts) {
      const receiptLines = await ctx.db
        .query("goodsReceiptLines")
        .withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id))
        .collect();
      for (const line of receiptLines) {
        if (line.purchaseOrderLineId === undefined) continue;
        const current = progress.get(line.purchaseOrderLineId) ?? { accepted: 0, rejected: 0 };
        current.accepted += line.qtyAccepted ?? 0;
        current.rejected += line.qtyRejected ?? 0;
        progress.set(line.purchaseOrderLineId, current);
      }
    }
    const priced = await Promise.all(
      lines.map(async (line) => ({
        line,
        money: await moneyForLine(ctx, row, vendor?.taxGroupId, line),
      })),
    );
    const totals = quoteTotals(
      priced.map((row) => row.money),
      row.decimalPlaces,
    );
    return {
      _id: row._id,
      docNumber: row.docNumber,
      status: row.status as PurchaseOrderStatus,
      companyName: org?.name ?? "Company",
      vendorName: vendor?.name ?? "Unknown",
      vendorCode: vendor?.code ?? "",
      requisitionId: requisition?._id ?? null,
      requisitionNumber: requisition?.docNumber ?? null,
      expectedDate: row.expectedDate,
      sentAt: row.sentAt ?? null,
      currency: row.currency,
      decimalPlaces: row.decimalPlaces,
      amount: totals.gross,
      totals,
      createdAt: row.createdAt,
      receipts: receipts
        .sort((a, b) => a.number.localeCompare(b.number))
        .map((receipt) => ({ _id: receipt._id, number: receipt.number })),
      lines: priced.map(({ line, money }) => ({
        _id: line._id,
        productId: line.productId,
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        acceptedQty: progress.get(line._id)?.accepted ?? 0,
        rejectedQty: progress.get(line._id)?.rejected ?? 0,
        unitPrice: line.unitPrice,
        taxCategory: money.taxCategory,
        rateBps: money.rateBps,
        inclusive: money.inclusive,
        net: money.net,
        tax: money.tax,
        gross: money.gross,
        amount: money.gross,
      })),
    };
  },
});

export const updateExpectedDate = auditedMutation({
  entity: "purchaseOrders",
  action: "update",
  args: { purchaseOrderId: v.id("purchaseOrders"), expectedDate: v.number() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const order = await loadOrder(ctx, args.purchaseOrderId);
    const editError = purchaseOrderEditError(order.status);
    if (editError !== null) throw new ConvexError(editError);
    const dateError = purchaseOrderExpectedError(args.expectedDate);
    if (dateError !== null) throw new ConvexError(dateError);
    const now = Date.now();
    await ctx.db.patch(order._id, { expectedDate: args.expectedDate, updatedAt: now });
    return {
      result: order._id,
      audit: {
        entityId: order._id,
        before: { expectedDate: order.expectedDate },
        after: { expectedDate: args.expectedDate },
      },
    };
  },
});

export const updateLine = auditedMutation({
  entity: "purchaseOrders",
  action: "update",
  args: {
    purchaseOrderId: v.id("purchaseOrders"),
    lineId: v.id("purchaseOrderLines"),
    unitPrice: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const order = await loadOrder(ctx, args.purchaseOrderId);
    const editError = purchaseOrderEditError(order.status);
    if (editError !== null) throw new ConvexError(editError);
    const line = await ctx.db.get(args.lineId);
    if (line === null || line.purchaseOrderId !== order._id) {
      throw new ConvexError("That line is not on this purchase order.");
    }
    const unitPrice = roundMoney(args.unitPrice);
    const priceError = purchaseOrderPriceError(unitPrice);
    if (priceError !== null) throw new ConvexError(priceError);
    const product = await ctx.db.get(line.productId);
    if (product === null) throw new ConvexError("That product doesn't exist.");
    const vendor = await ctx.db.get(order.vendorId);
    const priced = await pricePurchaseLine(ctx, {
      product,
      taxGroupId: vendor?.taxGroupId,
      qty: line.qty,
      unitPrice,
      decimalPlaces: order.decimalPlaces,
    });
    const now = Date.now();
    await ctx.db.patch(line._id, { unitPrice, ...lineFields(priced) });
    await ctx.db.patch(order._id, { updatedAt: now });
    return {
      result: line._id,
      audit: {
        entityId: order._id,
        before: { sku: line.sku, unitPrice: line.unitPrice },
        after: { sku: line.sku, unitPrice, gross: priced.gross },
      },
    };
  },
});

export const addLine = auditedMutation({
  entity: "purchaseOrders",
  action: "update",
  args: {
    purchaseOrderId: v.id("purchaseOrders"),
    productId: v.id("products"),
    variantId: v.optional(v.id("variants")),
    qty: v.number(),
    unitPrice: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const order = await loadOrder(ctx, args.purchaseOrderId);
    const editError = purchaseOrderEditError(order.status);
    if (editError !== null) throw new ConvexError(editError);
    const qtyError = purchaseOrderQtyError(args.qty);
    if (qtyError !== null) throw new ConvexError(qtyError);
    const unitPrice = roundMoney(args.unitPrice);
    const priceError = purchaseOrderPriceError(unitPrice);
    if (priceError !== null) throw new ConvexError(priceError);
    const described = await describeProduct(ctx, args.productId, args.variantId);
    const existing = await linesFor(ctx, order._id);
    const variantKey = described.variantId ?? "";
    const duplicate = existing.some(
      (line) => line.productId === described.product._id && (line.variantId ?? "") === variantKey,
    );
    if (duplicate) throw new ConvexError(`${described.sku} is already on this purchase order.`);
    const vendor = await ctx.db.get(order.vendorId);
    const priced = await pricePurchaseLine(ctx, {
      product: described.product,
      taxGroupId: vendor?.taxGroupId,
      qty: args.qty,
      unitPrice,
      decimalPlaces: order.decimalPlaces,
    });
    const now = Date.now();
    const lineId = await ctx.db.insert("purchaseOrderLines", {
      purchaseOrderId: order._id,
      productId: described.product._id,
      ...(described.variantId !== undefined ? { variantId: described.variantId } : {}),
      description: described.description,
      sku: described.sku,
      qty: args.qty,
      unitPrice,
      ...lineFields(priced),
      sort: existing.length,
      createdAt: now,
    });
    await ctx.db.patch(order._id, { updatedAt: now });
    return {
      result: lineId,
      audit: { entityId: order._id, after: { sku: described.sku, qty: args.qty, unitPrice } },
    };
  },
});

export const removeLine = auditedMutation({
  entity: "purchaseOrders",
  action: "update",
  args: {
    purchaseOrderId: v.id("purchaseOrders"),
    lineId: v.id("purchaseOrderLines"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const order = await loadOrder(ctx, args.purchaseOrderId);
    const editError = purchaseOrderEditError(order.status);
    if (editError !== null) throw new ConvexError(editError);
    const lines = await linesFor(ctx, order._id);
    const line = lines.find((row) => row._id === args.lineId);
    if (line === undefined) throw new ConvexError("That line is not on this purchase order.");
    if (lines.length < 2) throw new ConvexError("A purchase order needs a line.");
    await ctx.db.delete(line._id);
    const now = Date.now();
    await ctx.db.patch(order._id, { updatedAt: now });
    return {
      result: order._id,
      audit: { entityId: order._id, before: { sku: line.sku, qty: line.qty } },
    };
  },
});

export const send = auditedMutation({
  entity: "purchaseOrders",
  action: "send",
  args: { purchaseOrderId: v.id("purchaseOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "approve");
    const order = await loadOrder(ctx, args.purchaseOrderId);
    const sendError = purchaseOrderSendError(order.status);
    if (sendError !== null) throw new ConvexError(sendError);
    const lines = await linesFor(ctx, order._id);
    if (lines.length < 1) throw new ConvexError("Add a line.");
    const vendor = await ctx.db.get(order.vendorId);
    if (vendor === null) throw new ConvexError("That vendor doesn't exist.");
    if (!vendor.active) throw new ConvexError("That vendor is inactive.");
    for (const line of lines) {
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new ConvexError("That product doesn't exist.");
      const priced = await pricePurchaseLine(ctx, {
        product,
        taxGroupId: vendor.taxGroupId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        decimalPlaces: order.decimalPlaces,
      });
      await ctx.db.patch(line._id, lineFields(priced));
    }
    const now = Date.now();
    await ctx.db.patch(order._id, { status: "sent", sentAt: now, updatedAt: now });
    return {
      result: order._id,
      audit: {
        entityId: order._id,
        before: { status: order.status },
        after: { status: "sent", docNumber: order.docNumber },
      },
    };
  },
});
