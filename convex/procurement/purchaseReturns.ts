import { ConvexError, v } from "convex/values";
import {
  PURCHASE_RETURN_REFERENCE_TYPE,
  RETURN_LINE_CAP,
  debitNoteAmount,
  normalizeReturnReason,
  purchaseReturnQtyError,
  purchaseReturnReasonError,
  returnStockError,
} from "../../lib/purchaseReturns";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { recordDebitNoteIntent } from "../finance/journalIntents";
import { postMovement, stockPosition } from "../inventory/stock";

/**
 * Purchase returns (PH2-24).
 *
 * Warehouse returns goods that a receipt already put on hand
 * (`inventory.create`). Each line posts a stock issue at that receipt
 * line's unit cost. The document number is the debit note reference.
 * Sales and accountant can read the return and cannot post one. The
 * receipt, the purchase order, and the vendor statement stay as they
 * were. Posting writes one pending debit-note journal intent. The
 * vendor's credit is Phase 3.
 */

const LIST_CAP = 200;

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function returnedQty(
  ctx: QueryCtx | MutationCtx,
  goodsReceiptLineId: Id<"goodsReceiptLines">,
): Promise<number> {
  const rows = await ctx.db
    .query("purchaseReturnLines")
    .withIndex("by_receipt_line", (q) => q.eq("goodsReceiptLineId", goodsReceiptLineId))
    .collect();
  return rows.reduce((sum, row) => sum + row.qty, 0);
}

async function linesOf(ctx: QueryCtx | MutationCtx, purchaseReturnId: Id<"purchaseReturns">) {
  return await ctx.db
    .query("purchaseReturnLines")
    .withIndex("by_return", (q) => q.eq("purchaseReturnId", purchaseReturnId))
    .collect();
}

function lineView(line: Doc<"purchaseReturnLines">) {
  return {
    lineId: line._id,
    goodsReceiptLineId: line.goodsReceiptLineId,
    productId: line.productId,
    variantId: line.variantId ?? null,
    description: line.description,
    sku: line.sku,
    qty: line.qty,
    unitCost: line.unitCost ?? null,
    movementId: line.movementId,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "procurement", "view");
    const rows = await ctx.db.query("purchaseReturns").order("desc").take(LIST_CAP);
    const listed = [];
    for (const row of rows) {
      const lines = await linesOf(ctx, row._id);
      const receipt = await ctx.db.get(row.goodsReceiptId);
      const vendor = row.vendorId === undefined ? null : await ctx.db.get(row.vendorId);
      listed.push({
        _id: row._id,
        docNumber: row.docNumber,
        goodsReceiptId: row.goodsReceiptId,
        receiptNumber: receipt?.number ?? null,
        vendorName: vendor?.name ?? null,
        reason: row.reason,
        amount: debitNoteAmount(lines),
        createdAt: row.createdAt,
      });
    }
    return listed;
  },
});

export const get = query({
  args: { purchaseReturnId: v.id("purchaseReturns") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const row = await ctx.db.get(args.purchaseReturnId);
    if (row === null) return null;
    const lines = await linesOf(ctx, row._id);
    const receipt = await ctx.db.get(row.goodsReceiptId);
    const vendor = row.vendorId === undefined ? null : await ctx.db.get(row.vendorId);
    return {
      docNumber: row.docNumber,
      goodsReceiptId: row.goodsReceiptId,
      receiptNumber: receipt?.number ?? null,
      warehouseId: row.warehouseId,
      vendorId: row.vendorId ?? null,
      vendorName: vendor?.name ?? null,
      reason: row.reason,
      amount: debitNoteAmount(lines),
      createdAt: row.createdAt,
      lines: lines.map(lineView),
    };
  },
});

/** What this receipt can still send back, and the debit notes already raised. */
export const forReceipt = query({
  args: { goodsReceiptId: v.id("goodsReceipts") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const receipt = await ctx.db.get(args.goodsReceiptId);
    if (receipt === null) throw new ConvexError("Receipt not found.");
    const receiptLines = await ctx.db
      .query("goodsReceiptLines")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id))
      .collect();
    const lines = [];
    for (const line of receiptLines) {
      const returned = await returnedQty(ctx, line._id);
      lines.push({
        goodsReceiptLineId: line._id,
        receivedQty: line.qty,
        returnedQty: returned,
        returnableQty: Math.max(0, line.qty - returned),
      });
    }
    const returns = await ctx.db
      .query("purchaseReturns")
      .withIndex("by_receipt", (q) => q.eq("goodsReceiptId", receipt._id))
      .order("desc")
      .take(LIST_CAP);
    return {
      lines,
      returns: returns.map((row) => ({
        _id: row._id,
        docNumber: row.docNumber,
        createdAt: row.createdAt,
      })),
    };
  },
});

export const create = auditedMutation({
  entity: "purchaseReturns",
  action: "return",
  args: {
    goodsReceiptId: v.id("goodsReceipts"),
    reason: v.string(),
    lines: v.array(
      v.object({
        goodsReceiptLineId: v.id("goodsReceiptLines"),
        qty: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "create");
    throwIf(purchaseReturnReasonError(args.reason));
    const receipt = await ctx.db.get(args.goodsReceiptId);
    if (receipt === null) throw new ConvexError("Receipt not found.");
    if (args.lines.length === 0 || args.lines.length > RETURN_LINE_CAP) {
      throw new ConvexError(
        args.lines.length === 0
          ? "Enter a quantity to return."
          : `A return can have at most ${RETURN_LINE_CAP} lines.`,
      );
    }

    const receiptLines = await ctx.db
      .query("goodsReceiptLines")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id))
      .collect();
    const seen = new Set<string>();
    const incoming: { line: Doc<"goodsReceiptLines">; qty: number; sku: string; name: string }[] =
      [];
    for (const input of args.lines) {
      if (input.qty === 0) continue;
      if (seen.has(input.goodsReceiptLineId)) {
        throw new ConvexError("That line is already on this return.");
      }
      seen.add(input.goodsReceiptLineId);
      const line = receiptLines.find((row) => row._id === input.goodsReceiptLineId);
      if (line === undefined) throw new ConvexError("That line is not on this receipt.");
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new ConvexError("Product not found.");
      const already = await returnedQty(ctx, line._id);
      throwIf(
        purchaseReturnQtyError({
          received: line.qty,
          alreadyReturned: already,
          qty: input.qty,
        }),
      );
      incoming.push({ line, qty: input.qty, sku: product.sku, name: product.name });
    }
    if (incoming.length === 0) throw new ConvexError("Enter a quantity to return.");

    await ensureDefaultSequences(ctx);
    const docNumber = await nextSequence(ctx, "debitNote");
    const now = Date.now();
    const purchaseReturnId = await ctx.db.insert("purchaseReturns", {
      docNumber,
      goodsReceiptId: receipt._id,
      ...(receipt.vendorId !== undefined ? { vendorId: receipt.vendorId } : {}),
      warehouseId: receipt.warehouseId,
      reason: normalizeReturnReason(args.reason),
      createdAt: now,
    });

    for (const input of incoming) {
      const position = await stockPosition(ctx, {
        productId: input.line.productId,
        warehouseId: receipt.warehouseId,
        ...(input.line.variantId !== undefined ? { variantId: input.line.variantId } : {}),
      });
      const stockError = returnStockError({
        qty: input.qty,
        available: position.available,
        reserved: position.reserved,
      });
      if (stockError !== null) throw new ConvexError(`${input.sku}: ${stockError}`);
      const movementId = await postMovement(ctx, {
        type: "issue",
        qty: -input.qty,
        productId: input.line.productId,
        ...(input.line.variantId !== undefined ? { variantId: input.line.variantId } : {}),
        warehouseId: receipt.warehouseId,
        ...(input.line.lotId !== undefined ? { lotId: input.line.lotId } : {}),
        referenceType: PURCHASE_RETURN_REFERENCE_TYPE,
        referenceId: purchaseReturnId,
        ...(input.line.unitCost !== undefined ? { unitCost: input.line.unitCost } : {}),
        actorId,
      });
      await ctx.db.insert("purchaseReturnLines", {
        purchaseReturnId,
        goodsReceiptLineId: input.line._id,
        productId: input.line.productId,
        ...(input.line.variantId !== undefined ? { variantId: input.line.variantId } : {}),
        description: input.name,
        sku: input.sku,
        qty: input.qty,
        ...(input.line.unitCost !== undefined ? { unitCost: input.line.unitCost } : {}),
        movementId,
        createdAt: now,
      });
    }

    const lines = await linesOf(ctx, purchaseReturnId);
    await recordDebitNoteIntent(ctx, purchaseReturnId);
    return {
      result: purchaseReturnId,
      audit: {
        entityId: purchaseReturnId,
        after: {
          docNumber,
          goodsReceiptId: receipt._id,
          reason: normalizeReturnReason(args.reason),
          lines: lines.map((line) => ({
            goodsReceiptLineId: line.goodsReceiptLineId,
            qty: line.qty,
            movementId: line.movementId,
          })),
        },
      },
    };
  },
});
