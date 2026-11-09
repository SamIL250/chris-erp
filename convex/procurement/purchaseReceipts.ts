import { ConvexError, v } from "convex/values";
import { purchaseReceiptLineError } from "../../lib/purchaseReceipts";
import { purchaseOrderReceivedStatus, type PurchaseOrderStatus } from "../../lib/purchaseOrders";
import { RECEIPT_REFERENCE_TYPE, normalizeReceiptNote } from "../../lib/receipts";
import { movingAverageCost } from "../../lib/stock";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { applyLastPurchasePrices } from "../catalog/productVendors";
import { recordGoodsReceiptIntent } from "../finance/journalIntents";
import { snapshotOf } from "../inventory/goodsReceipts";
import { postMovement, stockPosition } from "../inventory/stock";

/**
 * Goods receipts against a purchase order (PH2-22).
 *
 * Warehouse receives (`inventory.create`). Accepted quantity posts one
 * ledger receipt at the agreed unit price and stores the moving-average
 * cost for a later valuation. Rejected quantity is recorded and does
 * not enter stock, and a rejection-only receipt writes no journal
 * intent. Accepted quantity writes one pending goods-receipt intent at
 * the agreed price. The order moves to partially received or received
 * from the accepted total. Serials and lots can be named; their picker
 * is Phase 5.
 */

const LINE_CAP = 100;

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function progressFor(ctx: MutationCtx, purchaseOrderId: Id<"purchaseOrders">) {
  const receipts = await ctx.db
    .query("goodsReceipts")
    .withIndex("by_purchase_order", (q) => q.eq("purchaseOrderId", purchaseOrderId))
    .collect();
  const progress = new Map<string, { accepted: number; rejected: number }>();
  for (const receipt of receipts) {
    const lines = await ctx.db
      .query("goodsReceiptLines")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id))
      .collect();
    for (const line of lines) {
      if (line.purchaseOrderLineId === undefined) continue;
      const current = progress.get(line.purchaseOrderLineId) ?? { accepted: 0, rejected: 0 };
      current.accepted += line.qtyAccepted ?? 0;
      current.rejected += line.qtyRejected ?? 0;
      progress.set(line.purchaseOrderLineId, current);
    }
  }
  return progress;
}

export const receive = auditedMutation({
  entity: "goodsReceipts",
  action: "receive",
  args: {
    purchaseOrderId: v.id("purchaseOrders"),
    warehouseId: v.id("warehouses"),
    lines: v.array(
      v.object({
        purchaseOrderLineId: v.id("purchaseOrderLines"),
        qtyAccepted: v.number(),
        qtyRejected: v.number(),
        lotId: v.optional(v.id("lots")),
        serialIds: v.optional(v.array(v.id("serials"))),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "create");
    const order = await ctx.db.get(args.purchaseOrderId);
    if (order === null) throw new ConvexError("Purchase order not found.");
    const status = order.status as PurchaseOrderStatus;
    const orderLines = await ctx.db
      .query("purchaseOrderLines")
      .withIndex("by_order", (q) => q.eq("purchaseOrderId", order._id))
      .collect();
    const ordered = orderLines.reduce((sum, line) => sum + line.qty, 0);
    if (status !== "sent" && status !== "partiallyReceived") {
      const probe = purchaseOrderReceivedStatus(status, Math.max(ordered, 1), 1);
      if ("error" in probe) throw new ConvexError(probe.error);
    }
    const warehouse = await ctx.db.get(args.warehouseId);
    if (warehouse === null) throw new ConvexError("Warehouse not found.");
    if (!warehouse.active) {
      throw new ConvexError("That warehouse is inactive. Choose an active warehouse.");
    }
    const vendor = await ctx.db.get(order.vendorId);
    if (vendor === null) throw new ConvexError("Vendor not found.");
    if (args.lines.length === 0 || args.lines.length > LINE_CAP) {
      throw new ConvexError(
        args.lines.length === 0
          ? "Enter an accepted or a rejected quantity."
          : `A receipt can have at most ${LINE_CAP} lines.`,
      );
    }

    const progress = await progressFor(ctx, order._id);
    const seen = new Set<string>();
    const incoming: {
      line: (typeof orderLines)[number];
      qtyAccepted: number;
      qtyRejected: number;
      lotId?: Id<"lots">;
      serialIds?: Id<"serials">[];
    }[] = [];
    for (const input of args.lines) {
      if (seen.has(input.purchaseOrderLineId)) {
        throw new ConvexError("That line is already on this receipt.");
      }
      seen.add(input.purchaseOrderLineId);
      if (input.qtyAccepted === 0 && input.qtyRejected === 0) continue;
      const line = orderLines.find((row) => row._id === input.purchaseOrderLineId);
      if (line === undefined) throw new ConvexError("That line is not on this purchase order.");
      const already = progress.get(line._id)?.accepted ?? 0;
      throwIf(
        purchaseReceiptLineError({
          ordered: line.qty,
          alreadyAccepted: already,
          accepted: input.qtyAccepted,
          rejected: input.qtyRejected,
        }),
      );
      incoming.push({
        line,
        qtyAccepted: input.qtyAccepted,
        qtyRejected: input.qtyRejected,
        ...(input.lotId !== undefined ? { lotId: input.lotId } : {}),
        ...(input.serialIds !== undefined ? { serialIds: input.serialIds } : {}),
      });
    }
    if (incoming.length === 0) {
      throw new ConvexError("Enter an accepted or a rejected quantity.");
    }

    await ensureDefaultSequences(ctx);
    const number = await nextSequence(ctx, "goodsReceipt");
    const now = Date.now();
    const receiptId = await ctx.db.insert("goodsReceipts", {
      number,
      warehouseId: args.warehouseId,
      referenceNote: normalizeReceiptNote(`Purchase order ${order.docNumber}`),
      vendorId: order.vendorId,
      purchaseOrderId: order._id,
      createdAt: now,
    });

    let acceptedNow = 0;
    for (const input of incoming) {
      acceptedNow += input.qtyAccepted;
      const serialIds = input.serialIds ?? [];
      let movementId: Id<"stockMovements"> | undefined;
      let averageCost: number | undefined;
      if (input.qtyAccepted > 0) {
        const position = await stockPosition(ctx, {
          productId: input.line.productId,
          warehouseId: args.warehouseId,
          ...(input.line.variantId !== undefined ? { variantId: input.line.variantId } : {}),
        });
        averageCost = movingAverageCost({
          onHand: position.onHand,
          average: position.unitCost,
          qty: input.qtyAccepted,
          unitCost: input.line.unitPrice,
        });
        movementId = await postMovement(ctx, {
          type: "receipt",
          qty: input.qtyAccepted,
          productId: input.line.productId,
          ...(input.line.variantId !== undefined ? { variantId: input.line.variantId } : {}),
          warehouseId: args.warehouseId,
          ...(input.lotId !== undefined ? { lotId: input.lotId } : {}),
          ...(serialIds.length > 0 ? { serialIds } : {}),
          referenceType: RECEIPT_REFERENCE_TYPE,
          referenceId: receiptId,
          unitCost: input.line.unitPrice,
          actorId,
        });
      }
      await ctx.db.insert("goodsReceiptLines", {
        receiptId,
        productId: input.line.productId,
        ...(input.line.variantId !== undefined ? { variantId: input.line.variantId } : {}),
        ...(input.lotId !== undefined ? { lotId: input.lotId } : {}),
        serialIds,
        qty: input.qtyAccepted,
        qtyAccepted: input.qtyAccepted,
        qtyRejected: input.qtyRejected,
        purchaseOrderLineId: input.line._id,
        ...(input.qtyAccepted > 0 ? { unitCost: input.line.unitPrice } : {}),
        ...(averageCost !== undefined ? { averageCost } : {}),
        ...(movementId !== undefined ? { movementId } : {}),
      });
    }

    await applyLastPurchasePrices(
      ctx,
      order.vendorId,
      incoming
        .filter((input) => input.qtyAccepted > 0)
        .map((input) => ({ productId: input.line.productId, unitCost: input.line.unitPrice })),
    );
    await recordGoodsReceiptIntent(ctx, receiptId);

    let purchaseOrderStatus: PurchaseOrderStatus = status;
    if (acceptedNow > 0) {
      const already = [...progress.values()].reduce((sum, row) => sum + row.accepted, 0);
      const next = purchaseOrderReceivedStatus(status, ordered, already + acceptedNow);
      if ("error" in next) throw new ConvexError(next.error);
      purchaseOrderStatus = next.status;
      await ctx.db.patch(order._id, { status: next.status, updatedAt: now });
    }

    const after = await snapshotOf(ctx, receiptId);
    return {
      result: receiptId,
      audit: {
        entityId: receiptId,
        after: { ...after, purchaseOrderStatus },
      },
    };
  },
});
