import { ConvexError, v } from "convex/values";
import { isLowStock, reorderPointFor } from "../../lib/reorder";
import {
  adjustmentNoteError,
  adjustmentReasonError,
  latestUnitCost,
  movementQtyError,
  normalizeAdjustmentNote,
  normalizeReference,
  placeholderValue,
  referenceError,
  stockBalance,
  unitCostError,
  type AdjustmentReason,
  type StockMovementType,
} from "../../lib/stock";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Append-only stock ledger (PH1-17) and the reservation engine (PH1-19).
 *
 * `postMovement` is the only insert. Nothing patches or deletes a row.
 * `reserveStock` / `releaseStock` / `allocateStock` are the guarded
 * helpers an order mutation calls with its OWN context — not
 * `ctx.runMutation`, which would be a second transaction and could
 * over-reserve. Each one reads the lines already written in this
 * transaction before it inserts.
 *
 * Allocate is a release plus an issue of the same quantity: the hold
 * ends and the units leave on-hand together. A quantity is the positive
 * amount the caller means; the helper applies the ledger sign.
 *
 * Serials, when named, are one unit each. This does not change a
 * serial's status — that workflow is Phase 5.
 *
 * A manual adjustment (PH1-20) goes through `adjust`, which requires
 * `inventory.approve`. The raw `post` action refuses that type so a
 * count change always carries a reason. Damage and write-off leave
 * the shelf; found stock arrives; a count correction may go either
 * way. A removal cannot take on-hand below what is still reserved.
 */

const LIST_LIMIT = 200;
/** A balance that cannot see every line would be a wrong on-hand. */
export const BALANCE_CAP = 5000;

export type PostMovementInput = {
  type: StockMovementType;
  qty: number;
  productId: Id<"products">;
  variantId?: Id<"variants">;
  warehouseId: Id<"warehouses">;
  lotId?: Id<"lots">;
  serialIds?: Id<"serials">[];
  referenceType?: string;
  referenceId?: string;
  unitCost?: number;
  reason?: AdjustmentReason;
  note?: string;
  photoFileId?: Id<"files">;
  actorId: Id<"users">;
};

function snapshot(row: {
  type: StockMovementType;
  qty: number;
  productId: Id<"products">;
  variantId?: Id<"variants">;
  warehouseId: Id<"warehouses">;
  lotId?: Id<"lots">;
  serialIds: Id<"serials">[];
  referenceType?: string;
  referenceId?: string;
  unitCost?: number;
  reason?: AdjustmentReason;
  note?: string;
  photoFileId?: Id<"files">;
  actorId: Id<"users">;
  createdAt: number;
}) {
  return {
    type: row.type,
    qty: row.qty,
    productId: row.productId,
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    lotId: row.lotId,
    serialIds: row.serialIds,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    unitCost: row.unitCost,
    reason: row.reason,
    note: row.note,
    photoFileId: row.photoFileId,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

/** Validate and insert one ledger row. Does not check permission or audit. */
export async function postMovement(
  ctx: MutationCtx,
  input: PostMovementInput,
): Promise<Id<"stockMovements">> {
  const qtyError = movementQtyError(input.type, input.qty);
  if (qtyError !== null) throw new ConvexError(qtyError);
  const note = normalizeAdjustmentNote(input.note);
  if (input.type === "adjustment") {
    const reasonError = adjustmentReasonError(input.reason, input.qty);
    if (reasonError !== null) throw new ConvexError(reasonError);
    const noteError = adjustmentNoteError(input.note);
    if (noteError !== null) throw new ConvexError(noteError);
  } else if (input.reason !== undefined || note !== undefined || input.photoFileId !== undefined) {
    throw new ConvexError("A reason, note, or photo belongs on an adjustment.");
  }
  const costError = unitCostError(input.unitCost);
  if (costError !== null) throw new ConvexError(costError);
  const refError = referenceError(input.referenceType, input.referenceId);
  if (refError !== null) throw new ConvexError(refError);

  const product = await ctx.db.get(input.productId);
  if (product === null) throw new ConvexError("Product not found.");

  const variantCount = await ctx.db
    .query("variants")
    .withIndex("by_product", (q) => q.eq("productId", input.productId))
    .take(1);
  if (input.variantId === undefined) {
    if (variantCount.length > 0) {
      throw new ConvexError("This product has variants — name the variant this movement is for.");
    }
  } else {
    const variant = await ctx.db.get(input.variantId);
    if (variant === null) throw new ConvexError("Variant not found.");
    if (variant.productId !== input.productId) {
      throw new ConvexError("That variant belongs to a different product.");
    }
  }

  const warehouse = await ctx.db.get(input.warehouseId);
  if (warehouse === null) throw new ConvexError("Warehouse not found.");
  if (!warehouse.active) {
    throw new ConvexError("That warehouse is inactive. Choose an active warehouse.");
  }

  if (input.lotId !== undefined) {
    const lot = await ctx.db.get(input.lotId);
    if (lot === null) throw new ConvexError("Lot not found.");
    if (lot.productId !== input.productId) {
      throw new ConvexError("That lot belongs to a different product.");
    }
    if (
      input.variantId !== undefined &&
      lot.variantId !== undefined &&
      lot.variantId !== input.variantId
    ) {
      throw new ConvexError("That lot is for a different variant.");
    }
    if (input.variantId === undefined && lot.variantId !== undefined) {
      throw new ConvexError("That lot is for a specific variant.");
    }
  }

  if (input.photoFileId !== undefined) {
    const photo = await ctx.db.get(input.photoFileId);
    if (photo === null) throw new ConvexError("Photo not found.");
    if (!photo.mimeType.toLowerCase().startsWith("image/")) {
      throw new ConvexError("The adjustment photo has to be an image.");
    }
  }

  const serialIds = input.serialIds ?? [];
  if (serialIds.length > 0 && Math.abs(input.qty) !== serialIds.length) {
    throw new ConvexError(
      `Quantity must match the number of serials (${serialIds.length} serial${serialIds.length === 1 ? "" : "s"}, quantity ${input.qty}).`,
    );
  }
  const seen = new Set<string>();
  for (const serialId of serialIds) {
    if (seen.has(serialId)) throw new ConvexError("The same serial is listed more than once.");
    seen.add(serialId);
    const serial = await ctx.db.get(serialId);
    if (serial === null) throw new ConvexError("Serial not found.");
    if (serial.productId !== input.productId) {
      throw new ConvexError("That serial belongs to a different product.");
    }
    if (
      input.variantId !== undefined &&
      serial.variantId !== undefined &&
      serial.variantId !== input.variantId
    ) {
      throw new ConvexError("That serial belongs to a different variant.");
    }
    if (input.variantId === undefined && serial.variantId !== undefined) {
      throw new ConvexError("That serial is for a specific variant.");
    }
  }

  const reference = normalizeReference(input.referenceType, input.referenceId);
  return await ctx.db.insert("stockMovements", {
    type: input.type,
    qty: input.qty,
    productId: input.productId,
    ...(input.variantId !== undefined ? { variantId: input.variantId } : {}),
    warehouseId: input.warehouseId,
    ...(input.lotId !== undefined ? { lotId: input.lotId } : {}),
    serialIds,
    ...reference,
    ...(input.unitCost !== undefined ? { unitCost: input.unitCost } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(input.photoFileId !== undefined ? { photoFileId: input.photoFileId } : {}),
    actorId: input.actorId,
    createdAt: Date.now(),
  });
}

const POST_ARGS = {
  type: v.union(
    v.literal("receipt"),
    v.literal("issue"),
    v.literal("transferIn"),
    v.literal("transferOut"),
    v.literal("adjustment"),
    v.literal("reservation"),
    v.literal("release"),
  ),
  qty: v.number(),
  productId: v.id("products"),
  variantId: v.optional(v.id("variants")),
  warehouseId: v.id("warehouses"),
  lotId: v.optional(v.id("lots")),
  serialIds: v.optional(v.array(v.id("serials"))),
  referenceType: v.optional(v.string()),
  referenceId: v.optional(v.string()),
  unitCost: v.optional(v.number()),
};

export const post = auditedMutation({
  entity: "stockMovements",
  action: "create",
  args: POST_ARGS,
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "create");
    if (args.type === "adjustment") {
      throw new ConvexError("Record a count change with the adjustment action.");
    }
    const id = await postMovement(ctx, { ...args, actorId });
    const row = await ctx.db.get(id);
    if (row === null) throw new ConvexError("Movement was not recorded.");
    return { result: id, audit: { entityId: id, after: snapshot(row) } };
  },
});

export const list = query({
  args: {
    productId: v.id("products"),
    warehouseId: v.optional(v.id("warehouses")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    if ((await ctx.db.get(args.productId)) === null) throw new ConvexError("Product not found.");
    const warehouseId = args.warehouseId;
    if (warehouseId !== undefined) {
      return await ctx.db
        .query("stockMovements")
        .withIndex("by_product_warehouse", (q) =>
          q.eq("productId", args.productId).eq("warehouseId", warehouseId),
        )
        .take(LIST_LIMIT);
    }
    return await ctx.db
      .query("stockMovements")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .take(LIST_LIMIT);
  },
});

async function movementsAt(
  ctx: QueryCtx | MutationCtx,
  productId: Id<"products">,
  warehouseId: Id<"warehouses">,
): Promise<Doc<"stockMovements">[]> {
  const rows = await ctx.db
    .query("stockMovements")
    .withIndex("by_product_warehouse", (q) =>
      q.eq("productId", productId).eq("warehouseId", warehouseId),
    )
    .take(BALANCE_CAP + 1);
  if (rows.length > BALANCE_CAP) {
    throw new ConvexError("Too many stock movements to total in one read.");
  }
  return rows;
}

function positionOf(lines: Doc<"stockMovements">[]) {
  const totals = stockBalance(lines);
  const unitCost = latestUnitCost(lines);
  return {
    ...totals,
    unitCost,
    value: placeholderValue(totals.onHand, unitCost),
  };
}

/**
 * On-hand, reserved, and available for one product at one warehouse.
 * Omit `variantId` to sum every variant; pass it to read one of them.
 * `value` is on-hand times the latest physical unit cost — a placeholder
 * until moving-average cost (PH3-06). No lines yet is a zero balance.
 */
export const balance = query({
  args: {
    productId: v.id("products"),
    warehouseId: v.id("warehouses"),
    variantId: v.optional(v.id("variants")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    if ((await ctx.db.get(args.productId)) === null) throw new ConvexError("Product not found.");
    if ((await ctx.db.get(args.warehouseId)) === null) {
      throw new ConvexError("Warehouse not found.");
    }
    if (args.variantId !== undefined) {
      const variant = await ctx.db.get(args.variantId);
      if (variant === null) throw new ConvexError("Variant not found.");
      if (variant.productId !== args.productId) {
        throw new ConvexError("That variant belongs to a different product.");
      }
    }
    const rows = await movementsAt(ctx, args.productId, args.warehouseId);
    const lines =
      args.variantId === undefined ? rows : rows.filter((row) => row.variantId === args.variantId);
    return positionOf(lines);
  },
});

/**
 * Every product (and variant) that has at least one line at this
 * warehouse, including a position that has since netted to zero.
 * `value` is the same placeholder as `balance`.
 */
export const byWarehouse = query({
  args: { warehouseId: v.id("warehouses") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    if ((await ctx.db.get(args.warehouseId)) === null) {
      throw new ConvexError("Warehouse not found.");
    }
    const rows = await ctx.db
      .query("stockMovements")
      .withIndex("by_warehouse", (q) => q.eq("warehouseId", args.warehouseId))
      .take(BALANCE_CAP + 1);
    if (rows.length > BALANCE_CAP) {
      throw new ConvexError("Too many stock movements to total in one read.");
    }

    const groups = new Map<string, Doc<"stockMovements">[]>();
    for (const row of rows) {
      const key = `${row.productId}:${row.variantId ?? ""}`;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [row]);
      else group.push(row);
    }

    const listed = await Promise.all(
      [...groups.values()].map(async (lines) => {
        const first = lines[0];
        if (first === undefined) return null;
        const product = await ctx.db.get(first.productId);
        const variant = first.variantId !== undefined ? await ctx.db.get(first.variantId) : null;
        return {
          productId: first.productId,
          variantId: first.variantId,
          name: product?.name ?? "Deleted product",
          sku: variant?.sku ?? product?.sku ?? "—",
          ...positionOf(lines),
        };
      }),
    );

    return listed
      .filter((row) => row !== null)
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        const bySku = a.sku.localeCompare(b.sku);
        return bySku !== 0 ? bySku : a.productId.localeCompare(b.productId);
      });
  },
});

/**
 * Stock list for the inventory screen (PH1-23). One row per product
 * slice at a warehouse. `lowStock` keeps slices whose available
 * quantity is at or below that product's reorder point (PH1-24). A
 * warehouse point wins over the product-wide point. No point means
 * the slice is not low.
 */
export const positions = query({
  args: {
    warehouseId: v.optional(v.id("warehouses")),
    categoryId: v.optional(v.id("categories")),
    lowStock: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "view");
    if (args.warehouseId !== undefined && (await ctx.db.get(args.warehouseId)) === null) {
      throw new ConvexError("Warehouse not found.");
    }
    if (args.categoryId !== undefined && (await ctx.db.get(args.categoryId)) === null) {
      throw new ConvexError("Category not found.");
    }

    const warehouseId = args.warehouseId;
    const rows =
      warehouseId === undefined
        ? await ctx.db.query("stockMovements").take(BALANCE_CAP + 1)
        : await ctx.db
            .query("stockMovements")
            .withIndex("by_warehouse", (q) => q.eq("warehouseId", warehouseId))
            .take(BALANCE_CAP + 1);
    if (rows.length > BALANCE_CAP) {
      throw new ConvexError("Too many stock movements to total in one read.");
    }

    const pointRows = await ctx.db.query("reorderPoints").collect();
    const points = pointRows.map((row) => ({
      productId: row.productId as string,
      warehouseId: row.warehouseId as string | undefined,
      qty: row.qty,
    }));

    const groups = new Map<string, Doc<"stockMovements">[]>();
    for (const row of rows) {
      const key = `${row.productId}:${row.variantId ?? ""}:${row.warehouseId}`;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [row]);
      else group.push(row);
    }

    const listed = await Promise.all(
      [...groups.values()].map(async (lines) => {
        const first = lines[0];
        if (first === undefined) return null;
        const product = await ctx.db.get(first.productId);
        if (
          args.categoryId !== undefined &&
          !(product?.categoryIds ?? []).some((id) => id === args.categoryId)
        ) {
          return null;
        }
        const position = positionOf(lines);
        const variant = first.variantId !== undefined ? await ctx.db.get(first.variantId) : null;
        const warehouse = await ctx.db.get(first.warehouseId);
        const reorderPoint =
          warehouse?.active === true
            ? reorderPointFor(points, first.productId, first.warehouseId)
            : undefined;
        const lowStock = isLowStock(position.available, reorderPoint);
        if (args.lowStock === true && !lowStock) return null;
        return {
          productId: first.productId,
          variantId: first.variantId,
          warehouseId: first.warehouseId,
          warehouseCode: warehouse?.code ?? "—",
          warehouseName: warehouse?.name ?? "Deleted warehouse",
          name: product?.name ?? "Deleted product",
          sku: variant?.sku ?? product?.sku ?? "—",
          reorderPoint,
          lowStock,
          ...position,
        };
      }),
    );

    return listed
      .filter((row) => row !== null)
      .sort((a, b) => {
        const byWarehouse = a.warehouseCode.localeCompare(b.warehouseCode);
        if (byWarehouse !== 0) return byWarehouse;
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        return a.sku.localeCompare(b.sku);
      });
  },
});

/** Float dust from summing ledger lines. A request this close still fits. */
const QTY_EPSILON = 1e-9;

export type HoldInput = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  warehouseId: Id<"warehouses">;
  lotId?: Id<"lots">;
  serialIds?: Id<"serials">[];
  /** Positive amount. The helper writes the ledger sign. */
  qty: number;
  referenceType: string;
  referenceId: string;
  unitCost?: number;
  actorId: Id<"users">;
};

function demandQtyError(qty: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "Quantity must be greater than zero.";
  return null;
}

function qtyText(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

function linesForHold(rows: Doc<"stockMovements">[], variantId: Id<"variants"> | undefined) {
  return variantId === undefined
    ? rows.filter((row) => row.variantId === undefined)
    : rows.filter((row) => row.variantId === variantId);
}

/**
 * On-hand, reserved, available, and the latest physical unit cost for
 * one product slice at one warehouse. Includes lines this transaction
 * already wrote. A variant-less slice ignores other variants.
 */
export async function stockPosition(
  ctx: QueryCtx | MutationCtx,
  args: {
    productId: Id<"products">;
    warehouseId: Id<"warehouses">;
    variantId?: Id<"variants">;
  },
): Promise<{
  onHand: number;
  reserved: number;
  available: number;
  unitCost: number | undefined;
}> {
  const rows = await movementsAt(ctx, args.productId, args.warehouseId);
  const lines = linesForHold(rows, args.variantId);
  return { ...stockBalance(lines), unitCost: latestUnitCost(lines) };
}

function requireHoldDocument(input: HoldInput): { referenceType: string; referenceId: string } {
  const qtyError = demandQtyError(input.qty);
  if (qtyError !== null) throw new ConvexError(qtyError);
  const refError = referenceError(input.referenceType, input.referenceId);
  if (refError !== null) throw new ConvexError(refError);
  const reference = normalizeReference(input.referenceType, input.referenceId);
  if (reference.referenceType === undefined || reference.referenceId === undefined) {
    throw new ConvexError("Name the document this stock is held for.");
  }
  return { referenceType: reference.referenceType, referenceId: reference.referenceId };
}

async function holdLines(ctx: MutationCtx, input: HoldInput) {
  const rows = await movementsAt(ctx, input.productId, input.warehouseId);
  return linesForHold(rows, input.variantId);
}

function heldForDocument(
  lines: Doc<"stockMovements">[],
  referenceType: string,
  referenceId: string,
): number {
  return stockBalance(
    lines.filter((row) => row.referenceType === referenceType && row.referenceId === referenceId),
  ).reserved;
}

function holdMovement(input: HoldInput, reference: { referenceType: string; referenceId: string }) {
  return {
    productId: input.productId,
    variantId: input.variantId,
    warehouseId: input.warehouseId,
    lotId: input.lotId,
    serialIds: input.serialIds,
    referenceType: reference.referenceType,
    referenceId: reference.referenceId,
    unitCost: input.unitCost,
    actorId: input.actorId,
  };
}

/**
 * Hold `qty` against a document. Refuses when it would exceed available
 * stock at this product, variant, and warehouse — including holds this
 * same transaction already wrote.
 */
export async function reserveStock(
  ctx: MutationCtx,
  input: HoldInput,
): Promise<Id<"stockMovements">> {
  const reference = requireHoldDocument(input);
  const lines = await holdLines(ctx, input);
  const available = stockBalance(lines).available;
  if (input.qty > available + QTY_EPSILON) {
    throw new ConvexError(
      available > QTY_EPSILON
        ? `Only ${qtyText(available)} available to reserve.`
        : "Nothing available to reserve.",
    );
  }
  return await postMovement(ctx, {
    type: "reservation",
    qty: input.qty,
    ...holdMovement(input, reference),
  });
}

/**
 * Give back `qty` of the hold on this document. Cannot release another
 * document's reservation, or more than this document still holds.
 */
export async function releaseStock(
  ctx: MutationCtx,
  input: HoldInput,
): Promise<Id<"stockMovements">> {
  const reference = requireHoldDocument(input);
  const lines = await holdLines(ctx, input);
  const held = heldForDocument(lines, reference.referenceType, reference.referenceId);
  if (input.qty > held + QTY_EPSILON) {
    throw new ConvexError(
      held > QTY_EPSILON
        ? `Only ${qtyText(held)} is reserved against this document.`
        : "Nothing is reserved against this document.",
    );
  }
  return await postMovement(ctx, {
    type: "release",
    qty: -input.qty,
    ...holdMovement(input, reference),
  });
}

/**
 * Turn `qty` of this document's hold into a goods issue: a release and
 * an issue, same transaction. Available stays reduced by the units that
 * left, and the hold does not keep counting them.
 */
export async function allocateStock(
  ctx: MutationCtx,
  input: HoldInput,
): Promise<{ releaseId: Id<"stockMovements">; issueId: Id<"stockMovements"> }> {
  const reference = requireHoldDocument(input);
  const lines = await holdLines(ctx, input);
  const held = heldForDocument(lines, reference.referenceType, reference.referenceId);
  if (input.qty > held + QTY_EPSILON) {
    throw new ConvexError(
      held > QTY_EPSILON
        ? `Only ${qtyText(held)} can be allocated from this reservation.`
        : "Nothing is reserved against this document.",
    );
  }
  const onHand = stockBalance(lines).onHand;
  if (input.qty > onHand + QTY_EPSILON) {
    throw new ConvexError(
      onHand > QTY_EPSILON
        ? `Only ${qtyText(onHand)} on hand to allocate.`
        : "Nothing on hand to allocate.",
    );
  }
  const shared = holdMovement(input, reference);
  const releaseId = await postMovement(ctx, { type: "release", qty: -input.qty, ...shared });
  const issueId = await postMovement(ctx, { type: "issue", qty: -input.qty, ...shared });
  return { releaseId, issueId };
}

function removalMessage(available: number, reserved: number): string {
  if (available <= QTY_EPSILON) {
    return reserved > QTY_EPSILON
      ? "Nothing is free to remove. The stock on hand is reserved."
      : "Nothing on hand to remove.";
  }
  return reserved > QTY_EPSILON
    ? `Only ${qtyText(available)} can be removed. The rest is reserved.`
    : `Only ${qtyText(available)} on hand to remove.`;
}

export type AdjustInput = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  warehouseId: Id<"warehouses">;
  lotId?: Id<"lots">;
  serialIds?: Id<"serials">[];
  /** Signed. Damage and write-off are negative; found is positive. */
  qty: number;
  reason: AdjustmentReason;
  note?: string;
  photoFileId?: Id<"files">;
  unitCost?: number;
  referenceType?: string;
  referenceId?: string;
  actorId: Id<"users">;
};

/**
 * Post one manual adjustment. A removal cannot take on-hand below what
 * is still reserved. Does not check permission or audit — the public
 * `adjust` mutation does, and a later count workflow can call this
 * inside its own transaction.
 */
export async function adjustStock(
  ctx: MutationCtx,
  input: AdjustInput,
): Promise<Id<"stockMovements">> {
  const reasonError = adjustmentReasonError(input.reason, input.qty);
  if (reasonError !== null) throw new ConvexError(reasonError);
  const noteError = adjustmentNoteError(input.note);
  if (noteError !== null) throw new ConvexError(noteError);
  if (input.qty < 0) {
    const rows = await movementsAt(ctx, input.productId, input.warehouseId);
    const lines = linesForHold(rows, input.variantId);
    const { available, reserved } = stockBalance(lines);
    if (-input.qty > available + QTY_EPSILON) {
      if (lines.length === 0 && (await ctx.db.get(input.productId)) === null) {
        throw new ConvexError("Product not found.");
      }
      throw new ConvexError(removalMessage(available, reserved));
    }
  }
  return await postMovement(ctx, { type: "adjustment", ...input });
}

const HOLD_ARGS = {
  productId: v.id("products"),
  variantId: v.optional(v.id("variants")),
  warehouseId: v.id("warehouses"),
  lotId: v.optional(v.id("lots")),
  serialIds: v.optional(v.array(v.id("serials"))),
  qty: v.number(),
  referenceType: v.string(),
  referenceId: v.string(),
  unitCost: v.optional(v.number()),
};

export const reserve = auditedMutation({
  entity: "stockMovements",
  action: "create",
  args: HOLD_ARGS,
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "create");
    const id = await reserveStock(ctx, { ...args, actorId });
    const row = await ctx.db.get(id);
    if (row === null) throw new ConvexError("Reservation was not recorded.");
    return { result: id, audit: { entityId: id, after: snapshot(row) } };
  },
});

export const release = auditedMutation({
  entity: "stockMovements",
  action: "create",
  args: HOLD_ARGS,
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "create");
    const id = await releaseStock(ctx, { ...args, actorId });
    const row = await ctx.db.get(id);
    if (row === null) throw new ConvexError("Release was not recorded.");
    return { result: id, audit: { entityId: id, after: snapshot(row) } };
  },
});

export const allocate = auditedMutation({
  entity: "stockMovements",
  action: "create",
  args: HOLD_ARGS,
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "create");
    const ids = await allocateStock(ctx, { ...args, actorId });
    return {
      result: ids,
      audit: {
        entityId: ids.issueId,
        after: {
          releaseId: ids.releaseId,
          issueId: ids.issueId,
          qty: args.qty,
          productId: args.productId,
          warehouseId: args.warehouseId,
          referenceType: args.referenceType,
          referenceId: args.referenceId,
        },
      },
    };
  },
});

const ADJUST_ARGS = {
  productId: v.id("products"),
  variantId: v.optional(v.id("variants")),
  warehouseId: v.id("warehouses"),
  lotId: v.optional(v.id("lots")),
  serialIds: v.optional(v.array(v.id("serials"))),
  qty: v.number(),
  reason: v.union(
    v.literal("damage"),
    v.literal("countCorrection"),
    v.literal("writeOff"),
    v.literal("found"),
  ),
  note: v.optional(v.string()),
  photoFileId: v.optional(v.id("files")),
  unitCost: v.optional(v.number()),
};

export const adjust = auditedMutation({
  entity: "stockMovements",
  action: "create",
  args: ADJUST_ARGS,
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "inventory", "approve");
    const id = await adjustStock(ctx, { ...args, actorId });
    const row = await ctx.db.get(id);
    if (row === null) throw new ConvexError("Adjustment was not recorded.");
    return { result: id, audit: { entityId: id, after: snapshot(row) } };
  },
});
