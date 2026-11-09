import { ConvexError, v } from "convex/values";
import {
  creditInvoiceStatusError,
  creditQtyError,
  creditReasonError,
  postCreditError,
  restockError,
  uncreditedQty,
  voidCreditError,
} from "../../lib/creditNotes";
import { invoicePeriod } from "../../lib/invoices";
import { priceDayFromInput } from "../../lib/pricing";
import { quoteTotals, taxOnLine } from "../../lib/quotes";
import { latestUnitCost } from "../../lib/stock";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { postMovement } from "../inventory/stock";

/**
 * Credit notes (PH2-17). A draft reduces a posted or paid invoice.
 * A return may restock into the order's warehouse. An adjustment
 * does not. Posting writes one pending `creditNote` intent. Reads
 * are `sales.view`. Creating, posting, and voiding a draft are
 * `sales.create`, so warehouse cannot credit. A return that is still
 * open also holds its quantity, so this note cannot take it as well.
 */

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function requireInvoice(ctx: QueryCtx | MutationCtx, invoiceId: Id<"salesInvoices">) {
  const invoice = await ctx.db.get(invoiceId);
  if (invoice === null) throw new ConvexError("Invoice not found.");
  return invoice;
}

async function requireCredit(ctx: QueryCtx | MutationCtx, creditNoteId: Id<"creditNotes">) {
  const credit = await ctx.db.get(creditNoteId);
  if (credit === null) throw new ConvexError("Credit note not found.");
  return credit;
}

async function invoiceLines(ctx: QueryCtx | MutationCtx, invoiceId: Id<"salesInvoices">) {
  const lines = await ctx.db
    .query("salesInvoiceLines")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function creditLines(ctx: QueryCtx | MutationCtx, creditNoteId: Id<"creditNotes">) {
  const lines = await ctx.db
    .query("creditNoteLines")
    .withIndex("by_credit", (q) => q.eq("creditNoteId", creditNoteId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function notesForInvoice(ctx: QueryCtx | MutationCtx, invoiceId: Id<"salesInvoices">) {
  const notes = await ctx.db
    .query("creditNotes")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
  notes.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
  return notes;
}

/** Quantity already claimed by a draft or posted credit note, or by a return that is not credited yet. */
export async function creditedQty(ctx: QueryCtx | MutationCtx, invoiceId: Id<"salesInvoices">) {
  const notes = await notesForInvoice(ctx, invoiceId);
  const open = new Set(notes.filter((note) => note.status !== "void").map((note) => note._id));
  const credited = new Map<Id<"salesInvoiceLines">, number>();
  for (const note of notes) {
    if (!open.has(note._id)) continue;
    const lines = await creditLines(ctx, note._id);
    for (const line of lines) {
      credited.set(line.invoiceLineId, (credited.get(line.invoiceLineId) ?? 0) + line.qty);
    }
  }
  const returns = await ctx.db
    .query("salesReturns")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
  for (const row of returns) {
    if (row.status !== "requested" && row.status !== "received") continue;
    const held = await ctx.db
      .query("salesReturnLines")
      .withIndex("by_return", (q) => q.eq("salesReturnId", row._id))
      .collect();
    for (const line of held) {
      if (line.invoiceLineId === undefined) continue;
      credited.set(line.invoiceLineId, (credited.get(line.invoiceLineId) ?? 0) + line.qty);
    }
  }
  return credited;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const notes = await ctx.db.query("creditNotes").collect();
    const presented = [];
    for (const note of notes) {
      const customer = await ctx.db.get(note.customerId);
      const invoice = await ctx.db.get(note.invoiceId);
      const lines = await creditLines(ctx, note._id);
      presented.push({
        _id: note._id,
        docNumber: note.docNumber,
        status: note.status,
        kind: note.kind,
        restock: note.restock,
        customerName: customer?.name ?? "Customer",
        invoiceNumber: invoice?.docNumber ?? "",
        currency: note.currency,
        decimalPlaces: note.decimalPlaces,
        gross: quoteTotals(lines, note.decimalPlaces).gross,
        creditDate: note.creditDate,
        createdAt: note.createdAt,
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
    const notes = await notesForInvoice(ctx, args.invoiceId);
    if (invoice === null) return { credits: [], remaining: [] };
    const lines = await invoiceLines(ctx, invoice._id);
    const credited = await creditedQty(ctx, invoice._id);
    const open = invoice.status === "posted" || invoice.status === "paid";
    return {
      credits: notes.map((note) => ({
        _id: note._id,
        docNumber: note.docNumber,
        status: note.status,
        kind: note.kind,
      })),
      remaining: lines.map((line) => ({
        invoiceLineId: line._id,
        qty: open ? uncreditedQty(line.qty, credited.get(line._id) ?? 0) : 0,
      })),
    };
  },
});

export const get = query({
  args: { creditNoteId: v.id("creditNotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const credit = await ctx.db.get(args.creditNoteId);
    if (credit === null) return null;
    const customer = await ctx.db.get(credit.customerId);
    const invoice = await ctx.db.get(credit.invoiceId);
    const order = invoice === null ? null : await ctx.db.get(invoice.salesOrderId);
    const quote = order === null ? null : await ctx.db.get(order.quoteId);
    const delivery =
      invoice === null || invoice.deliveryId === undefined
        ? null
        : await ctx.db.get(invoice.deliveryId);
    const warehouse =
      credit.warehouseId === undefined ? null : await ctx.db.get(credit.warehouseId);
    const salesReturn =
      credit.salesReturnId === undefined ? null : await ctx.db.get(credit.salesReturnId);
    const lines = await creditLines(ctx, credit._id);
    const totals = quoteTotals(lines, credit.decimalPlaces);
    const intent = await ctx.db
      .query("journalIntents")
      .withIndex("by_source", (q) => q.eq("sourceType", "creditNote").eq("sourceId", credit._id))
      .unique();
    return {
      credit: {
        _id: credit._id,
        docNumber: credit.docNumber,
        status: credit.status,
        kind: credit.kind,
        restock: credit.restock,
        reason: credit.reason,
        customerId: credit.customerId,
        customerName: customer?.name ?? "Customer",
        customerCode: customer?.code ?? "",
        invoiceId: credit.invoiceId,
        invoiceNumber: invoice?.docNumber ?? "",
        salesOrderId: credit.salesOrderId,
        orderNumber: order?.docNumber ?? "",
        quoteId: order?.quoteId ?? null,
        quoteNumber: quote?.docNumber ?? "",
        deliveryId: invoice?.deliveryId ?? null,
        deliveryNumber: delivery?.docNumber ?? null,
        warehouseCode: warehouse?.code ?? null,
        warehouseName: warehouse?.name ?? null,
        salesReturnId: credit.salesReturnId ?? null,
        returnNumber: salesReturn?.docNumber ?? null,
        currency: credit.currency,
        decimalPlaces: credit.decimalPlaces,
        creditDate: credit.creditDate,
        postedAt: credit.postedAt ?? null,
      },
      lines,
      totals,
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

export const create = auditedMutation({
  entity: "creditNotes",
  action: "create",
  args: {
    invoiceId: v.id("salesInvoices"),
    /** `YYYY-MM-DD`. Stored as UTC midnight. */
    creditOn: v.string(),
    kind: v.union(v.literal("return"), v.literal("adjustment")),
    restock: v.boolean(),
    reason: v.string(),
    lines: v.array(v.object({ invoiceLineId: v.id("salesInvoiceLines"), qty: v.number() })),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const invoice = await requireInvoice(ctx, args.invoiceId);
    throwIf(creditInvoiceStatusError(invoice.status));
    throwIf(restockError(args.kind, args.restock));
    throwIf(creditReasonError(args.reason));
    const day = priceDayFromInput(args.creditOn);
    if ("error" in day) throw new ConvexError(day.error);
    const rows = await invoiceLines(ctx, invoice._id);
    const credited = await creditedQty(ctx, invoice._id);
    const chosen = new Map<Id<"salesInvoiceLines">, number>();
    for (const line of args.lines) {
      chosen.set(line.invoiceLineId, (chosen.get(line.invoiceLineId) ?? 0) + line.qty);
    }
    const charges: { line: Doc<"salesInvoiceLines">; qty: number }[] = [];
    for (const line of rows) {
      const qty = chosen.get(line._id);
      if (qty === undefined) continue;
      const remaining = uncreditedQty(line.qty, credited.get(line._id) ?? 0);
      throwIf(creditQtyError(qty, remaining));
      charges.push({ line, qty });
    }
    if (charges.length === 0) throw new ConvexError("Nothing on this invoice is left to credit.");
    await ensureDefaultSequences(ctx);
    const docNumber = await nextSequence(ctx, "creditNote");
    const now = Date.now();
    const creditNoteId = await ctx.db.insert("creditNotes", {
      docNumber,
      invoiceId: invoice._id,
      customerId: invoice.customerId,
      salesOrderId: invoice.salesOrderId,
      kind: args.kind,
      restock: args.kind === "return" && args.restock,
      status: "draft",
      currency: invoice.currency,
      decimalPlaces: invoice.decimalPlaces,
      creditDate: day.ms,
      reason: args.reason.trim(),
      createdAt: now,
      updatedAt: now,
    });
    let sort = 0;
    for (const charge of charges) {
      const priced = taxOnLine({
        unitPrice: charge.line.unitPrice,
        qty: charge.qty,
        decimalPlaces: invoice.decimalPlaces,
        rateBps: charge.line.rateBps,
        inclusive: charge.line.inclusive,
      });
      await ctx.db.insert("creditNoteLines", {
        creditNoteId,
        invoiceLineId: charge.line._id,
        salesOrderLineId: charge.line.salesOrderLineId,
        productId: charge.line.productId,
        ...(charge.line.variantId !== undefined ? { variantId: charge.line.variantId } : {}),
        description: charge.line.description,
        sku: charge.line.sku,
        qty: charge.qty,
        unitPrice: charge.line.unitPrice,
        discountPercent: charge.line.discountPercent,
        taxCategory: charge.line.taxCategory,
        ...(charge.line.taxRateId !== undefined ? { taxRateId: charge.line.taxRateId } : {}),
        rateBps: charge.line.rateBps,
        inclusive: charge.line.inclusive,
        net: priced.net,
        tax: priced.tax,
        gross: priced.gross,
        sort,
        createdAt: now,
      });
      sort += 1;
    }
    return {
      result: creditNoteId,
      audit: {
        entityId: creditNoteId,
        after: {
          docNumber,
          invoiceId: invoice._id,
          kind: args.kind,
          restock: args.kind === "return" && args.restock,
          status: "draft",
        },
      },
    };
  },
});

export const post = auditedMutation({
  entity: "creditNotes",
  action: "post",
  args: { creditNoteId: v.id("creditNotes") },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "create");
    const credit = await requireCredit(ctx, args.creditNoteId);
    throwIf(postCreditError(credit.status));
    const lines = await creditLines(ctx, credit._id);
    if (lines.length === 0) throw new ConvexError("Add a line.");
    const order = await ctx.db.get(credit.salesOrderId);
    if (order === null) throw new ConvexError("Order not found.");
    if (credit.restock && order.warehouseId === undefined) {
      throw new ConvexError("This order has no warehouse to put the goods back into.");
    }
    const totals = quoteTotals(lines, credit.decimalPlaces);
    const now = Date.now();
    const intentId = await ctx.db.insert("journalIntents", {
      type: "creditNote",
      sourceType: "creditNote",
      sourceId: credit._id,
      status: "pending",
      period: invoicePeriod(credit.creditDate),
      currency: credit.currency,
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
    await ctx.db.patch(credit._id, {
      status: "posted",
      postedAt: now,
      updatedAt: now,
      ...(credit.restock && order.warehouseId !== undefined
        ? { warehouseId: order.warehouseId }
        : {}),
    });
    const warehouseId = order.warehouseId;
    if (credit.restock && warehouseId !== undefined) {
      for (const line of lines) {
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
          referenceType: "creditNote",
          referenceId: credit._id,
          ...(unitCost !== undefined ? { unitCost } : {}),
          actorId,
        });
        await ctx.db.patch(line._id, { movementId });
      }
    }
    return {
      result: credit._id,
      audit: {
        entityId: credit._id,
        before: { status: "draft" },
        after: {
          status: "posted",
          intentId,
          amount: totals.gross,
          restock: credit.restock,
        },
      },
    };
  },
});

export const voidCredit = auditedMutation({
  entity: "creditNotes",
  action: "void",
  args: { creditNoteId: v.id("creditNotes") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const credit = await requireCredit(ctx, args.creditNoteId);
    throwIf(voidCreditError(credit.status));
    await ctx.db.patch(credit._id, { status: "void", updatedAt: Date.now() });
    return {
      result: credit._id,
      audit: {
        entityId: credit._id,
        before: { status: "draft" },
        after: { status: "void" },
      },
    };
  },
});
