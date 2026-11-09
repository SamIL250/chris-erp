import { ConvexError, v } from "convex/values";
import {
  creditOnTrail,
  deliveryOnTrail,
  invoiceOnTrail,
  returnOnTrail,
  type DocFlowDoc,
  type SalesDocKind,
} from "../../lib/docFlow";
import { requirePermission } from "../_lib/permissions";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * The linked documents of one sale (PH2-27). `sales.view`, so warehouse
 * can read the trail on a delivery. One document is the current page.
 * Payment is always absent until Phase 3 records one.
 */

const args = {
  quoteId: v.optional(v.id("quotes")),
  salesOrderId: v.optional(v.id("salesOrders")),
  deliveryId: v.optional(v.id("deliveries")),
  invoiceId: v.optional(v.id("salesInvoices")),
  creditNoteId: v.optional(v.id("creditNotes")),
  salesReturnId: v.optional(v.id("salesReturns")),
};

type Current = {
  kind: SalesDocKind;
  id: string;
  orderId: Id<"salesOrders"> | null;
  pinnedDeliveryId: Id<"deliveries"> | null;
};

function doc(id: string, number: string): DocFlowDoc {
  return { id, number };
}

async function resolve(
  ctx: QueryCtx,
  input: {
    quoteId?: Id<"quotes">;
    salesOrderId?: Id<"salesOrders">;
    deliveryId?: Id<"deliveries">;
    invoiceId?: Id<"salesInvoices">;
    creditNoteId?: Id<"creditNotes">;
    salesReturnId?: Id<"salesReturns">;
  },
): Promise<Current | null> {
  const given = [
    input.quoteId,
    input.salesOrderId,
    input.deliveryId,
    input.invoiceId,
    input.creditNoteId,
    input.salesReturnId,
  ].filter((id) => id !== undefined);
  if (given.length !== 1) throw new ConvexError("Open one document.");

  if (input.quoteId !== undefined) {
    const quote = await ctx.db.get(input.quoteId);
    if (quote === null) return null;
    return {
      kind: "quote",
      id: quote._id,
      orderId: quote.salesOrderId ?? null,
      pinnedDeliveryId: null,
    };
  }
  if (input.salesOrderId !== undefined) {
    const order = await ctx.db.get(input.salesOrderId);
    if (order === null) return null;
    return { kind: "order", id: order._id, orderId: order._id, pinnedDeliveryId: null };
  }
  if (input.deliveryId !== undefined) {
    const delivery = await ctx.db.get(input.deliveryId);
    if (delivery === null) return null;
    return {
      kind: "delivery",
      id: delivery._id,
      orderId: delivery.salesOrderId,
      pinnedDeliveryId: null,
    };
  }
  if (input.invoiceId !== undefined) {
    const invoice = await ctx.db.get(input.invoiceId);
    if (invoice === null) return null;
    return {
      kind: "invoice",
      id: invoice._id,
      orderId: invoice.salesOrderId,
      pinnedDeliveryId: invoice.deliveryId ?? null,
    };
  }
  if (input.creditNoteId !== undefined) {
    const credit = await ctx.db.get(input.creditNoteId);
    if (credit === null) return null;
    const invoice = await ctx.db.get(credit.invoiceId);
    return {
      kind: "creditNote",
      id: credit._id,
      orderId: credit.salesOrderId,
      pinnedDeliveryId: invoice?.deliveryId ?? null,
    };
  }
  if (input.salesReturnId !== undefined) {
    const row = await ctx.db.get(input.salesReturnId);
    if (row === null) return null;
    const invoice = row.invoiceId === undefined ? null : await ctx.db.get(row.invoiceId);
    return {
      kind: "salesReturn",
      id: row._id,
      orderId: row.salesOrderId,
      pinnedDeliveryId: invoice?.deliveryId ?? null,
    };
  }
  throw new ConvexError("Open one document.");
}

export const get = query({
  args,
  handler: async (ctx, input) => {
    await requirePermission(ctx, "sales", "view");
    const current = await resolve(ctx, input);
    if (current === null) return null;

    const order = current.orderId === null ? null : await ctx.db.get(current.orderId);
    const quoteRow =
      order === null
        ? current.kind === "quote"
          ? await ctx.db.get(current.id as Id<"quotes">)
          : null
        : await ctx.db.get(order.quoteId);
    const quote = quoteRow === null ? null : doc(quoteRow._id, quoteRow.docNumber);

    if (order === null) {
      return {
        currentKind: current.kind,
        currentId: current.id,
        quote,
        order: null,
        deliveries: [],
        pinnedDelivery: null,
        invoices: [],
        credits: [],
        returns: [],
        exchanges: [],
        payment: null,
      };
    }

    const deliveryRows = await ctx.db
      .query("deliveries")
      .withIndex("by_order", (q) => q.eq("salesOrderId", order._id))
      .collect();
    const deliveries = deliveryRows
      .filter((row) =>
        deliveryOnTrail(row.status, current.kind === "delivery" && row._id === current.id),
      )
      .map((row) => doc(row._id, row.docNumber))
      .sort((a, b) => a.number.localeCompare(b.number));

    const invoiceRows = await ctx.db
      .query("salesInvoices")
      .withIndex("by_order", (q) => q.eq("salesOrderId", order._id))
      .collect();
    const invoices = invoiceRows
      .filter((row) =>
        invoiceOnTrail(row.status, current.kind === "invoice" && row._id === current.id),
      )
      .map((row) => doc(row._id, row.docNumber))
      .sort((a, b) => a.number.localeCompare(b.number));

    const credits: DocFlowDoc[] = [];
    for (const invoice of invoiceRows) {
      const notes = await ctx.db
        .query("creditNotes")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      for (const note of notes) {
        if (!creditOnTrail(note.status, current.kind === "creditNote" && note._id === current.id)) {
          continue;
        }
        credits.push(doc(note._id, note.docNumber));
      }
    }
    credits.sort((a, b) => a.number.localeCompare(b.number));

    const returnRows = await ctx.db
      .query("salesReturns")
      .withIndex("by_order", (q) => q.eq("salesOrderId", order._id))
      .collect();
    const returns = returnRows
      .filter((row) =>
        returnOnTrail(row.status, current.kind === "salesReturn" && row._id === current.id),
      )
      .map((row) => doc(row._id, row.docNumber))
      .sort((a, b) => a.number.localeCompare(b.number));

    const exchanges: DocFlowDoc[] = [];
    const seen = new Set<string>();
    for (const row of returnRows) {
      if (row.exchangeOrderId === undefined) continue;
      if (!returnOnTrail(row.status, current.kind === "salesReturn" && row._id === current.id)) {
        continue;
      }
      if (seen.has(row.exchangeOrderId)) continue;
      seen.add(row.exchangeOrderId);
      const exchange = await ctx.db.get(row.exchangeOrderId);
      if (exchange === null) continue;
      exchanges.push(doc(exchange._id, exchange.docNumber));
    }
    exchanges.sort((a, b) => a.number.localeCompare(b.number));

    const pinnedRow =
      current.pinnedDeliveryId === null ? null : await ctx.db.get(current.pinnedDeliveryId);
    const pinnedDelivery = pinnedRow === null ? null : doc(pinnedRow._id, pinnedRow.docNumber);

    return {
      currentKind: current.kind,
      currentId: current.id,
      quote,
      order: doc(order._id, order.docNumber),
      deliveries,
      pinnedDelivery,
      invoices,
      credits,
      returns,
      exchanges,
      payment: null,
    };
  },
});
