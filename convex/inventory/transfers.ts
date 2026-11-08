import { ConvexError, v } from "convex/values";
import {
  TRANSFER_LINE_CAP,
  TRANSFER_REFERENCE_TYPE,
  draftBlock,
  normalizeTransferNote,
  outstandingQty,
  receiveBlock,
  transferNoteError,
  transferPairError,
  transferQtyError,
} from "../../lib/transfers";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { postMovement, stockPosition } from "./stock";

/**
 * Stock transfers (PH1-21).
 *
 * A draft names the source, the destination, and the lines. Shipping
 * posts one transfer-out per line and moves the document to in-transit
 * — the goods are no longer on hand at the source, and not yet at the
 * destination. Each receipt posts a transfer-in for the quantity that
 * arrived. The document stays in transit until every line is fully
 * received. Cancel is draft-only.
 *
 * Ship and receive call `postMovement` in this transaction, so a line
 * that does not fit rolls the whole document back.
 */

const QTY_EPSILON = 1e-9;
const LIST_CAP = 200;

type LineInput = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  lotId?: Id<"lots">;
  serialIds?: Id<"serials">[];
  qty: number;
};

type ReadCtx = QueryCtx | MutationCtx;

const LINE_FIELDS = {
  productId: v.id("products"),
  variantId: v.optional(v.id("variants")),
  lotId: v.optional(v.id("lots")),
  serialIds: v.optional(v.array(v.id("serials"))),
  qty: v.number(),
};

function qtyText(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function linesOf(ctx: ReadCtx, transferId: Id<"stockTransfers">) {
  return await ctx.db
    .query("stockTransferLines")
    .withIndex("by_transfer", (q) => q.eq("transferId", transferId))
    .collect();
}

async function requireTransfer(ctx: ReadCtx, transferId: Id<"stockTransfers">) {
  const transfer = await ctx.db.get(transferId);
  if (transfer === null) throw new ConvexError("Transfer not found.");
  return transfer;
}

async function activeWarehouse(ctx: ReadCtx, warehouseId: Id<"warehouses">) {
  const warehouse = await ctx.db.get(warehouseId);
  if (warehouse === null) throw new ConvexError("Warehouse not found.");
  if (!warehouse.active) {
    throw new ConvexError("That warehouse is inactive. Choose an active warehouse.");
  }
  return warehouse;
}

async function assertLine(
  ctx: ReadCtx,
  line: LineInput,
  seenKeys: Set<string>,
  seenSerials: Set<string>,
) {
  throwIf(transferQtyError(line.qty));
  const product = await ctx.db.get(line.productId);
  if (product === null) throw new ConvexError("Product not found.");

  const variantCount = await ctx.db
    .query("variants")
    .withIndex("by_product", (q) => q.eq("productId", line.productId))
    .take(1);
  if (line.variantId === undefined) {
    if (variantCount.length > 0) {
      throw new ConvexError("This product has variants — name the variant this line is for.");
    }
  } else {
    const variant = await ctx.db.get(line.variantId);
    if (variant === null) throw new ConvexError("Variant not found.");
    if (variant.productId !== line.productId) {
      throw new ConvexError("That variant belongs to a different product.");
    }
  }

  if (line.lotId !== undefined) {
    const lot = await ctx.db.get(line.lotId);
    if (lot === null) throw new ConvexError("Lot not found.");
    if (lot.productId !== line.productId) {
      throw new ConvexError("That lot belongs to a different product.");
    }
    if (
      line.variantId !== undefined &&
      lot.variantId !== undefined &&
      lot.variantId !== line.variantId
    ) {
      throw new ConvexError("That lot is for a different variant.");
    }
    if (line.variantId === undefined && lot.variantId !== undefined) {
      throw new ConvexError("That lot is for a specific variant.");
    }
  }

  const serialIds = line.serialIds ?? [];
  if (serialIds.length > 0 && serialIds.length !== line.qty) {
    throw new ConvexError(
      `Quantity must match the number of serials (${serialIds.length} serial${serialIds.length === 1 ? "" : "s"}, quantity ${line.qty}).`,
    );
  }
  const onLine = new Set<string>();
  for (const serialId of serialIds) {
    if (onLine.has(serialId) || seenSerials.has(serialId)) {
      throw new ConvexError("The same serial is listed more than once.");
    }
    onLine.add(serialId);
    seenSerials.add(serialId);
    const serial = await ctx.db.get(serialId);
    if (serial === null) throw new ConvexError("Serial not found.");
    if (serial.productId !== line.productId) {
      throw new ConvexError("That serial belongs to a different product.");
    }
    if (
      line.variantId !== undefined &&
      serial.variantId !== undefined &&
      serial.variantId !== line.variantId
    ) {
      throw new ConvexError("That serial belongs to a different variant.");
    }
    if (line.variantId === undefined && serial.variantId !== undefined) {
      throw new ConvexError("That serial is for a specific variant.");
    }
  }

  const key = `${line.productId}:${line.variantId ?? ""}:${line.lotId ?? ""}`;
  if (seenKeys.has(key)) throw new ConvexError("That product is already on this transfer.");
  seenKeys.add(key);
}

async function assertLines(ctx: ReadCtx, lines: LineInput[]) {
  if (lines.length === 0) throw new ConvexError("Add at least one line.");
  if (lines.length > TRANSFER_LINE_CAP) {
    throw new ConvexError(`A transfer can have at most ${TRANSFER_LINE_CAP} lines.`);
  }
  const seenKeys = new Set<string>();
  const seenSerials = new Set<string>();
  for (const line of lines) await assertLine(ctx, line, seenKeys, seenSerials);
}

async function insertLines(ctx: MutationCtx, transferId: Id<"stockTransfers">, lines: LineInput[]) {
  for (const line of lines) {
    await ctx.db.insert("stockTransferLines", {
      transferId,
      productId: line.productId,
      ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
      ...(line.lotId !== undefined ? { lotId: line.lotId } : {}),
      serialIds: line.serialIds ?? [],
      receivedSerialIds: [],
      qty: line.qty,
      receivedQty: 0,
    });
  }
}

async function snapshotOf(ctx: ReadCtx, transfer: Doc<"stockTransfers">) {
  const lines = await linesOf(ctx, transfer._id);
  return {
    number: transfer.number,
    status: transfer.status,
    fromWarehouseId: transfer.fromWarehouseId,
    toWarehouseId: transfer.toWarehouseId,
    note: transfer.note,
    shippedAt: transfer.shippedAt,
    receivedAt: transfer.receivedAt,
    lines: lines.map((line) => ({
      lineId: line._id,
      productId: line.productId,
      variantId: line.variantId,
      lotId: line.lotId,
      qty: line.qty,
      receivedQty: line.receivedQty,
      outstanding: outstandingQty(line.qty, line.receivedQty),
      serialIds: line.serialIds,
      receivedSerialIds: line.receivedSerialIds,
      unitCost: line.unitCost,
    })),
  };
}

function checkHeader(fromWarehouseId: string, toWarehouseId: string, note: string | undefined) {
  throwIf(transferPairError(fromWarehouseId, toWarehouseId));
  throwIf(transferNoteError(note));
}

const HEADER_ARGS = {
  fromWarehouseId: v.id("warehouses"),
  toWarehouseId: v.id("warehouses"),
  note: v.optional(v.string()),
  lines: v.array(v.object(LINE_FIELDS)),
};

export const create = auditedMutation({
  entity: "stockTransfers",
  action: "create",
  args: HEADER_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "create");
    checkHeader(args.fromWarehouseId, args.toWarehouseId, args.note);
    await activeWarehouse(ctx, args.fromWarehouseId);
    await activeWarehouse(ctx, args.toWarehouseId);
    await assertLines(ctx, args.lines);
    await ensureDefaultSequences(ctx);
    const number = await nextSequence(ctx, "stockTransfer");
    const now = Date.now();
    const note = normalizeTransferNote(args.note);
    const transferId = await ctx.db.insert("stockTransfers", {
      number,
      status: "draft",
      fromWarehouseId: args.fromWarehouseId,
      toWarehouseId: args.toWarehouseId,
      ...(note !== undefined ? { note } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await insertLines(ctx, transferId, args.lines);
    const transfer = await requireTransfer(ctx, transferId);
    return {
      result: transferId,
      audit: { entityId: transferId, after: await snapshotOf(ctx, transfer) },
    };
  },
});

export const update = auditedMutation({
  entity: "stockTransfers",
  action: "update",
  args: { transferId: v.id("stockTransfers"), ...HEADER_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "edit");
    const transfer = await requireTransfer(ctx, args.transferId);
    throwIf(draftBlock(transfer.status));
    const before = await snapshotOf(ctx, transfer);
    checkHeader(args.fromWarehouseId, args.toWarehouseId, args.note);
    await activeWarehouse(ctx, args.fromWarehouseId);
    await activeWarehouse(ctx, args.toWarehouseId);
    await assertLines(ctx, args.lines);
    const note = normalizeTransferNote(args.note);
    await ctx.db.replace(transfer._id, {
      number: transfer.number,
      status: transfer.status,
      fromWarehouseId: args.fromWarehouseId,
      toWarehouseId: args.toWarehouseId,
      ...(note !== undefined ? { note } : {}),
      createdAt: transfer.createdAt,
      updatedAt: Date.now(),
    });
    const existing = await linesOf(ctx, transfer._id);
    for (const line of existing) await ctx.db.delete(line._id);
    await insertLines(ctx, transfer._id, args.lines);
    const fresh = await requireTransfer(ctx, transfer._id);
    return {
      result: transfer._id,
      audit: { entityId: transfer._id, before, after: await snapshotOf(ctx, fresh) },
    };
  },
});

export const cancel = auditedMutation({
  entity: "stockTransfers",
  action: "update",
  args: { transferId: v.id("stockTransfers") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "delete");
    const transfer = await requireTransfer(ctx, args.transferId);
    throwIf(draftBlock(transfer.status));
    const before = await snapshotOf(ctx, transfer);
    await ctx.db.patch(transfer._id, { status: "cancelled", updatedAt: Date.now() });
    const fresh = await requireTransfer(ctx, transfer._id);
    return {
      result: transfer._id,
      audit: { entityId: transfer._id, before, after: await snapshotOf(ctx, fresh) },
    };
  },
});

export const ship = auditedMutation({
  entity: "stockTransfers",
  action: "update",
  args: { transferId: v.id("stockTransfers") },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "edit");
    const transfer = await requireTransfer(ctx, args.transferId);
    throwIf(draftBlock(transfer.status));
    const before = await snapshotOf(ctx, transfer);
    await activeWarehouse(ctx, transfer.fromWarehouseId);
    await activeWarehouse(ctx, transfer.toWarehouseId);
    const lines = await linesOf(ctx, transfer._id);
    if (lines.length === 0) throw new ConvexError("Add at least one line.");

    const movementIds: Id<"stockMovements">[] = [];
    for (const line of lines) {
      const position = await stockPosition(ctx, {
        productId: line.productId,
        warehouseId: transfer.fromWarehouseId,
        variantId: line.variantId,
      });
      if (line.qty > position.available + QTY_EPSILON) {
        throw new ConvexError(
          position.available > QTY_EPSILON
            ? `Only ${qtyText(position.available)} available to transfer.`
            : "Nothing available to transfer.",
        );
      }
      const movementId = await postMovement(ctx, {
        type: "transferOut",
        qty: -line.qty,
        productId: line.productId,
        variantId: line.variantId,
        warehouseId: transfer.fromWarehouseId,
        lotId: line.lotId,
        serialIds: line.serialIds,
        referenceType: TRANSFER_REFERENCE_TYPE,
        referenceId: transfer._id,
        unitCost: position.unitCost,
        actorId,
      });
      movementIds.push(movementId);
      if (position.unitCost !== undefined) {
        await ctx.db.patch(line._id, { unitCost: position.unitCost });
      }
    }

    const shippedAt = Date.now();
    await ctx.db.patch(transfer._id, { status: "inTransit", shippedAt, updatedAt: shippedAt });
    const fresh = await requireTransfer(ctx, transfer._id);
    return {
      result: transfer._id,
      audit: {
        entityId: transfer._id,
        before,
        after: { ...(await snapshotOf(ctx, fresh)), movementIds },
      },
    };
  },
});

export const receive = auditedMutation({
  entity: "stockTransfers",
  action: "update",
  args: {
    transferId: v.id("stockTransfers"),
    lines: v.array(
      v.object({
        lineId: v.id("stockTransferLines"),
        qty: v.number(),
        serialIds: v.optional(v.array(v.id("serials"))),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "edit");
    const transfer = await requireTransfer(ctx, args.transferId);
    throwIf(receiveBlock(transfer.status));
    if (args.lines.length === 0) throw new ConvexError("Name the lines being received.");
    const before = await snapshotOf(ctx, transfer);
    await activeWarehouse(ctx, transfer.toWarehouseId);

    const lines = await linesOf(ctx, transfer._id);
    const byId = new Map(lines.map((line) => [line._id as string, line]));
    const seen = new Set<string>();
    const movementIds: Id<"stockMovements">[] = [];

    for (const request of args.lines) {
      if (seen.has(request.lineId)) throw new ConvexError("That line is listed more than once.");
      seen.add(request.lineId);
      const line = byId.get(request.lineId);
      if (line === undefined) throw new ConvexError("That line is not on this transfer.");
      throwIf(transferQtyError(request.qty));
      const remaining = outstandingQty(line.qty, line.receivedQty);
      if (request.qty > remaining + QTY_EPSILON) {
        throw new ConvexError(
          remaining > QTY_EPSILON
            ? `Only ${qtyText(remaining)} is still in transit.`
            : "Nothing of that line is still in transit.",
        );
      }

      const serialIds = request.serialIds ?? [];
      if (line.serialIds.length > 0) {
        if (serialIds.length !== request.qty) {
          throw new ConvexError(
            `Quantity must match the number of serials (${serialIds.length} serial${serialIds.length === 1 ? "" : "s"}, quantity ${request.qty}).`,
          );
        }
        const named = new Set<string>();
        for (const serialId of serialIds) {
          if (named.has(serialId))
            throw new ConvexError("The same serial is listed more than once.");
          named.add(serialId);
          if (!line.serialIds.some((id) => id === serialId)) {
            throw new ConvexError("That serial is not on this line.");
          }
          if (line.receivedSerialIds.some((id) => id === serialId)) {
            throw new ConvexError("That serial was already received.");
          }
        }
      } else if (serialIds.length > 0) {
        throw new ConvexError("This line is not serial-tracked.");
      }

      const movementId = await postMovement(ctx, {
        type: "transferIn",
        qty: request.qty,
        productId: line.productId,
        variantId: line.variantId,
        warehouseId: transfer.toWarehouseId,
        lotId: line.lotId,
        serialIds,
        referenceType: TRANSFER_REFERENCE_TYPE,
        referenceId: transfer._id,
        unitCost: line.unitCost,
        actorId,
      });
      movementIds.push(movementId);
      const receivedQty =
        request.qty >= remaining - QTY_EPSILON ? line.qty : line.receivedQty + request.qty;
      await ctx.db.patch(line._id, {
        receivedQty,
        receivedSerialIds: [...line.receivedSerialIds, ...serialIds],
      });
    }

    const freshLines = await linesOf(ctx, transfer._id);
    const done = freshLines.every(
      (line) => outstandingQty(line.qty, line.receivedQty) <= QTY_EPSILON,
    );
    const now = Date.now();
    await ctx.db.patch(transfer._id, {
      status: done ? "received" : "inTransit",
      ...(done ? { receivedAt: now } : {}),
      updatedAt: now,
    });
    const fresh = await requireTransfer(ctx, transfer._id);
    return {
      result: transfer._id,
      audit: {
        entityId: transfer._id,
        before,
        after: { ...(await snapshotOf(ctx, fresh)), movementIds },
      },
    };
  },
});

export const get = query({
  args: { transferId: v.id("stockTransfers") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    const transfer = await requireTransfer(ctx, args.transferId);
    return await snapshotOf(ctx, transfer);
  },
});

export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("inTransit"),
        v.literal("received"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    const status = args.status;
    const rows =
      status === undefined
        ? (
            await Promise.all(
              (["draft", "inTransit", "received", "cancelled"] as const).map((value) =>
                ctx.db
                  .query("stockTransfers")
                  .withIndex("by_status", (q) => q.eq("status", value))
                  .order("desc")
                  .take(LIST_CAP),
              ),
            )
          ).flat()
        : await ctx.db
            .query("stockTransfers")
            .withIndex("by_status", (q) => q.eq("status", status))
            .order("desc")
            .take(LIST_CAP);
    return rows
      .sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id))
      .slice(0, LIST_CAP)
      .map((row) => ({
        transferId: row._id,
        number: row.number,
        status: row.status,
        fromWarehouseId: row.fromWarehouseId,
        toWarehouseId: row.toWarehouseId,
        shippedAt: row.shippedAt,
        receivedAt: row.receivedAt,
        createdAt: row.createdAt,
      }));
  },
});

/** Transfers that have left the source and are not fully received. */
export const inTransit = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "inventory", "view");
    const rows = await ctx.db
      .query("stockTransfers")
      .withIndex("by_status", (q) => q.eq("status", "inTransit"))
      .take(LIST_CAP + 1);
    if (rows.length > LIST_CAP) {
      throw new ConvexError("Too many transfers in transit to list.");
    }

    const warehouses = new Map<string, { code: string; name: string }>();
    const labelFor = async (warehouseId: Id<"warehouses">) => {
      const hit = warehouses.get(warehouseId);
      if (hit !== undefined) return hit;
      const warehouse = await ctx.db.get(warehouseId);
      const label = {
        code: warehouse?.code ?? "—",
        name: warehouse?.name ?? "Deleted warehouse",
      };
      warehouses.set(warehouseId, label);
      return label;
    };

    const report = [];
    for (const transfer of rows) {
      const from = await labelFor(transfer.fromWarehouseId);
      const to = await labelFor(transfer.toWarehouseId);
      const lines = await linesOf(ctx, transfer._id);
      const detailed = [];
      for (const line of lines) {
        const product = await ctx.db.get(line.productId);
        const variant = line.variantId !== undefined ? await ctx.db.get(line.variantId) : null;
        detailed.push({
          lineId: line._id,
          productId: line.productId,
          variantId: line.variantId,
          name: product?.name ?? "Deleted product",
          sku: variant?.sku ?? product?.sku ?? "—",
          qty: line.qty,
          receivedQty: line.receivedQty,
          outstanding: outstandingQty(line.qty, line.receivedQty),
        });
      }
      report.push({
        transferId: transfer._id,
        number: transfer.number,
        fromWarehouseId: transfer.fromWarehouseId,
        fromCode: from.code,
        fromName: from.name,
        toWarehouseId: transfer.toWarehouseId,
        toCode: to.code,
        toName: to.name,
        shippedAt: transfer.shippedAt,
        lines: detailed,
      });
    }
    return report.sort(
      (a, b) => (a.shippedAt ?? 0) - (b.shippedAt ?? 0) || a.number.localeCompare(b.number),
    );
  },
});
