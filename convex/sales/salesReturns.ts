import { ConvexError, v } from "convex/values";
import { creditQtyError } from "../../lib/creditNotes";
import { invoicePeriod } from "../../lib/invoices";
import { priceDayFromInput } from "../../lib/pricing";
import { quoteTotals, taxOnLine } from "../../lib/quotes";
import { fulfilledOf } from "../../lib/salesOrders";
import {
  cancelReturnError,
  creditReturnError,
  exchangeReturnError,
  receiveReturnError,
  returnableQty,
  returnInvoiceStatusError,
  returnOrderStatusError,
  returnQtyError,
  returnReasonError,
} from "../../lib/salesReturns";
import { latestUnitCost } from "../../lib/stock";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { adjustStock, postMovement, reserveStock } from "../inventory/stock";
import { creditedQty } from "./creditNotes";

/**
 * Sales returns (PH2-18). A request comes from a posted invoice or
 * from an order that has shipped. Receiving inspects each line into
 * the order's warehouse: restock, quarantine, or write-off. The
 * outcome is one posted credit note or one draft exchange order.
 * Reads are `sales.view`. The writes are `sales.create`, so warehouse
 * cannot open or receive a return. The ledger posts inside this
 * mutation and does not check a second permission.
 */

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function requireReturn(ctx: QueryCtx | MutationCtx, salesReturnId: Id<"salesReturns">) {
  const row = await ctx.db.get(salesReturnId);
  if (row === null) throw new ConvexError("Return not found.");
  return row;
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

async function linesOf(ctx: QueryCtx | MutationCtx, salesReturnId: Id<"salesReturns">) {
  const lines = await ctx.db
    .query("salesReturnLines")
    .withIndex("by_return", (q) => q.eq("salesReturnId", salesReturnId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function returnsForOrder(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const rows = await ctx.db
    .query("salesReturns")
    .withIndex("by_order", (q) => q.eq("salesOrderId", salesOrderId))
    .collect();
  rows.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
  return rows;
}

/** Quantity on non-cancelled returns for each order line. */
async function claimedByLine(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const claimed = new Map<Id<"salesOrderLines">, number>();
  const rows = await returnsForOrder(ctx, salesOrderId);
  for (const row of rows) {
    if (row.status === "cancelled") continue;
    const lines = await linesOf(ctx, row._id);
    for (const line of lines) {
      claimed.set(line.salesOrderLineId, (claimed.get(line.salesOrderLineId) ?? 0) + line.qty);
    }
  }
  return claimed;
}

async function openInvoices(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const invoices = await ctx.db
    .query("salesInvoices")
    .withIndex("by_order", (q) => q.eq("salesOrderId", salesOrderId))
    .collect();
  return invoices.filter((invoice) => invoice.status === "posted" || invoice.status === "paid");
}

type Charge = {
  orderLine: Doc<"salesOrderLines">;
  invoiceLineId?: Id<"salesInvoiceLines">;
  qty: number;
};

async function insertReturn(
  ctx: MutationCtx,
  source: {
    customerId: Id<"customers">;
    salesOrderId: Id<"salesOrders">;
    invoiceId?: Id<"salesInvoices">;
    currency: string;
    decimalPlaces: number;
    reason: string;
    charges: Charge[];
  },
) {
  await ensureDefaultSequences(ctx);
  const docNumber = await nextSequence(ctx, "rma");
  const now = Date.now();
  const salesReturnId = await ctx.db.insert("salesReturns", {
    docNumber,
    customerId: source.customerId,
    salesOrderId: source.salesOrderId,
    ...(source.invoiceId !== undefined ? { invoiceId: source.invoiceId } : {}),
    status: "requested",
    reason: source.reason.trim(),
    currency: source.currency,
    decimalPlaces: source.decimalPlaces,
    createdAt: now,
    updatedAt: now,
  });
  let sort = 0;
  for (const charge of source.charges) {
    await ctx.db.insert("salesReturnLines", {
      salesReturnId,
      salesOrderLineId: charge.orderLine._id,
      ...(charge.invoiceLineId !== undefined ? { invoiceLineId: charge.invoiceLineId } : {}),
      productId: charge.orderLine.productId,
      ...(charge.orderLine.variantId !== undefined
        ? { variantId: charge.orderLine.variantId }
        : {}),
      description: charge.orderLine.description,
      sku: charge.orderLine.sku,
      qty: charge.qty,
      unitPrice: charge.orderLine.unitPrice,
      sort,
      createdAt: now,
    });
    sort += 1;
  }
  return { salesReturnId, docNumber };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const rows = await ctx.db.query("salesReturns").collect();
    const presented = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      const order = await ctx.db.get(row.salesOrderId);
      const invoice = row.invoiceId === undefined ? null : await ctx.db.get(row.invoiceId);
      const lines = await linesOf(ctx, row._id);
      let amount = 0;
      for (const line of lines) amount += line.qty * line.unitPrice;
      presented.push({
        _id: row._id,
        docNumber: row.docNumber,
        status: row.status,
        customerName: customer?.name ?? "Customer",
        orderNumber: order?.docNumber ?? "",
        invoiceNumber: invoice?.docNumber ?? null,
        currency: row.currency,
        decimalPlaces: row.decimalPlaces,
        amount: Math.round(amount * 100) / 100,
        createdAt: row.createdAt,
      });
    }
    presented.sort((a, b) => b.createdAt - a.createdAt || a._id.localeCompare(b._id));
    return presented;
  },
});

export const forInvoice = query({
  args: { invoiceId: v.id("salesInvoices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const invoice = await ctx.db.get(args.invoiceId);
    const rows =
      invoice === null
        ? []
        : await ctx.db
            .query("salesReturns")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
            .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
    if (invoice === null) return { returns: [], remaining: [] };
    const lines = await invoiceLines(ctx, invoice._id);
    const order = await ctx.db.get(invoice.salesOrderId);
    const orderRows = order === null ? [] : await orderLines(ctx, order._id);
    const claimed = order === null ? new Map() : await claimedByLine(ctx, order._id);
    const credited = await creditedQty(ctx, invoice._id);
    const open = invoice.status === "posted" || invoice.status === "paid";
    return {
      returns: rows.map((row) => ({
        _id: row._id,
        docNumber: row.docNumber,
        status: row.status,
      })),
      remaining: lines.map((line) => {
        const orderLine = orderRows.find((row) => row._id === line.salesOrderLineId);
        const shipped =
          orderLine === undefined
            ? 0
            : returnableQty(fulfilledOf(orderLine), claimed.get(line.salesOrderLineId) ?? 0);
        const billed = returnableQty(line.qty, credited.get(line._id) ?? 0);
        const qty = Math.min(shipped, billed);
        return { invoiceLineId: line._id, qty: open ? qty : 0 };
      }),
    };
  },
});

export const forOrder = query({
  args: { salesOrderId: v.id("salesOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const order = await ctx.db.get(args.salesOrderId);
    const rows = order === null ? [] : await returnsForOrder(ctx, order._id);
    if (order === null) return { returns: [], remaining: [] };
    const lines = await orderLines(ctx, order._id);
    const claimed = await claimedByLine(ctx, order._id);
    const open = returnOrderStatusError(order.status) === null;
    return {
      returns: rows.map((row) => ({
        _id: row._id,
        docNumber: row.docNumber,
        status: row.status,
      })),
      remaining: lines.map((line) => ({
        salesOrderLineId: line._id,
        qty: open ? returnableQty(fulfilledOf(line), claimed.get(line._id) ?? 0) : 0,
      })),
    };
  },
});

export const get = query({
  args: { salesReturnId: v.id("salesReturns") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const row = await ctx.db.get(args.salesReturnId);
    if (row === null) return null;
    const customer = await ctx.db.get(row.customerId);
    const order = await ctx.db.get(row.salesOrderId);
    const quote = order === null ? null : await ctx.db.get(order.quoteId);
    const invoice = row.invoiceId === undefined ? null : await ctx.db.get(row.invoiceId);
    const credit = row.creditNoteId === undefined ? null : await ctx.db.get(row.creditNoteId);
    const exchange =
      row.exchangeOrderId === undefined ? null : await ctx.db.get(row.exchangeOrderId);
    const warehouse = row.warehouseId === undefined ? null : await ctx.db.get(row.warehouseId);
    const slips =
      order === null
        ? []
        : await ctx.db
            .query("deliveries")
            .withIndex("by_order", (q) => q.eq("salesOrderId", order._id))
            .collect();
    const openSlips = slips.filter((slip) => slip.status !== "cancelled");
    const delivery = openSlips.length === 1 ? openSlips[0] : null;
    return {
      salesReturn: {
        _id: row._id,
        docNumber: row.docNumber,
        status: row.status,
        reason: row.reason,
        customerId: row.customerId,
        customerName: customer?.name ?? "Customer",
        customerCode: customer?.code ?? "",
        salesOrderId: row.salesOrderId,
        orderNumber: order?.docNumber ?? "",
        quoteId: order?.quoteId ?? null,
        quoteNumber: quote?.docNumber ?? "",
        invoiceId: row.invoiceId ?? null,
        invoiceNumber: invoice?.docNumber ?? null,
        creditNoteId: row.creditNoteId ?? null,
        creditNumber: credit?.docNumber ?? null,
        exchangeOrderId: row.exchangeOrderId ?? null,
        exchangeNumber: exchange?.docNumber ?? null,
        deliveryId: delivery?._id ?? null,
        deliveryNumber: delivery?.docNumber ?? null,
        deliveryCount: openSlips.length,
        warehouseCode: warehouse?.code ?? null,
        currency: row.currency,
        decimalPlaces: row.decimalPlaces,
        receivedAt: row.receivedAt ?? null,
        createdAt: row.createdAt,
      },
      lines: await linesOf(ctx, row._id),
    };
  },
});

export const createFromInvoice = auditedMutation({
  entity: "salesReturns",
  action: "create",
  args: {
    invoiceId: v.id("salesInvoices"),
    reason: v.string(),
    lines: v.array(v.object({ invoiceLineId: v.id("salesInvoiceLines"), qty: v.number() })),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const invoice = await requireInvoice(ctx, args.invoiceId);
    throwIf(returnInvoiceStatusError(invoice.status));
    throwIf(returnReasonError(args.reason));
    const order = await requireOrder(ctx, invoice.salesOrderId);
    const rows = await invoiceLines(ctx, invoice._id);
    const orderRows = await orderLines(ctx, order._id);
    const credited = await creditedQty(ctx, invoice._id);
    const claimed = await claimedByLine(ctx, order._id);
    const chosen = new Map<Id<"salesInvoiceLines">, number>();
    for (const line of args.lines) {
      chosen.set(line.invoiceLineId, (chosen.get(line.invoiceLineId) ?? 0) + line.qty);
    }
    const charges: Charge[] = [];
    for (const line of rows) {
      const qty = chosen.get(line._id);
      if (qty === undefined) continue;
      const orderLine = orderRows.find((row) => row._id === line.salesOrderLineId);
      if (orderLine === undefined) throw new ConvexError("That line is not on the order.");
      const shipped = returnableQty(fulfilledOf(orderLine), claimed.get(orderLine._id) ?? 0);
      const billed = returnableQty(line.qty, credited.get(line._id) ?? 0);
      throwIf(returnQtyError(qty, Math.min(shipped, billed)));
      charges.push({ orderLine, invoiceLineId: line._id, qty });
    }
    if (charges.length === 0) throw new ConvexError("Nothing on this invoice is left to return.");
    const inserted = await insertReturn(ctx, {
      customerId: invoice.customerId,
      salesOrderId: order._id,
      invoiceId: invoice._id,
      currency: invoice.currency,
      decimalPlaces: invoice.decimalPlaces,
      reason: args.reason,
      charges,
    });
    return {
      result: inserted.salesReturnId,
      audit: {
        entityId: inserted.salesReturnId,
        after: { docNumber: inserted.docNumber, invoiceId: invoice._id, status: "requested" },
      },
    };
  },
});

export const createFromOrder = auditedMutation({
  entity: "salesReturns",
  action: "create",
  args: {
    salesOrderId: v.id("salesOrders"),
    reason: v.string(),
    lines: v.array(v.object({ salesOrderLineId: v.id("salesOrderLines"), qty: v.number() })),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(returnOrderStatusError(order.status));
    throwIf(returnReasonError(args.reason));
    const rows = await orderLines(ctx, order._id);
    const claimed = await claimedByLine(ctx, order._id);
    const chosen = new Map<Id<"salesOrderLines">, number>();
    for (const line of args.lines) {
      chosen.set(line.salesOrderLineId, (chosen.get(line.salesOrderLineId) ?? 0) + line.qty);
    }
    const charges: Charge[] = [];
    for (const line of rows) {
      const qty = chosen.get(line._id);
      if (qty === undefined) continue;
      throwIf(returnQtyError(qty, returnableQty(fulfilledOf(line), claimed.get(line._id) ?? 0)));
      charges.push({ orderLine: line, qty });
    }
    if (charges.length === 0) throw new ConvexError("Nothing on this order is left to return.");
    const invoices = await openInvoices(ctx, order._id);
    let invoiceId: Id<"salesInvoices"> | undefined;
    if (invoices.length === 1) {
      const invoice = invoices[0];
      if (invoice !== undefined) {
        const billed = await invoiceLines(ctx, invoice._id);
        const credited = await creditedQty(ctx, invoice._id);
        let covers = true;
        for (const charge of charges) {
          const match = billed.find((line) => line.salesOrderLineId === charge.orderLine._id);
          const left =
            match === undefined ? 0 : returnableQty(match.qty, credited.get(match._id) ?? 0);
          if (match === undefined || charge.qty > left) {
            covers = false;
            break;
          }
          charge.invoiceLineId = match._id;
        }
        if (covers) invoiceId = invoice._id;
        if (!covers) {
          for (const charge of charges) charge.invoiceLineId = undefined;
        }
      }
    }
    const inserted = await insertReturn(ctx, {
      customerId: order.customerId,
      salesOrderId: order._id,
      ...(invoiceId !== undefined ? { invoiceId } : {}),
      currency: order.currency,
      decimalPlaces: order.decimalPlaces,
      reason: args.reason,
      charges,
    });
    return {
      result: inserted.salesReturnId,
      audit: {
        entityId: inserted.salesReturnId,
        after: { docNumber: inserted.docNumber, salesOrderId: order._id, status: "requested" },
      },
    };
  },
});

export const receive = auditedMutation({
  entity: "salesReturns",
  action: "receive",
  args: {
    salesReturnId: v.id("salesReturns"),
    lines: v.array(
      v.object({
        salesReturnLineId: v.id("salesReturnLines"),
        disposition: v.union(v.literal("restock"), v.literal("quarantine"), v.literal("writeOff")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "create");
    const row = await requireReturn(ctx, args.salesReturnId);
    throwIf(receiveReturnError(row.status));
    const lines = await linesOf(ctx, row._id);
    const chosen = new Map<Id<"salesReturnLines">, "restock" | "quarantine" | "writeOff">();
    for (const line of args.lines) {
      if (chosen.has(line.salesReturnLineId)) {
        throw new ConvexError("Inspect each line once.");
      }
      chosen.set(line.salesReturnLineId, line.disposition);
    }
    if (chosen.size !== lines.length) throw new ConvexError("Inspect every line.");
    for (const line of lines) {
      if (!chosen.has(line._id)) throw new ConvexError("Inspect every line.");
    }
    const order = await requireOrder(ctx, row.salesOrderId);
    if (order.warehouseId === undefined) {
      throw new ConvexError("This order has no warehouse to receive the goods into.");
    }
    const warehouseId = order.warehouseId;
    const now = Date.now();
    for (const line of lines) {
      const disposition = chosen.get(line._id);
      if (disposition === undefined) throw new ConvexError("Inspect every line.");
      const movements = await ctx.db
        .query("stockMovements")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", line.productId).eq("warehouseId", warehouseId),
        )
        .collect();
      const unitCost = latestUnitCost(movements);
      const movementId = await postMovement(ctx, {
        type: "receipt",
        qty: line.qty,
        productId: line.productId,
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
        warehouseId,
        referenceType: "salesReturn",
        referenceId: row._id,
        ...(unitCost !== undefined ? { unitCost } : {}),
        actorId,
      });
      let holdMovementId: Id<"stockMovements"> | undefined;
      let writeOffMovementId: Id<"stockMovements"> | undefined;
      if (disposition === "quarantine") {
        holdMovementId = await reserveStock(ctx, {
          productId: line.productId,
          ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
          warehouseId,
          qty: line.qty,
          referenceType: "salesReturn",
          referenceId: row._id,
          actorId,
        });
      } else if (disposition === "writeOff") {
        // Receipt and removal net to zero on hand. The credit note is the
        // posting. This is not the manual stock-adjustment intent.
        writeOffMovementId = await adjustStock(ctx, {
          productId: line.productId,
          ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
          warehouseId,
          qty: -line.qty,
          reason: "writeOff",
          note: `Return ${row.docNumber}`,
          referenceType: "salesReturn",
          referenceId: row._id,
          ...(unitCost !== undefined ? { unitCost } : {}),
          actorId,
        });
      } else if (disposition !== "restock") {
        const unreachable: never = disposition;
        throw new ConvexError(unreachable);
      }
      await ctx.db.patch(line._id, {
        disposition,
        movementId,
        ...(holdMovementId !== undefined ? { holdMovementId } : {}),
        ...(writeOffMovementId !== undefined ? { writeOffMovementId } : {}),
      });
    }
    await ctx.db.patch(row._id, {
      status: "received",
      warehouseId,
      receivedAt: now,
      updatedAt: now,
    });
    return {
      result: row._id,
      audit: {
        entityId: row._id,
        before: { status: "requested" },
        after: { status: "received", warehouseId },
      },
    };
  },
});

export const credit = auditedMutation({
  entity: "salesReturns",
  action: "credit",
  args: {
    salesReturnId: v.id("salesReturns"),
    /** `YYYY-MM-DD`. Stored as UTC midnight. */
    creditOn: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await requireReturn(ctx, args.salesReturnId);
    throwIf(creditReturnError(row.status, row.invoiceId !== undefined));
    if (row.invoiceId === undefined) {
      throw new ConvexError("This return has no invoice to credit. Exchange it instead.");
    }
    const invoice = await requireInvoice(ctx, row.invoiceId);
    throwIf(returnInvoiceStatusError(invoice.status));
    const day = priceDayFromInput(args.creditOn);
    if ("error" in day) throw new ConvexError(day.error);
    const lines = await linesOf(ctx, row._id);
    if (lines.length === 0) throw new ConvexError("Add a line.");
    const billed = await invoiceLines(ctx, invoice._id);
    const credited = await creditedQty(ctx, invoice._id);
    for (const line of lines) {
      if (line.invoiceLineId === undefined) {
        throw new ConvexError("This return has no invoice to credit. Exchange it instead.");
      }
      const source = billed.find((billedLine) => billedLine._id === line.invoiceLineId);
      if (source === undefined) throw new ConvexError("That line is not on the invoice.");
      const already = (credited.get(source._id) ?? 0) - line.qty;
      throwIf(creditQtyError(line.qty, returnableQty(source.qty, already)));
    }
    await ensureDefaultSequences(ctx);
    const docNumber = await nextSequence(ctx, "creditNote");
    const now = Date.now();
    const restock = lines.every((line) => line.disposition === "restock");
    const creditNoteId = await ctx.db.insert("creditNotes", {
      docNumber,
      invoiceId: invoice._id,
      customerId: invoice.customerId,
      salesOrderId: invoice.salesOrderId,
      kind: "return",
      restock,
      status: "posted",
      currency: invoice.currency,
      decimalPlaces: invoice.decimalPlaces,
      creditDate: day.ms,
      reason: row.reason,
      salesReturnId: row._id,
      ...(restock && row.warehouseId !== undefined ? { warehouseId: row.warehouseId } : {}),
      postedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const pricedLines = [];
    let sort = 0;
    for (const line of lines) {
      const source = billed.find((billedLine) => billedLine._id === line.invoiceLineId);
      if (source === undefined || line.invoiceLineId === undefined) {
        throw new ConvexError("That line is not on the invoice.");
      }
      const priced = taxOnLine({
        unitPrice: source.unitPrice,
        qty: line.qty,
        decimalPlaces: invoice.decimalPlaces,
        rateBps: source.rateBps,
        inclusive: source.inclusive,
      });
      await ctx.db.insert("creditNoteLines", {
        creditNoteId,
        invoiceLineId: source._id,
        salesOrderLineId: source.salesOrderLineId,
        productId: source.productId,
        ...(source.variantId !== undefined ? { variantId: source.variantId } : {}),
        description: source.description,
        sku: source.sku,
        qty: line.qty,
        unitPrice: source.unitPrice,
        discountPercent: source.discountPercent,
        taxCategory: source.taxCategory,
        ...(source.taxRateId !== undefined ? { taxRateId: source.taxRateId } : {}),
        rateBps: source.rateBps,
        inclusive: source.inclusive,
        net: priced.net,
        tax: priced.tax,
        gross: priced.gross,
        sort,
        createdAt: now,
      });
      pricedLines.push({ line, source, priced });
      sort += 1;
    }
    const totals = quoteTotals(
      pricedLines.map((entry) => entry.priced),
      invoice.decimalPlaces,
    );
    await ctx.db.insert("journalIntents", {
      type: "creditNote",
      sourceType: "creditNote",
      sourceId: creditNoteId,
      status: "pending",
      period: invoicePeriod(day.ms),
      currency: invoice.currency,
      amount: totals.gross,
      net: totals.net,
      tax: totals.tax,
      lines: pricedLines.map((entry) => ({
        productId: entry.source.productId,
        ...(entry.source.variantId !== undefined ? { variantId: entry.source.variantId } : {}),
        description: entry.source.description,
        qty: entry.line.qty,
        unitPrice: entry.source.unitPrice,
        net: entry.priced.net,
        tax: entry.priced.tax,
        amount: entry.priced.gross,
      })),
      createdAt: now,
    });
    await ctx.db.patch(row._id, { status: "credited", creditNoteId, updatedAt: now });
    return {
      result: row._id,
      audit: {
        entityId: row._id,
        before: { status: "received" },
        after: { status: "credited", creditNoteId, docNumber, amount: totals.gross },
      },
    };
  },
});

export const exchange = auditedMutation({
  entity: "salesReturns",
  action: "exchange",
  args: { salesReturnId: v.id("salesReturns") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await requireReturn(ctx, args.salesReturnId);
    throwIf(exchangeReturnError(row.status));
    const order = await requireOrder(ctx, row.salesOrderId);
    const sourceLines = await orderLines(ctx, order._id);
    const lines = await linesOf(ctx, row._id);
    if (lines.length === 0) throw new ConvexError("Add a line.");
    await ensureDefaultSequences(ctx);
    const docNumber = await nextSequence(ctx, "salesOrder");
    const now = Date.now();
    const exchangeOrderId = await ctx.db.insert("salesOrders", {
      docNumber,
      customerId: order.customerId,
      quoteId: order.quoteId,
      status: "draft",
      channel: "manual",
      currency: order.currency,
      decimalPlaces: order.decimalPlaces,
      paymentTermsDays: order.paymentTermsDays,
      ...(order.billTo !== undefined ? { billTo: order.billTo } : {}),
      ...(order.shipTo !== undefined ? { shipTo: order.shipTo } : {}),
      notes: `Exchange for ${row.docNumber}`,
      createdAt: now,
      updatedAt: now,
    });
    let sort = 0;
    for (const line of lines) {
      const source = sourceLines.find((orderLine) => orderLine._id === line.salesOrderLineId);
      if (source === undefined) throw new ConvexError("That line is not on the order.");
      const priced = taxOnLine({
        unitPrice: source.unitPrice,
        qty: line.qty,
        decimalPlaces: order.decimalPlaces,
        rateBps: source.rateBps,
        inclusive: source.inclusive,
      });
      await ctx.db.insert("salesOrderLines", {
        salesOrderId: exchangeOrderId,
        quoteLineId: source.quoteLineId,
        productId: source.productId,
        ...(source.variantId !== undefined ? { variantId: source.variantId } : {}),
        description: source.description,
        sku: source.sku,
        qty: line.qty,
        unitPrice: source.unitPrice,
        discountPercent: source.discountPercent,
        taxCategory: source.taxCategory,
        ...(source.taxRateId !== undefined ? { taxRateId: source.taxRateId } : {}),
        rateBps: source.rateBps,
        inclusive: source.inclusive,
        net: priced.net,
        tax: priced.tax,
        gross: priced.gross,
        reservedQty: 0,
        fulfilledQty: 0,
        backorder: false,
        sort,
        createdAt: now,
      });
      sort += 1;
    }
    await ctx.db.patch(row._id, { status: "exchanged", exchangeOrderId, updatedAt: now });
    return {
      result: row._id,
      audit: {
        entityId: row._id,
        before: { status: "received" },
        after: { status: "exchanged", exchangeOrderId, docNumber },
      },
    };
  },
});

export const cancel = auditedMutation({
  entity: "salesReturns",
  action: "cancel",
  args: { salesReturnId: v.id("salesReturns") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await requireReturn(ctx, args.salesReturnId);
    throwIf(cancelReturnError(row.status));
    await ctx.db.patch(row._id, { status: "cancelled", updatedAt: Date.now() });
    return {
      result: row._id,
      audit: {
        entityId: row._id,
        before: { status: "requested" },
        after: { status: "cancelled" },
      },
    };
  },
});
