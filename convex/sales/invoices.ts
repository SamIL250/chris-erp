import { ConvexError, v } from "convex/values";
import {
  dueOn,
  invoiceOrderStatusError,
  invoicePeriod,
  orderCoveredByInvoices,
  payInvoiceError,
  postInvoiceError,
  taxBreakdown,
  unbilledQty,
  voidInvoiceError,
} from "../../lib/invoices";
import { priceDayFromInput } from "../../lib/pricing";
import { quoteTotals, taxOnLine } from "../../lib/quotes";
import { appendAudit, auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { salesOrderAudit } from "./orders";

/**
 * Sales invoices (PH2-16). A draft copies shipped quantity, the
 * charged unit, and the tax rate. Posting writes one pending
 * `salesInvoice` intent and, once every line has shipped and been
 * billed, marks the order invoiced. Reads are `sales.view`. Creating,
 * posting, voiding a draft, and marking paid are `sales.create`, so
 * warehouse cannot invoice. Marking paid does not record a payment.
 */

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function requireOrder(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const order = await ctx.db.get(salesOrderId);
  if (order === null) throw new ConvexError("Order not found.");
  return order;
}

async function requireInvoice(ctx: QueryCtx | MutationCtx, invoiceId: Id<"salesInvoices">) {
  const invoice = await ctx.db.get(invoiceId);
  if (invoice === null) throw new ConvexError("Invoice not found.");
  return invoice;
}

async function orderLines(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const lines = await ctx.db
    .query("salesOrderLines")
    .withIndex("by_order", (q) => q.eq("salesOrderId", salesOrderId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function invoiceLines(ctx: QueryCtx | MutationCtx, invoiceId: Id<"salesInvoices">) {
  const lines = await ctx.db
    .query("salesInvoiceLines")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function invoicesForOrder(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const invoices = await ctx.db
    .query("salesInvoices")
    .withIndex("by_order", (q) => q.eq("salesOrderId", salesOrderId))
    .collect();
  invoices.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
  return invoices;
}

/** Quantity already claimed by a draft, posted, or paid invoice. */
export async function billedQty(
  ctx: QueryCtx | MutationCtx,
  salesOrderId: Id<"salesOrders">,
): Promise<Map<Id<"salesOrderLines">, number>> {
  const invoices = await invoicesForOrder(ctx, salesOrderId);
  const open = new Set(
    invoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice._id),
  );
  const billed = new Map<Id<"salesOrderLines">, number>();
  for (const invoice of invoices) {
    if (!open.has(invoice._id)) continue;
    const lines = await invoiceLines(ctx, invoice._id);
    for (const line of lines) {
      billed.set(line.salesOrderLineId, (billed.get(line.salesOrderLineId) ?? 0) + line.qty);
    }
  }
  return billed;
}

function fulfilledOf(line: { fulfilledQty?: number }): number {
  return line.fulfilledQty ?? 0;
}

type ChargeRow = {
  orderLine: Doc<"salesOrderLines">;
  qty: number;
  deliveryLineId?: Id<"deliveryLines">;
};

async function insertInvoice(
  ctx: MutationCtx,
  args: {
    order: Doc<"salesOrders">;
    deliveryId?: Id<"deliveries">;
    invoiceDate: number;
    rows: ChargeRow[];
  },
) {
  if (args.rows.length === 0) throw new ConvexError("Nothing on this order is ready to invoice.");
  await ensureDefaultSequences(ctx);
  const docNumber = await nextSequence(ctx, "invoice");
  const now = Date.now();
  const invoiceId = await ctx.db.insert("salesInvoices", {
    docNumber,
    customerId: args.order.customerId,
    salesOrderId: args.order._id,
    ...(args.deliveryId !== undefined ? { deliveryId: args.deliveryId } : {}),
    status: "draft",
    currency: args.order.currency,
    decimalPlaces: args.order.decimalPlaces,
    paymentTermsDays: args.order.paymentTermsDays,
    invoiceDate: args.invoiceDate,
    dueDate: dueOn(args.invoiceDate, args.order.paymentTermsDays),
    ...(args.order.billTo !== undefined ? { billTo: args.order.billTo } : {}),
    ...(args.order.shipTo !== undefined ? { shipTo: args.order.shipTo } : {}),
    createdAt: now,
    updatedAt: now,
  });
  let sort = 0;
  for (const row of args.rows) {
    const priced = taxOnLine({
      unitPrice: row.orderLine.unitPrice,
      qty: row.qty,
      decimalPlaces: args.order.decimalPlaces,
      rateBps: row.orderLine.rateBps,
      inclusive: row.orderLine.inclusive,
    });
    await ctx.db.insert("salesInvoiceLines", {
      invoiceId,
      salesOrderLineId: row.orderLine._id,
      ...(row.deliveryLineId !== undefined ? { deliveryLineId: row.deliveryLineId } : {}),
      productId: row.orderLine.productId,
      ...(row.orderLine.variantId !== undefined ? { variantId: row.orderLine.variantId } : {}),
      description: row.orderLine.description,
      sku: row.orderLine.sku,
      qty: row.qty,
      unitPrice: row.orderLine.unitPrice,
      discountPercent: row.orderLine.discountPercent,
      taxCategory: row.orderLine.taxCategory,
      ...(row.orderLine.taxRateId !== undefined ? { taxRateId: row.orderLine.taxRateId } : {}),
      rateBps: row.orderLine.rateBps,
      inclusive: row.orderLine.inclusive,
      net: priced.net,
      tax: priced.tax,
      gross: priced.gross,
      sort,
      createdAt: now,
    });
    sort += 1;
  }
  return invoiceId;
}

function invoiceDay(raw: string): number {
  const day = priceDayFromInput(raw);
  if ("error" in day) throw new ConvexError(day.error);
  return day.ms;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const invoices = await ctx.db.query("salesInvoices").collect();
    const presented = [];
    for (const invoice of invoices) {
      const customer = await ctx.db.get(invoice.customerId);
      const order = await ctx.db.get(invoice.salesOrderId);
      const delivery =
        invoice.deliveryId === undefined ? null : await ctx.db.get(invoice.deliveryId);
      const lines = await invoiceLines(ctx, invoice._id);
      presented.push({
        _id: invoice._id,
        docNumber: invoice.docNumber,
        status: invoice.status,
        customerName: customer?.name ?? "Customer",
        orderNumber: order?.docNumber ?? "",
        deliveryNumber: delivery?.docNumber ?? null,
        currency: invoice.currency,
        decimalPlaces: invoice.decimalPlaces,
        gross: quoteTotals(lines, invoice.decimalPlaces).gross,
        invoiceDate: invoice.invoiceDate,
        createdAt: invoice.createdAt,
      });
    }
    presented.sort((a, b) => b.createdAt - a.createdAt || a._id.localeCompare(b._id));
    return presented;
  },
});

export const forOrder = query({
  args: { salesOrderId: v.id("salesOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const order = await ctx.db.get(args.salesOrderId);
    const invoices = await invoicesForOrder(ctx, args.salesOrderId);
    if (order === null) return { invoices: [], billable: false };
    const lines = await orderLines(ctx, order._id);
    const billed = await billedQty(ctx, order._id);
    const open =
      order.status === "confirmed" || order.status === "fulfilling"
        ? lines.some((line) => unbilledQty(fulfilledOf(line), billed.get(line._id) ?? 0) > 0)
        : false;
    return {
      invoices: invoices.map((invoice) => ({
        _id: invoice._id,
        docNumber: invoice.docNumber,
        status: invoice.status,
      })),
      billable: open,
    };
  },
});

export const forDelivery = query({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const delivery = await ctx.db.get(args.deliveryId);
    const invoices =
      delivery === null
        ? []
        : (
            await ctx.db
              .query("salesInvoices")
              .withIndex("by_delivery", (q) => q.eq("deliveryId", args.deliveryId))
              .collect()
          ).sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
    if (delivery === null || delivery.status !== "shipped") {
      return {
        invoices: invoices.map((invoice) => ({
          _id: invoice._id,
          docNumber: invoice.docNumber,
          status: invoice.status,
        })),
        billable: false,
      };
    }
    const orderRows = await orderLines(ctx, delivery.salesOrderId);
    const slipLines = await ctx.db
      .query("deliveryLines")
      .withIndex("by_delivery", (q) => q.eq("deliveryId", delivery._id))
      .collect();
    const billed = await billedQty(ctx, delivery.salesOrderId);
    const claimedHere = await claimedOnDelivery(ctx, delivery.salesOrderId);
    const billable = slipLines.some((slipLine) => {
      const orderLine = orderRows.find((row) => row._id === slipLine.salesOrderLineId);
      if (orderLine === undefined) return false;
      const room = unbilledQty(fulfilledOf(orderLine), billed.get(orderLine._id) ?? 0);
      const leftOnSlip = unbilledQty(slipLine.qty, claimedHere.get(slipLine._id) ?? 0);
      return Math.min(room, leftOnSlip) > 0;
    });
    return {
      invoices: invoices.map((invoice) => ({
        _id: invoice._id,
        docNumber: invoice.docNumber,
        status: invoice.status,
      })),
      billable,
    };
  },
});

async function claimedOnDelivery(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const invoices = await invoicesForOrder(ctx, salesOrderId);
  const open = new Set(
    invoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice._id),
  );
  const claimed = new Map<Id<"deliveryLines">, number>();
  for (const invoice of invoices) {
    if (!open.has(invoice._id)) continue;
    const lines = await invoiceLines(ctx, invoice._id);
    for (const line of lines) {
      if (line.deliveryLineId === undefined) continue;
      claimed.set(line.deliveryLineId, (claimed.get(line.deliveryLineId) ?? 0) + line.qty);
    }
  }
  return claimed;
}

export const get = query({
  args: { invoiceId: v.id("salesInvoices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const invoice = await ctx.db.get(args.invoiceId);
    if (invoice === null) return null;
    const customer = await ctx.db.get(invoice.customerId);
    const order = await ctx.db.get(invoice.salesOrderId);
    const quote = order === null ? null : await ctx.db.get(order.quoteId);
    const delivery = invoice.deliveryId === undefined ? null : await ctx.db.get(invoice.deliveryId);
    const lines = await invoiceLines(ctx, invoice._id);
    const totals = quoteTotals(lines, invoice.decimalPlaces);
    const intent = await ctx.db
      .query("journalIntents")
      .withIndex("by_source", (q) => q.eq("sourceType", "salesInvoice").eq("sourceId", invoice._id))
      .unique();
    return {
      invoice: {
        _id: invoice._id,
        docNumber: invoice.docNumber,
        status: invoice.status,
        customerId: invoice.customerId,
        customerName: customer?.name ?? "Customer",
        customerCode: customer?.code ?? "",
        salesOrderId: invoice.salesOrderId,
        orderNumber: order?.docNumber ?? "",
        quoteId: order?.quoteId ?? null,
        quoteNumber: quote?.docNumber ?? "",
        deliveryId: invoice.deliveryId ?? null,
        deliveryNumber: delivery?.docNumber ?? null,
        currency: invoice.currency,
        decimalPlaces: invoice.decimalPlaces,
        paymentTermsDays: invoice.paymentTermsDays,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        billTo: invoice.billTo ?? null,
        shipTo: invoice.shipTo ?? null,
        postedAt: invoice.postedAt ?? null,
      },
      lines,
      totals,
      breakdown: taxBreakdown(lines, invoice.decimalPlaces),
      intent:
        intent === null
          ? null
          : {
              _id: intent._id,
              type: intent.type,
              status: intent.status,
              period: intent.period,
              currency: intent.currency,
              amount: intent.amount,
              net: intent.net ?? null,
              tax: intent.tax ?? null,
            },
    };
  },
});

export const createFromOrder = auditedMutation({
  entity: "salesInvoices",
  action: "create",
  args: {
    salesOrderId: v.id("salesOrders"),
    /** `YYYY-MM-DD`. Stored as UTC midnight. */
    invoiceOn: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(invoiceOrderStatusError(order.status));
    const invoiceDate = invoiceDay(args.invoiceOn);
    const lines = await orderLines(ctx, order._id);
    const billed = await billedQty(ctx, order._id);
    const rows: ChargeRow[] = [];
    for (const line of lines) {
      const qty = unbilledQty(fulfilledOf(line), billed.get(line._id) ?? 0);
      if (qty === 0) continue;
      rows.push({ orderLine: line, qty });
    }
    const invoiceId = await insertInvoice(ctx, { order, invoiceDate, rows });
    const created = await requireInvoice(ctx, invoiceId);
    return {
      result: invoiceId,
      audit: {
        entityId: invoiceId,
        after: { docNumber: created.docNumber, salesOrderId: order._id, status: "draft" },
      },
    };
  },
});

export const createFromDelivery = auditedMutation({
  entity: "salesInvoices",
  action: "create",
  args: {
    deliveryId: v.id("deliveries"),
    /** `YYYY-MM-DD`. Stored as UTC midnight. */
    invoiceOn: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const delivery = await ctx.db.get(args.deliveryId);
    if (delivery === null) throw new ConvexError("Delivery not found.");
    if (delivery.status !== "shipped") {
      throw new ConvexError("Ship the delivery before invoicing it.");
    }
    const order = await requireOrder(ctx, delivery.salesOrderId);
    throwIf(invoiceOrderStatusError(order.status));
    const invoiceDate = invoiceDay(args.invoiceOn);
    const orderRows = await orderLines(ctx, order._id);
    const slipLines = await ctx.db
      .query("deliveryLines")
      .withIndex("by_delivery", (q) => q.eq("deliveryId", delivery._id))
      .collect();
    slipLines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
    const billed = await billedQty(ctx, order._id);
    const claimedHere = await claimedOnDelivery(ctx, order._id);
    const rows: ChargeRow[] = [];
    for (const slipLine of slipLines) {
      const orderLine = orderRows.find((row) => row._id === slipLine.salesOrderLineId);
      if (orderLine === undefined) throw new ConvexError("That line isn't on this order.");
      const room = unbilledQty(fulfilledOf(orderLine), billed.get(orderLine._id) ?? 0);
      const leftOnSlip = unbilledQty(slipLine.qty, claimedHere.get(slipLine._id) ?? 0);
      const qty = Math.min(room, leftOnSlip);
      if (qty <= 0) continue;
      rows.push({ orderLine, qty, deliveryLineId: slipLine._id });
    }
    const invoiceId = await insertInvoice(ctx, {
      order,
      deliveryId: delivery._id,
      invoiceDate,
      rows,
    });
    const created = await requireInvoice(ctx, invoiceId);
    return {
      result: invoiceId,
      audit: {
        entityId: invoiceId,
        after: {
          docNumber: created.docNumber,
          salesOrderId: order._id,
          deliveryId: delivery._id,
          status: "draft",
        },
      },
    };
  },
});

export const post = auditedMutation({
  entity: "salesInvoices",
  action: "post",
  args: { invoiceId: v.id("salesInvoices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const invoice = await requireInvoice(ctx, args.invoiceId);
    throwIf(postInvoiceError(invoice.status));
    const lines = await invoiceLines(ctx, invoice._id);
    if (lines.length === 0) throw new ConvexError("Add a line.");
    const order = await requireOrder(ctx, invoice.salesOrderId);
    const totals = quoteTotals(lines, invoice.decimalPlaces);
    const now = Date.now();
    const intentId = await ctx.db.insert("journalIntents", {
      type: "salesInvoice",
      sourceType: "salesInvoice",
      sourceId: invoice._id,
      status: "pending",
      period: invoicePeriod(invoice.invoiceDate),
      currency: invoice.currency,
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
    await ctx.db.patch(invoice._id, { status: "posted", postedAt: now, updatedAt: now });
    const orderRows = await orderLines(ctx, order._id);
    const billed = await billedQty(ctx, order._id);
    if (
      order.status === "fulfilling" &&
      orderCoveredByInvoices(
        orderRows.map((line) => ({
          qty: line.qty,
          fulfilledQty: line.fulfilledQty,
          billedQty: billed.get(line._id) ?? 0,
        })),
      )
    ) {
      const before = await salesOrderAudit(ctx, order);
      await ctx.db.patch(order._id, { status: "invoiced", updatedAt: now });
      const afterOrder = await requireOrder(ctx, order._id);
      await appendAudit(ctx, {
        entity: "salesOrders",
        action: "invoice",
        entityId: order._id,
        before,
        after: await salesOrderAudit(ctx, afterOrder),
      });
    }
    return {
      result: invoice._id,
      audit: {
        entityId: invoice._id,
        before: { status: "draft" },
        after: {
          status: "posted",
          intentId,
          amount: totals.gross,
          net: totals.net,
          tax: totals.tax,
        },
      },
    };
  },
});

export const voidInvoice = auditedMutation({
  entity: "salesInvoices",
  action: "void",
  args: { invoiceId: v.id("salesInvoices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const invoice = await requireInvoice(ctx, args.invoiceId);
    throwIf(voidInvoiceError(invoice.status));
    await ctx.db.patch(invoice._id, { status: "void", updatedAt: Date.now() });
    return {
      result: invoice._id,
      audit: {
        entityId: invoice._id,
        before: { status: "draft" },
        after: { status: "void" },
      },
    };
  },
});

export const markPaid = auditedMutation({
  entity: "salesInvoices",
  action: "pay",
  args: { invoiceId: v.id("salesInvoices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const invoice = await requireInvoice(ctx, args.invoiceId);
    throwIf(payInvoiceError(invoice.status));
    await ctx.db.patch(invoice._id, { status: "paid", updatedAt: Date.now() });
    return {
      result: invoice._id,
      audit: {
        entityId: invoice._id,
        before: { status: "posted" },
        after: { status: "paid" },
      },
    };
  },
});
