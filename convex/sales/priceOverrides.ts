import { ConvexError, v } from "convex/values";
import {
  chargedUnitPrice,
  documentRefError,
  normalizeOverrideReason,
  overrideReasonError,
  priceOverride,
  type OverrideDocumentKind,
  type OverrideStatus,
  type PriceOverrideDecision,
} from "../../lib/priceOverrides";
import { roundUnitPrice } from "../../lib/pricing";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { syncQuoteLineCharge } from "./quoteCharge";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Manual price on a document line (PH2-08). `propose` is `sales.create`.
 * `confirm` is `sales.approve`, and the person who proposed it cannot
 * confirm it. Reads are `sales.view`. Phase 6 replaces the single
 * discount threshold with configurable rules.
 */

type ReadCtx = QueryCtx | MutationCtx;

const documentKind = v.union(
  v.literal("quote"),
  v.literal("salesOrder"),
  v.literal("invoice"),
  v.literal("creditNote"),
);

const change = v.union(
  v.object({ mode: v.literal("price"), manualPrice: v.number() }),
  v.object({ mode: v.literal("discount"), discountPercent: v.number() }),
);

function assertReason(raw: string) {
  const message = overrideReasonError(raw);
  if (message !== null) throw new ConvexError(message);
  return normalizeOverrideReason(raw);
}

function assertRef(raw: string, label: "Document" | "Line") {
  const message = documentRefError(raw, label);
  if (message !== null) throw new ConvexError(message);
  return raw.trim();
}

function decide(
  resolvedUnitPrice: number | null,
  decimalPlaces: number,
  change: { mode: "price"; manualPrice: number } | { mode: "discount"; discountPercent: number },
): { error: string } | PriceOverrideDecision {
  switch (change.mode) {
    case "price":
      return priceOverride({
        resolvedUnitPrice,
        decimalPlaces,
        mode: "price",
        manualPrice: change.manualPrice,
      });
    case "discount":
      return priceOverride({
        resolvedUnitPrice,
        decimalPlaces,
        mode: "discount",
        discountPercent: change.discountPercent,
      });
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

async function requireCurrency(ctx: ReadCtx, code: string) {
  const normalized = code.trim().toUpperCase();
  const currency = await ctx.db
    .query("currencies")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
  if (currency === null) throw new ConvexError("Currency not found.");
  if (
    !Number.isInteger(currency.decimalPlaces) ||
    currency.decimalPlaces < 0 ||
    currency.decimalPlaces > 6
  ) {
    throw new ConvexError("That currency has no decimal places.");
  }
  return { code: normalized, decimalPlaces: currency.decimalPlaces };
}

async function lineOverride(
  ctx: ReadCtx,
  documentKind: OverrideDocumentKind,
  documentId: string,
  lineId: string,
) {
  return await ctx.db
    .query("priceOverrides")
    .withIndex("by_line", (q) =>
      q.eq("documentKind", documentKind).eq("documentId", documentId).eq("lineId", lineId),
    )
    .unique();
}

function present(row: Doc<"priceOverrides">) {
  return {
    _id: row._id,
    documentKind: row.documentKind,
    documentId: row.documentId,
    lineId: row.lineId,
    currency: row.currency,
    resolvedUnitPrice: row.resolvedUnitPrice ?? null,
    mode: row.mode,
    manualPrice: row.manualPrice ?? null,
    requestedDiscountPercent: row.requestedDiscountPercent ?? null,
    discountPercent: row.discountPercent ?? null,
    unitPrice: row.unitPrice,
    chargedUnitPrice: chargedUnitPrice({
      status: row.status,
      unitPrice: row.unitPrice,
      resolvedUnitPrice: row.resolvedUnitPrice ?? null,
    }),
    needsApproval: row.needsApproval,
    status: row.status,
    reason: row.reason,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ?? null,
    decisionNote: row.decisionNote ?? null,
    updatedAt: row.updatedAt,
  };
}

export const get = query({
  args: { documentKind, documentId: v.string(), lineId: v.string() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const row = await lineOverride(ctx, args.documentKind, args.documentId, args.lineId);
    return row === null ? null : present(row);
  },
});

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const rows = await ctx.db
      .query("priceOverrides")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    return rows
      .map(present)
      .sort((a, b) => b.updatedAt - a.updatedAt || a._id.localeCompare(b._id));
  },
});

export const propose = auditedMutation({
  entity: "priceOverrides",
  action: "set",
  args: {
    documentKind,
    documentId: v.string(),
    lineId: v.string(),
    currency: v.string(),
    resolvedUnitPrice: v.union(v.number(), v.null()),
    change,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const requestedBy = await requirePermission(ctx, "sales", "create");
    const documentId = assertRef(args.documentId, "Document");
    const lineId = assertRef(args.lineId, "Line");
    const reason = assertReason(args.reason);
    const currency = await requireCurrency(ctx, args.currency);
    const decision = decide(args.resolvedUnitPrice, currency.decimalPlaces, args.change);
    if ("error" in decision) throw new ConvexError(decision.error);

    const status: OverrideStatus = decision.needsApproval ? "pending" : "applied";
    const now = Date.now();
    const existing = await lineOverride(ctx, args.documentKind, documentId, lineId);
    const resolvedUnitPrice =
      args.resolvedUnitPrice === null
        ? null
        : roundUnitPrice(args.resolvedUnitPrice, currency.decimalPlaces);
    const stored = {
      documentKind: args.documentKind,
      documentId,
      lineId,
      currency: currency.code,
      mode: args.change.mode,
      unitPrice: decision.unitPrice,
      needsApproval: decision.needsApproval,
      status,
      reason,
      requestedBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(resolvedUnitPrice === null ? {} : { resolvedUnitPrice }),
      ...(args.change.mode === "price"
        ? { manualPrice: decision.unitPrice }
        : { requestedDiscountPercent: args.change.discountPercent }),
      ...(decision.discountPercent === null ? {} : { discountPercent: decision.discountPercent }),
    };

    if (existing === null) {
      const overrideId = await ctx.db.insert("priceOverrides", stored);
      return {
        result: overrideId,
        audit: {
          entityId: overrideId,
          after: { status, unitPrice: decision.unitPrice, needsApproval: decision.needsApproval },
        },
      };
    }
    await ctx.db.replace(existing._id, stored);
    await ctx.db.patch(existing._id, { updatedAt: now });
    return {
      result: existing._id,
      audit: {
        entityId: existing._id,
        before: {
          status: existing.status,
          unitPrice: existing.unitPrice,
          needsApproval: existing.needsApproval,
        },
        after: { status, unitPrice: decision.unitPrice, needsApproval: decision.needsApproval },
      },
    };
  },
});

export const confirm = auditedMutation({
  entity: "priceOverrides",
  action: "approve",
  args: {
    overrideId: v.id("priceOverrides"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    note: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "approve");
    const row = await ctx.db.get(args.overrideId);
    if (row === null) throw new ConvexError("This price override no longer exists.");
    if (row.status === "applied") throw new ConvexError("This price doesn't need approval.");
    if (row.status === "approved" || row.status === "rejected") {
      throw new ConvexError("This price was already confirmed.");
    }
    if (row.status !== "pending") {
      const unreachable: never = row.status;
      throw new ConvexError(unreachable);
    }
    if (actorId === row.requestedBy) {
      throw new ConvexError("Someone else has to confirm this price.");
    }

    let note: string | undefined;
    if (args.decision === "reject") {
      if (args.note === null) throw new ConvexError("A reason is required.");
      note = assertReason(args.note);
    } else if (args.note !== null && args.note.trim().length > 0) {
      note = assertReason(args.note);
    }

    const status: OverrideStatus = args.decision === "approve" ? "approved" : "rejected";
    const now = Date.now();
    await ctx.db.patch(args.overrideId, {
      status,
      decidedBy: actorId,
      decidedAt: now,
      updatedAt: now,
      ...(note === undefined ? {} : { decisionNote: note }),
    });
    await syncQuoteLineCharge(ctx, { ...row, status, updatedAt: now });
    return {
      result: args.overrideId,
      audit: {
        entityId: args.overrideId,
        before: { status: row.status },
        after: { status, decidedBy: actorId },
      },
    };
  },
});
