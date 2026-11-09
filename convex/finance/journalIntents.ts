import { ConvexError } from "convex/values";
import { intentPeriod } from "../../lib/deliveries";
import { intentLineAmount, intentTotal } from "../../lib/journalIntents";
import { adjustmentReasonLabel } from "../../lib/stock";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Journal intent backlog (PH2-26).
 *
 * Shipments, sales invoices, credit notes, and vendor bills already
 * write a pending row. A goods receipt writes one for quantity that
 * entered stock. A purchase return writes a debit note. A manual stock
 * adjustment writes one signed row. A rejection-only receipt changes
 * no inventory, so it writes nothing. A sales-return write-off nets to
 * zero on hand inside that receive and is not a second adjustment.
 * Payments and the posting engine stay Phase 3. `status` stays pending.
 *
 * Currency is the purchase order's when the receipt names one, otherwise
 * the vendor's, otherwise the company base currency. With no company
 * record the base is USD, the same default the first company save uses.
 */

const LIST_CAP = 200;

const FALLBACK_BASE_CURRENCY = "USD";

export async function organizationBaseCurrency(ctx: QueryCtx | MutationCtx): Promise<string> {
  const org = await ctx.db
    .query("organizations")
    .withIndex("by_active", (q) => q.eq("active", true))
    .unique();
  return org?.baseCurrency ?? FALLBACK_BASE_CURRENCY;
}

async function documentCurrency(ctx: MutationCtx, receipt: Doc<"goodsReceipts">): Promise<string> {
  if (receipt.purchaseOrderId !== undefined) {
    const order = await ctx.db.get(receipt.purchaseOrderId);
    if (order === null) throw new ConvexError("Purchase order not found.");
    return order.currency;
  }
  if (receipt.vendorId !== undefined) {
    const vendor = await ctx.db.get(receipt.vendorId);
    if (vendor === null) throw new ConvexError("Vendor not found.");
    return vendor.currency;
  }
  return await organizationBaseCurrency(ctx);
}

/** One pending goods-receipt intent. A receipt that accepted nothing writes none. */
export async function recordGoodsReceiptIntent(
  ctx: MutationCtx,
  receiptId: Id<"goodsReceipts">,
): Promise<void> {
  const receipt = await ctx.db.get(receiptId);
  if (receipt === null) throw new ConvexError("Receipt not found.");
  const lines = await ctx.db
    .query("goodsReceiptLines")
    .withIndex("by_receipt", (q) => q.eq("receiptId", receiptId))
    .collect();
  const intentLines = [];
  for (const line of lines) {
    if (!(line.qty > 0)) continue;
    const product = await ctx.db.get(line.productId);
    if (product === null) throw new ConvexError("Product not found.");
    const amount = intentLineAmount(line.qty, line.unitCost);
    intentLines.push({
      productId: line.productId,
      ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
      description: product.name,
      qty: line.qty,
      ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
      amount,
    });
  }
  if (intentLines.length === 0) return;
  await ctx.db.insert("journalIntents", {
    type: "goodsReceipt",
    sourceType: "goodsReceipt",
    sourceId: receiptId,
    status: "pending",
    period: intentPeriod(receipt.createdAt),
    currency: await documentCurrency(ctx, receipt),
    amount: intentTotal(intentLines.map((line) => line.amount)),
    lines: intentLines,
    createdAt: receipt.createdAt,
  });
}

/** One pending debit-note intent for a purchase return, including a zero cost. */
export async function recordDebitNoteIntent(
  ctx: MutationCtx,
  purchaseReturnId: Id<"purchaseReturns">,
): Promise<void> {
  const row = await ctx.db.get(purchaseReturnId);
  if (row === null) throw new ConvexError("Purchase return not found.");
  const receipt = await ctx.db.get(row.goodsReceiptId);
  if (receipt === null) throw new ConvexError("Receipt not found.");
  const lines = await ctx.db
    .query("purchaseReturnLines")
    .withIndex("by_return", (q) => q.eq("purchaseReturnId", purchaseReturnId))
    .collect();
  const intentLines = lines.map((line) => {
    const amount = intentLineAmount(line.qty, line.unitCost);
    return {
      productId: line.productId,
      ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
      description: line.description,
      qty: line.qty,
      ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
      amount,
    };
  });
  await ctx.db.insert("journalIntents", {
    type: "debitNote",
    sourceType: "purchaseReturn",
    sourceId: purchaseReturnId,
    status: "pending",
    period: intentPeriod(row.createdAt),
    currency: await documentCurrency(ctx, receipt),
    amount: intentTotal(intentLines.map((line) => line.amount)),
    lines: intentLines,
    createdAt: row.createdAt,
  });
}

/**
 * One pending stock-adjustment intent. The caller is the public adjust
 * mutation. A sales-return write-off uses the stock helper directly and
 * is not recorded here.
 */
export async function recordStockAdjustmentIntent(
  ctx: MutationCtx,
  movementId: Id<"stockMovements">,
): Promise<void> {
  const movement = await ctx.db.get(movementId);
  if (movement === null) throw new ConvexError("Adjustment was not recorded.");
  if (movement.reason === undefined) throw new ConvexError("An adjustment needs a reason.");
  const product = await ctx.db.get(movement.productId);
  if (product === null) throw new ConvexError("Product not found.");
  const amount = intentLineAmount(movement.qty, movement.unitCost);
  await ctx.db.insert("journalIntents", {
    type: "stockAdjustment",
    sourceType: "stockAdjustment",
    sourceId: movementId,
    status: "pending",
    period: intentPeriod(movement.createdAt),
    currency: await organizationBaseCurrency(ctx),
    amount,
    lines: [
      {
        productId: movement.productId,
        ...(movement.variantId !== undefined ? { variantId: movement.variantId } : {}),
        description: `${product.name} · ${adjustmentReasonLabel(movement.reason)}`,
        qty: movement.qty,
        ...(movement.unitCost !== undefined ? { unitCost: movement.unitCost } : {}),
        amount,
      },
    ],
    createdAt: movement.createdAt,
  });
}

async function sourceOf(
  ctx: QueryCtx,
  row: Doc<"journalIntents">,
): Promise<{ number: string; href: string | null }> {
  switch (row.sourceType) {
    case "delivery": {
      const id = row.sourceId as Id<"deliveries">;
      const doc = await ctx.db.get(id);
      return {
        number: doc?.docNumber ?? "Delivery",
        href: doc === null ? null : `/sales/deliveries/${id}`,
      };
    }
    case "salesInvoice": {
      const id = row.sourceId as Id<"salesInvoices">;
      const doc = await ctx.db.get(id);
      return {
        number: doc?.docNumber ?? "Invoice",
        href: doc === null ? null : `/sales/invoices/${id}`,
      };
    }
    case "creditNote": {
      const id = row.sourceId as Id<"creditNotes">;
      const doc = await ctx.db.get(id);
      return {
        number: doc?.docNumber ?? "Credit note",
        href: doc === null ? null : `/sales/credit-notes/${id}`,
      };
    }
    case "vendorBill": {
      const id = row.sourceId as Id<"vendorBills">;
      const doc = await ctx.db.get(id);
      return {
        number: doc?.docNumber ?? "Vendor bill",
        href: doc === null ? null : `/procurement/bills/${id}`,
      };
    }
    case "goodsReceipt": {
      const id = row.sourceId as Id<"goodsReceipts">;
      const doc = await ctx.db.get(id);
      return {
        number: doc?.number ?? "Goods receipt",
        href: doc === null ? null : `/inventory/receipts/${id}`,
      };
    }
    case "purchaseReturn": {
      const id = row.sourceId as Id<"purchaseReturns">;
      const doc = await ctx.db.get(id);
      return {
        number: doc?.docNumber ?? "Debit note",
        href: doc === null ? null : `/procurement/returns/${id}`,
      };
    }
    case "stockAdjustment": {
      const id = row.sourceId as Id<"stockMovements">;
      const movement = await ctx.db.get(id);
      return {
        number: movement === null ? "Adjustment" : (row.lines[0]?.description ?? "Adjustment"),
        href: null,
      };
    }
    default: {
      const unreachable: never = row.sourceType;
      return unreachable;
    }
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "finance", "view");
    const rows = await ctx.db.query("journalIntents").order("desc").take(LIST_CAP);
    const listed = [];
    for (const row of rows) {
      const source = await sourceOf(ctx, row);
      listed.push({
        _id: row._id,
        type: row.type,
        number: source.number,
        href: source.href,
        period: row.period,
        currency: row.currency,
        amount: row.amount,
        status: row.status,
        createdAt: row.createdAt,
      });
    }
    return listed;
  },
});
