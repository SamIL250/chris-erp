import { ConvexError, v } from "convex/values";
import {
  cancelDeliveryError,
  carrierError,
  cogsAmount,
  intentPeriod,
  packQtyError,
  packStatusError,
  packableQty,
  shipDeliveryError,
  trackingError,
} from "../../lib/deliveries";
import { priceDayFromInput } from "../../lib/pricing";
import { roundMoney } from "../../lib/statements";
import { appendAudit, auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { ensureDefaultSequences, nextSequence } from "../_lib/sequences";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { applyShipment, openPackedQty, salesOrderAudit } from "./orders";

/**
 * Packing slips (PH2-14). Pack claims reserved quantity and posts
 * nothing. Ship is the goods issue: stock leaves, the unit cost is
 * kept on the issue and the slip, and one pending `cogs` intent is
 * written. Reads are `sales.view`. Pack, ship, and cancel of a packed
 * slip are `sales.edit`, so warehouse can fulfill and an accountant
 * cannot.
 */

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function requireOrder(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const order = await ctx.db.get(salesOrderId);
  if (order === null) throw new ConvexError("Order not found.");
  return order;
}

async function requireDelivery(ctx: QueryCtx | MutationCtx, deliveryId: Id<"deliveries">) {
  const delivery = await ctx.db.get(deliveryId);
  if (delivery === null) throw new ConvexError("Delivery not found.");
  return delivery;
}

async function linesOf(ctx: QueryCtx | MutationCtx, deliveryId: Id<"deliveries">) {
  const lines = await ctx.db
    .query("deliveryLines")
    .withIndex("by_delivery", (q) => q.eq("deliveryId", deliveryId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

async function orderLines(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const lines = await ctx.db
    .query("salesOrderLines")
    .withIndex("by_order", (q) => q.eq("salesOrderId", salesOrderId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

function presentSlip(
  delivery: Doc<"deliveries">,
  names: {
    orderNumber: string;
    customerName: string;
    warehouseCode: string;
    warehouseName: string;
  },
) {
  return {
    _id: delivery._id,
    docNumber: delivery.docNumber,
    salesOrderId: delivery.salesOrderId,
    status: delivery.status,
    carrier: delivery.carrier ?? null,
    trackingNumber: delivery.trackingNumber ?? null,
    shippedAt: delivery.shippedAt ?? null,
    createdAt: delivery.createdAt,
    orderNumber: names.orderNumber,
    customerName: names.customerName,
    warehouseCode: names.warehouseCode,
    warehouseName: names.warehouseName,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const deliveries = await ctx.db.query("deliveries").collect();
    const presented = [];
    for (const delivery of deliveries) {
      const order = await ctx.db.get(delivery.salesOrderId);
      const customer = order === null ? null : await ctx.db.get(order.customerId);
      const warehouse = await ctx.db.get(delivery.warehouseId);
      presented.push(
        presentSlip(delivery, {
          orderNumber: order?.docNumber ?? "",
          customerName: customer?.name ?? "Customer",
          warehouseCode: warehouse?.code ?? "",
          warehouseName: warehouse?.name ?? "",
        }),
      );
    }
    presented.sort((a, b) => b.createdAt - a.createdAt || a._id.localeCompare(b._id));
    return presented;
  },
});

export const forOrder = query({
  args: { salesOrderId: v.id("salesOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_order", (q) => q.eq("salesOrderId", args.salesOrderId))
      .collect();
    deliveries.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
    const presented = [];
    for (const delivery of deliveries) {
      const lines = await linesOf(ctx, delivery._id);
      presented.push({
        _id: delivery._id,
        docNumber: delivery.docNumber,
        status: delivery.status,
        lines: lines.map((line) => ({
          salesOrderLineId: line.salesOrderLineId,
          qty: line.qty,
        })),
      });
    }
    presented.sort((a, b) => b._id.localeCompare(a._id));
    return presented;
  },
});

export const get = query({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const delivery = await ctx.db.get(args.deliveryId);
    if (delivery === null) return null;
    const order = await ctx.db.get(delivery.salesOrderId);
    const customer = order === null ? null : await ctx.db.get(order.customerId);
    const quote = order === null ? null : await ctx.db.get(order.quoteId);
    const warehouse = await ctx.db.get(delivery.warehouseId);
    const lines = await linesOf(ctx, delivery._id);
    const intent = await ctx.db
      .query("journalIntents")
      .withIndex("by_source", (q) => q.eq("sourceType", "delivery").eq("sourceId", delivery._id))
      .unique();
    return {
      delivery: presentSlip(delivery, {
        orderNumber: order?.docNumber ?? "",
        customerName: customer?.name ?? "Customer",
        warehouseCode: warehouse?.code ?? "",
        warehouseName: warehouse?.name ?? "",
      }),
      quoteId: order?.quoteId ?? null,
      quoteNumber: quote?.docNumber ?? "",
      customerCode: customer?.code ?? "",
      shipTo: order?.shipTo ?? null,
      currency: order?.currency ?? "",
      decimalPlaces: order?.decimalPlaces ?? 2,
      lines,
      intent:
        intent === null
          ? null
          : {
              amount: intent.amount,
              period: intent.period,
              status: intent.status,
              currency: intent.currency,
            },
    };
  },
});

/**
 * Confirmed orders that still have quantity to pack, grouped by the
 * warehouse the order reserved.
 */
export const pickList = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const orders = await ctx.db.query("salesOrders").collect();
    const groups = new Map<
      string,
      {
        warehouseId: Id<"warehouses">;
        code: string;
        name: string;
        orders: {
          salesOrderId: Id<"salesOrders">;
          docNumber: string;
          customerName: string;
          lines: {
            lineId: Id<"salesOrderLines">;
            productId: Id<"products">;
            sku: string;
            description: string;
            packable: number;
          }[];
        }[];
      }
    >();
    for (const order of orders) {
      if (order.status !== "confirmed" && order.status !== "fulfilling") continue;
      if (order.warehouseId === undefined) continue;
      const lines = await orderLines(ctx, order._id);
      const packable = [];
      for (const line of lines) {
        const left = packableQty(line.reservedQty ?? 0, await openPackedQty(ctx, line._id));
        if (left <= 0) continue;
        packable.push({
          lineId: line._id,
          productId: line.productId,
          sku: line.sku,
          description: line.description,
          packable: left,
        });
      }
      if (packable.length === 0) continue;
      const warehouse = await ctx.db.get(order.warehouseId);
      if (warehouse === null) continue;
      const customer = await ctx.db.get(order.customerId);
      const existing = groups.get(order.warehouseId);
      const row = {
        salesOrderId: order._id,
        docNumber: order.docNumber,
        customerName: customer?.name ?? "Customer",
        lines: packable,
      };
      if (existing === undefined) {
        groups.set(order.warehouseId, {
          warehouseId: order.warehouseId,
          code: warehouse.code,
          name: warehouse.name,
          orders: [row],
        });
      } else {
        existing.orders.push(row);
      }
    }
    const presented = [...groups.values()];
    presented.sort((a, b) => a.code.localeCompare(b.code));
    for (const group of presented) {
      group.orders.sort((a, b) => a.docNumber.localeCompare(b.docNumber));
    }
    return presented;
  },
});

export const pack = auditedMutation({
  entity: "deliveries",
  action: "pack",
  args: {
    salesOrderId: v.id("salesOrders"),
    lines: v.array(
      v.object({
        lineId: v.id("salesOrderLines"),
        qty: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(packStatusError(order.status));
    if (order.warehouseId === undefined) {
      throw new ConvexError("Confirm the order before packing it.");
    }
    if (args.lines.length === 0) throw new ConvexError("Add a line.");
    const seen = new Set<string>();
    for (const entry of args.lines) {
      if (seen.has(entry.lineId)) throw new ConvexError("That line is listed twice.");
      seen.add(entry.lineId);
    }
    const lines = await orderLines(ctx, order._id);
    const chosen: { line: Doc<"salesOrderLines">; qty: number }[] = [];
    for (const entry of args.lines) {
      const line = lines.find((row) => row._id === entry.lineId);
      if (line === undefined) throw new ConvexError("That line isn't on this order.");
      const packable = packableQty(line.reservedQty ?? 0, await openPackedQty(ctx, line._id));
      throwIf(packQtyError(entry.qty, packable));
      chosen.push({ line, qty: entry.qty });
    }
    await ensureDefaultSequences(ctx);
    const docNumber = await nextSequence(ctx, "deliveryNote");
    const now = Date.now();
    const deliveryId = await ctx.db.insert("deliveries", {
      docNumber,
      salesOrderId: order._id,
      warehouseId: order.warehouseId,
      status: "packed",
      createdAt: now,
      updatedAt: now,
    });
    const packed = [];
    for (const [index, entry] of chosen.entries()) {
      const id = await ctx.db.insert("deliveryLines", {
        deliveryId,
        salesOrderLineId: entry.line._id,
        productId: entry.line.productId,
        ...(entry.line.variantId !== undefined ? { variantId: entry.line.variantId } : {}),
        description: entry.line.description,
        sku: entry.line.sku,
        qty: entry.qty,
        sort: index,
      });
      packed.push({ lineId: id, qty: entry.qty, sku: entry.line.sku });
    }
    return {
      result: deliveryId,
      audit: {
        entityId: deliveryId,
        after: { docNumber, status: "packed", salesOrderId: order._id, lines: packed },
      },
    };
  },
});

export const ship = auditedMutation({
  entity: "deliveries",
  action: "ship",
  args: {
    deliveryId: v.id("deliveries"),
    /** `YYYY-MM-DD`. Stored as UTC midnight. */
    shippedOn: v.string(),
    carrier: v.string(),
    trackingNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "edit");
    const delivery = await requireDelivery(ctx, args.deliveryId);
    throwIf(shipDeliveryError(delivery.status));
    throwIf(carrierError(args.carrier));
    throwIf(trackingError(args.trackingNumber));
    const day = priceDayFromInput(args.shippedOn);
    if ("error" in day) throw new ConvexError(day.error);
    const order = await requireOrder(ctx, delivery.salesOrderId);
    const slipLines = await linesOf(ctx, delivery._id);
    if (slipLines.length === 0) throw new ConvexError("Add a line.");
    const orderRows = await orderLines(ctx, order._id);
    const before = await salesOrderAudit(ctx, order);
    const intentLines = [];
    let amount = 0;
    for (const slipLine of slipLines) {
      const line = orderRows.find((row) => row._id === slipLine.salesOrderLineId);
      if (line === undefined) throw new ConvexError("That line isn't on this order.");
      const issued = await applyShipment(ctx, {
        order,
        line,
        qty: slipLine.qty,
        actorId,
      });
      await ctx.db.patch(slipLine._id, {
        movementId: issued.issueId,
        ...(issued.unitCost !== undefined ? { unitCost: issued.unitCost } : {}),
      });
      const lineAmount = cogsAmount(slipLine.qty, issued.unitCost);
      amount = roundMoney(amount + lineAmount);
      intentLines.push({
        productId: slipLine.productId,
        ...(slipLine.variantId !== undefined ? { variantId: slipLine.variantId } : {}),
        description: slipLine.description,
        qty: slipLine.qty,
        ...(issued.unitCost !== undefined ? { unitCost: issued.unitCost } : {}),
        amount: lineAmount,
      });
    }
    const carrier = args.carrier.trim();
    const trackingNumber = args.trackingNumber.trim();
    await ctx.db.patch(delivery._id, {
      status: "shipped",
      carrier,
      trackingNumber,
      shippedAt: day.ms,
      updatedAt: Date.now(),
    });
    const intentId = await ctx.db.insert("journalIntents", {
      type: "cogs",
      sourceType: "delivery",
      sourceId: delivery._id,
      status: "pending",
      period: intentPeriod(day.ms),
      currency: order.currency,
      amount,
      lines: intentLines,
      createdAt: Date.now(),
    });
    const afterOrder = await requireOrder(ctx, order._id);
    await appendAudit(ctx, {
      entity: "salesOrders",
      action: "fulfill",
      entityId: order._id,
      before,
      after: await salesOrderAudit(ctx, afterOrder),
    });
    return {
      result: delivery._id,
      audit: {
        entityId: delivery._id,
        before: { status: "packed" },
        after: {
          status: "shipped",
          carrier,
          trackingNumber,
          shippedAt: day.ms,
          intentId,
          amount,
        },
      },
    };
  },
});

export const cancel = auditedMutation({
  entity: "deliveries",
  action: "cancel",
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const delivery = await requireDelivery(ctx, args.deliveryId);
    throwIf(cancelDeliveryError(delivery.status));
    await ctx.db.patch(delivery._id, { status: "cancelled", updatedAt: Date.now() });
    return {
      result: delivery._id,
      audit: {
        entityId: delivery._id,
        before: { status: "packed" },
        after: { status: "cancelled" },
      },
    };
  },
});
