import { ConvexError, v } from "convex/values";
import {
  RECEIPT_LINE_CAP,
  RECEIPT_REFERENCE_TYPE,
  normalizeReceiptNote,
  receiptNoteError,
} from "../../lib/receipts";
import { movementQtyError, unitCostError } from "../../lib/stock";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { applyLastPurchasePrices } from "../catalog/productVendors";
import { recordGoodsReceiptIntent } from "../finance/journalIntents";
import { postMovement } from "./stock";

/**
 * Manual goods receipt (PH1-22).
 *
 * `create` posts the document and one ledger receipt per line in the
 * same transaction. A line that fails rolls the whole intake back.
 * There is no draft. Receiving against a purchase order is
 * `purchaseReceipts.receive`. An optional vendor (PH2-04) records who
 * supplied the goods and, when a line has a unit cost, updates that
 * product's last purchase price. Quantity that enters stock writes one
 * pending goods-receipt journal intent. A correction is a later
 * adjustment, not an edit here.
 */

const LIST_CAP = 200;

type LineInput = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  lotId?: Id<"lots">;
  serialIds?: Id<"serials">[];
  qty: number;
  unitCost?: number;
};

const LINE_FIELDS = {
  productId: v.id("products"),
  variantId: v.optional(v.id("variants")),
  lotId: v.optional(v.id("lots")),
  serialIds: v.optional(v.array(v.id("serials"))),
  qty: v.number(),
  unitCost: v.optional(v.number()),
};

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

function assertHeader(lines: LineInput[], referenceNote: string | undefined) {
  throwIf(receiptNoteError(referenceNote));
  if (lines.length === 0) throw new ConvexError("Add at least one line.");
  if (lines.length > RECEIPT_LINE_CAP) {
    throw new ConvexError(`A receipt can have at most ${RECEIPT_LINE_CAP} lines.`);
  }
  const seen = new Set<string>();
  for (const line of lines) {
    throwIf(movementQtyError("receipt", line.qty));
    throwIf(unitCostError(line.unitCost));
    const key = `${line.productId}:${line.variantId ?? ""}:${line.lotId ?? ""}`;
    if (seen.has(key)) throw new ConvexError("That product is already on this receipt.");
    seen.add(key);
  }
}

async function linesOf(ctx: QueryCtx | MutationCtx, receiptId: Id<"goodsReceipts">) {
  return await ctx.db
    .query("goodsReceiptLines")
    .withIndex("by_receipt", (q) => q.eq("receiptId", receiptId))
    .collect();
}

export async function snapshotOf(ctx: QueryCtx | MutationCtx, receiptId: Id<"goodsReceipts">) {
  const receipt = await ctx.db.get(receiptId);
  if (receipt === null) throw new ConvexError("Receipt not found.");
  const lines = await linesOf(ctx, receiptId);
  const vendor = receipt.vendorId === undefined ? null : await ctx.db.get(receipt.vendorId);
  const purchaseOrder =
    receipt.purchaseOrderId === undefined ? null : await ctx.db.get(receipt.purchaseOrderId);
  return {
    number: receipt.number,
    warehouseId: receipt.warehouseId,
    referenceNote: receipt.referenceNote,
    vendorId: receipt.vendorId ?? null,
    vendor:
      vendor === null ? null : { code: vendor.code, name: vendor.name, active: vendor.active },
    purchaseOrderId: purchaseOrder?._id ?? null,
    purchaseOrderNumber: purchaseOrder?.docNumber ?? null,
    createdAt: receipt.createdAt,
    lines: lines.map((line) => ({
      lineId: line._id,
      productId: line.productId,
      variantId: line.variantId,
      lotId: line.lotId,
      serialIds: line.serialIds,
      qty: line.qty,
      unitCost: line.unitCost,
      qtyAccepted: line.qtyAccepted ?? null,
      qtyRejected: line.qtyRejected ?? null,
      averageCost: line.averageCost ?? null,
      purchaseOrderLineId: line.purchaseOrderLineId ?? null,
      movementId: line.movementId ?? null,
    })),
  };
}

export const create = auditedMutation({
  entity: "goodsReceipts",
  action: "create",
  args: {
    warehouseId: v.id("warehouses"),
    referenceNote: v.string(),
    vendorId: v.optional(v.id("vendors")),
    lines: v.array(v.object(LINE_FIELDS)),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "create");
    assertHeader(args.lines, args.referenceNote);
    if (args.vendorId !== undefined) {
      const vendor = await ctx.db.get(args.vendorId);
      if (vendor === null) throw new ConvexError("Vendor not found.");
    }
    await ensureDefaultSequences(ctx);
    const number = await nextSequence(ctx, "goodsReceipt");
    const receiptId = await ctx.db.insert("goodsReceipts", {
      number,
      warehouseId: args.warehouseId,
      referenceNote: normalizeReceiptNote(args.referenceNote),
      ...(args.vendorId !== undefined ? { vendorId: args.vendorId } : {}),
      createdAt: Date.now(),
    });

    for (const line of args.lines) {
      const movementId = await postMovement(ctx, {
        type: "receipt",
        qty: line.qty,
        productId: line.productId,
        variantId: line.variantId,
        warehouseId: args.warehouseId,
        lotId: line.lotId,
        serialIds: line.serialIds,
        referenceType: RECEIPT_REFERENCE_TYPE,
        referenceId: receiptId,
        unitCost: line.unitCost,
        actorId,
      });
      await ctx.db.insert("goodsReceiptLines", {
        receiptId,
        productId: line.productId,
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
        ...(line.lotId !== undefined ? { lotId: line.lotId } : {}),
        serialIds: line.serialIds ?? [],
        qty: line.qty,
        ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
        movementId,
      });
    }

    if (args.vendorId !== undefined) {
      await applyLastPurchasePrices(ctx, args.vendorId, args.lines);
    }
    await recordGoodsReceiptIntent(ctx, receiptId);

    return {
      result: receiptId,
      audit: { entityId: receiptId, after: await snapshotOf(ctx, receiptId) },
    };
  },
});

export const get = query({
  args: { receiptId: v.id("goodsReceipts") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    return await snapshotOf(ctx, args.receiptId);
  },
});

export const list = query({
  args: { warehouseId: v.optional(v.id("warehouses")) },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    const warehouseId = args.warehouseId;
    const rows =
      warehouseId === undefined
        ? await ctx.db.query("goodsReceipts").order("desc").take(LIST_CAP)
        : await ctx.db
            .query("goodsReceipts")
            .withIndex("by_warehouse", (q) => q.eq("warehouseId", warehouseId))
            .order("desc")
            .take(LIST_CAP);
    return rows.map((row) => ({
      receiptId: row._id,
      number: row.number,
      warehouseId: row.warehouseId,
      referenceNote: row.referenceNote,
      createdAt: row.createdAt,
    }));
  },
});
