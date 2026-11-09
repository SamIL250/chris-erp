import { ConvexError, v } from "convex/values";
import { roundMoney } from "../../lib/statements";
import {
  REQUISITION_LINE_MAX,
  requisitionApproveError,
  requisitionConvertError,
  requisitionEditError,
  requisitionNeedByError,
  requisitionNoteError,
  requisitionPriceError,
  requisitionQtyError,
  requisitionRejectError,
  requisitionRejectStatusError,
  type RequisitionStatus,
} from "../../lib/requisitions";
import { auditedMutation } from "../_lib/audit";
import { pricePurchaseLine } from "../_lib/documentTax";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";

/**
 * Internal requisitions (PH2-20).
 *
 * Reads are `procurement.view` (sales can read). Creating and editing a
 * draft is `procurement.create` — warehouse can request, accountant and
 * sales cannot. Approving, rejecting, and converting are
 * `procurement.approve` (owner and admin). Warehouse cannot approve its
 * own request. The approver may be the requester when that role includes
 * approve; this is not the two-person price-override rule.
 * Converting writes one draft purchase order and does not move stock.
 */

const lineArg = v.object({
  productId: v.id("products"),
  variantId: v.optional(v.id("variants")),
  qty: v.number(),
  unitPrice: v.number(),
});

type LineInput = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  qty: number;
  unitPrice: number;
};

type BuiltLine = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  description: string;
  sku: string;
  qty: number;
  unitPrice: number;
};

function cleanNote(raw: string | undefined): string | undefined {
  const error = requisitionNoteError(raw);
  if (error !== null) throw new ConvexError(error);
  const note = raw?.trim() ?? "";
  return note.length === 0 ? undefined : note;
}

async function buildLines(ctx: MutationCtx, lines: LineInput[]): Promise<BuiltLine[]> {
  if (lines.length < 1) throw new ConvexError("Add a line.");
  if (lines.length > REQUISITION_LINE_MAX) {
    throw new ConvexError(`A requisition can have at most ${REQUISITION_LINE_MAX} lines.`);
  }
  const seen = new Set<string>();
  const built: BuiltLine[] = [];
  for (const line of lines) {
    const product = await ctx.db.get(line.productId);
    if (product === null) throw new ConvexError("That product doesn't exist.");
    if (product.status === "archived") throw new ConvexError(`${product.sku} is archived.`);
    const variants = await ctx.db
      .query("variants")
      .withIndex("by_product", (q) => q.eq("productId", product._id))
      .collect();
    let sku = product.sku;
    let description = product.name;
    let variantId: Id<"variants"> | undefined;
    if (variants.length > 0) {
      if (line.variantId === undefined) {
        throw new ConvexError(`Name the variant for ${product.sku}.`);
      }
      const variant = variants.find((row) => row._id === line.variantId);
      if (variant === undefined) throw new ConvexError("That variant is not on this product.");
      variantId = variant._id;
      sku = variant.sku;
      description = `${product.name} · ${variant.sku}`;
    } else if (line.variantId !== undefined) {
      throw new ConvexError(`${product.sku} has no variants.`);
    }
    const key = `${product._id}:${variantId ?? ""}`;
    if (seen.has(key)) throw new ConvexError(`${sku} is already on this requisition.`);
    seen.add(key);
    const qtyError = requisitionQtyError(line.qty);
    if (qtyError !== null) throw new ConvexError(qtyError);
    const unitPrice = roundMoney(line.unitPrice);
    const priceErrorMessage = requisitionPriceError(unitPrice);
    if (priceErrorMessage !== null) throw new ConvexError(priceErrorMessage);
    const builtLine: BuiltLine = {
      productId: product._id,
      description,
      sku,
      qty: line.qty,
      unitPrice,
    };
    if (variantId !== undefined) builtLine.variantId = variantId;
    built.push(builtLine);
  }
  return built;
}

async function insertLines(
  ctx: MutationCtx,
  requisitionId: Id<"requisitions">,
  lines: BuiltLine[],
  now: number,
) {
  for (const [index, line] of lines.entries()) {
    await ctx.db.insert("requisitionLines", {
      requisitionId,
      productId: line.productId,
      ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
      description: line.description,
      sku: line.sku,
      qty: line.qty,
      unitPrice: line.unitPrice,
      sort: index,
      createdAt: now,
    });
  }
}

async function replaceLines(
  ctx: MutationCtx,
  requisitionId: Id<"requisitions">,
  lines: BuiltLine[],
  now: number,
) {
  const existing = await ctx.db
    .query("requisitionLines")
    .withIndex("by_requisition", (q) => q.eq("requisitionId", requisitionId))
    .collect();
  for (const line of existing) await ctx.db.delete(line._id);
  await insertLines(ctx, requisitionId, lines, now);
}

async function loadRequisition(ctx: MutationCtx, id: Id<"requisitions">) {
  const row = await ctx.db.get(id);
  if (row === null) throw new ConvexError("That requisition doesn't exist.");
  return row;
}

function requesterLabel(user: Doc<"users"> | null): string {
  if (user === null) return "Unknown";
  if (user.name !== undefined && user.name.trim().length > 0) return user.name;
  if (user.email !== undefined && user.email.trim().length > 0) return user.email;
  return "Unknown";
}

async function linesFor(ctx: QueryCtx, requisitionId: Id<"requisitions">) {
  const lines = await ctx.db
    .query("requisitionLines")
    .withIndex("by_requisition", (q) => q.eq("requisitionId", requisitionId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "procurement", "view");
    const rows = await ctx.db.query("requisitions").collect();
    rows.sort((a, b) => a.docNumber.localeCompare(b.docNumber) || a._id.localeCompare(b._id));
    return await Promise.all(
      rows.map(async (row) => {
        const requester = await ctx.db.get(row.requesterId);
        const order =
          row.purchaseOrderId === undefined ? null : await ctx.db.get(row.purchaseOrderId);
        const lines = await linesFor(ctx, row._id);
        return {
          _id: row._id,
          docNumber: row.docNumber,
          status: row.status,
          needBy: row.needBy,
          requesterName: requesterLabel(requester),
          lineCount: lines.length,
          purchaseOrderNumber: order?.docNumber ?? null,
          createdAt: row.createdAt,
        };
      }),
    );
  },
});

export const get = query({
  args: { requisitionId: v.id("requisitions") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const row = await ctx.db.get(args.requisitionId);
    if (row === null) return null;
    const requester = await ctx.db.get(row.requesterId);
    const order = row.purchaseOrderId === undefined ? null : await ctx.db.get(row.purchaseOrderId);
    const lines = await linesFor(ctx, row._id);
    return {
      _id: row._id,
      docNumber: row.docNumber,
      status: row.status as RequisitionStatus,
      needBy: row.needBy,
      note: row.note ?? null,
      requesterName: requesterLabel(requester),
      requesterEmail: requester?.email ?? null,
      rejectReason: row.rejectReason ?? null,
      purchaseOrderId: order?._id ?? null,
      purchaseOrderNumber: order?.docNumber ?? null,
      createdAt: row.createdAt,
      lines: lines.map((line) => ({
        _id: line._id,
        productId: line.productId,
        variantId: line.variantId ?? null,
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
      })),
    };
  },
});

export const create = auditedMutation({
  entity: "requisitions",
  action: "create",
  args: {
    needBy: v.number(),
    note: v.optional(v.string()),
    lines: v.array(lineArg),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "procurement", "create");
    const needByError = requisitionNeedByError(args.needBy);
    if (needByError !== null) throw new ConvexError(needByError);
    const note = cleanNote(args.note);
    const lines = await buildLines(ctx, args.lines);
    await ensureDefaultSequences(ctx);
    const now = Date.now();
    const docNumber = await nextSequence(ctx, "requisition");
    const requisitionId = await ctx.db.insert("requisitions", {
      docNumber,
      requesterId: actorId,
      needBy: args.needBy,
      ...(note !== undefined ? { note } : {}),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await insertLines(ctx, requisitionId, lines, now);
    return {
      result: requisitionId,
      audit: { entityId: requisitionId, after: { docNumber, status: "draft" } },
    };
  },
});

export const update = auditedMutation({
  entity: "requisitions",
  action: "update",
  args: {
    requisitionId: v.id("requisitions"),
    needBy: v.number(),
    note: v.optional(v.string()),
    lines: v.array(lineArg),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "create");
    const row = await loadRequisition(ctx, args.requisitionId);
    const editError = requisitionEditError(row.status);
    if (editError !== null) throw new ConvexError(editError);
    const needByError = requisitionNeedByError(args.needBy);
    if (needByError !== null) throw new ConvexError(needByError);
    const note = cleanNote(args.note);
    const lines = await buildLines(ctx, args.lines);
    const now = Date.now();
    await ctx.db.patch(row._id, {
      needBy: args.needBy,
      note,
      updatedAt: now,
    });
    await replaceLines(ctx, row._id, lines, now);
    return {
      result: row._id,
      audit: { entityId: row._id, after: { docNumber: row.docNumber, status: row.status } },
    };
  },
});

export const approve = auditedMutation({
  entity: "requisitions",
  action: "approve",
  args: { requisitionId: v.id("requisitions") },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "procurement", "approve");
    const row = await loadRequisition(ctx, args.requisitionId);
    const statusError = requisitionApproveError(row.status);
    if (statusError !== null) throw new ConvexError(statusError);
    const lines = await linesFor(ctx, row._id);
    if (lines.length < 1) throw new ConvexError("Add a line.");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "approved",
      approvedBy: actorId,
      approvedAt: now,
      updatedAt: now,
    });
    return {
      result: row._id,
      audit: { entityId: row._id, after: { docNumber: row.docNumber, status: "approved" } },
    };
  },
});

export const reject = auditedMutation({
  entity: "requisitions",
  action: "reject",
  args: { requisitionId: v.id("requisitions"), reason: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "procurement", "approve");
    const reasonError = requisitionRejectError(args.reason);
    if (reasonError !== null) throw new ConvexError(reasonError);
    const row = await loadRequisition(ctx, args.requisitionId);
    const statusError = requisitionRejectStatusError(row.status);
    if (statusError !== null) throw new ConvexError(statusError);
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "rejected",
      rejectedBy: actorId,
      rejectedAt: now,
      rejectReason: args.reason.trim(),
      updatedAt: now,
    });
    return {
      result: row._id,
      audit: { entityId: row._id, after: { docNumber: row.docNumber, status: "rejected" } },
    };
  },
});

export const convert = auditedMutation({
  entity: "requisitions",
  action: "convert",
  args: { requisitionId: v.id("requisitions"), vendorId: v.id("vendors") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "approve");
    const row = await loadRequisition(ctx, args.requisitionId);
    const convertError = requisitionConvertError(row.status, row.purchaseOrderId !== undefined);
    if (convertError !== null) throw new ConvexError(convertError);
    const vendor = await ctx.db.get(args.vendorId);
    if (vendor === null) throw new ConvexError("That vendor doesn't exist.");
    if (!vendor.active) throw new ConvexError("That vendor is inactive.");
    const currency = await ctx.db
      .query("currencies")
      .withIndex("by_code", (q) => q.eq("code", vendor.currency))
      .unique();
    if (currency === null) throw new ConvexError("That currency isn't in the catalog.");
    const lines = await linesFor(ctx, row._id);
    if (lines.length < 1) throw new ConvexError("Add a line.");
    await ensureDefaultSequences(ctx);
    const now = Date.now();
    const docNumber = await nextSequence(ctx, "purchaseOrder");
    const purchaseOrderId = await ctx.db.insert("purchaseOrders", {
      docNumber,
      vendorId: vendor._id,
      requisitionId: row._id,
      status: "draft",
      currency: vendor.currency,
      decimalPlaces: currency.decimalPlaces,
      expectedDate: row.needBy,
      createdAt: now,
      updatedAt: now,
    });
    for (const line of lines) {
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new ConvexError("That product doesn't exist.");
      const priced = await pricePurchaseLine(ctx, {
        product,
        taxGroupId: vendor.taxGroupId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        decimalPlaces: currency.decimalPlaces,
      });
      await ctx.db.insert("purchaseOrderLines", {
        purchaseOrderId,
        requisitionLineId: line._id,
        productId: line.productId,
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxCategory: priced.taxCategory,
        ...(priced.taxRateId !== undefined ? { taxRateId: priced.taxRateId } : {}),
        rateBps: priced.rateBps,
        inclusive: priced.inclusive,
        net: priced.net,
        tax: priced.tax,
        gross: priced.gross,
        sort: line.sort,
        createdAt: now,
      });
    }
    await ctx.db.patch(row._id, { purchaseOrderId, updatedAt: now });
    return {
      result: purchaseOrderId,
      audit: {
        entityId: row._id,
        after: { docNumber: row.docNumber, purchaseOrderNumber: docNumber, status: "approved" },
      },
    };
  },
});
