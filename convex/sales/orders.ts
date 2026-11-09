import { ConvexError, v } from "convex/values";
import {
  ORDER_QTY_EPSILON,
  SALES_ORDER_REFERENCE,
  fulfilledOf,
  isBackordered,
  openOrderQty,
  orderStatusError,
  readyToInvoice,
  reserveStatusError,
  reserveTake,
  reservedOf,
  shipStatusError,
  shipmentQtyError,
  type SalesOrderStatus,
} from "../../lib/salesOrders";
import { marginPercent, priceDay } from "../../lib/pricing";
import { quoteTotals } from "../../lib/quotes";
import { appendAudit, auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { allocateStock, releaseStock, reserveStock, stockPosition } from "../inventory/stock";
import { resolveStoredPrice } from "./prices";

/**
 * Sales orders (PH2-12). A quote opens a draft. Confirm reserves free
 * stock at one warehouse and flags a short line as backorder. Shipping
 * part of a line allocates that reservation (release + issue). The
 * rest stays held. Invoice and close wait until every line has
 * shipped. Cancel releases whatever is still reserved.
 *
 * Confirm, cancel, invoice, and close are `sales.create`, so warehouse
 * cannot commit the order. Shipping and topping up a backorder are
 * `sales.edit`, which is the warehouse fulfillment grant. Reads are
 * `sales.view`.
 */

function throwIf(message: string | null) {
  if (message !== null) throw new ConvexError(message);
}

async function requireOrder(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const order = await ctx.db.get(salesOrderId);
  if (order === null) throw new ConvexError("Order not found.");
  return order;
}

async function linesOf(ctx: QueryCtx | MutationCtx, salesOrderId: Id<"salesOrders">) {
  const lines = await ctx.db
    .query("salesOrderLines")
    .withIndex("by_order", (q) => q.eq("salesOrderId", salesOrderId))
    .collect();
  lines.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
  return lines;
}

function presentLine(line: Doc<"salesOrderLines">) {
  return {
    ...line,
    reservedQty: reservedOf(line),
    fulfilledQty: fulfilledOf(line),
    backorder: line.backorder === true,
  };
}

function lineSnapshot(line: Doc<"salesOrderLines">) {
  return {
    lineId: line._id,
    reservedQty: reservedOf(line),
    fulfilledQty: fulfilledOf(line),
    backorder: line.backorder === true,
  };
}

export async function salesOrderAudit(ctx: MutationCtx, order: Doc<"salesOrders">) {
  const lines = await linesOf(ctx, order._id);
  return {
    status: order.status,
    warehouseId: order.warehouseId,
    lines: lines.map(lineSnapshot),
  };
}

/** Quantity of this line sitting on a packed slip that has not shipped. */
export async function openPackedQty(
  ctx: QueryCtx | MutationCtx,
  lineId: Id<"salesOrderLines">,
): Promise<number> {
  const rows = await ctx.db
    .query("deliveryLines")
    .withIndex("by_order_line", (q) => q.eq("salesOrderLineId", lineId))
    .collect();
  let packed = 0;
  for (const row of rows) {
    const slip = await ctx.db.get(row.deliveryId);
    if (slip?.status === "packed") packed += row.qty;
  }
  return packed;
}

/**
 * Turn reserved quantity into a goods issue and mark the order
 * fulfilling. The packing slip calls this. The public fulfill
 * action does too, and refuses quantity a slip already claims.
 */
export async function applyShipment(
  ctx: MutationCtx,
  args: {
    order: Doc<"salesOrders">;
    line: Doc<"salesOrderLines">;
    qty: number;
    actorId: Id<"users">;
  },
): Promise<{ issueId: Id<"stockMovements">; unitCost: number | undefined }> {
  throwIf(shipStatusError(args.order.status));
  throwIf(shipmentQtyError(args.qty, reservedOf(args.line)));
  if (args.order.warehouseId === undefined) {
    throw new ConvexError("Confirm the order before shipping.");
  }
  const position = await stockPosition(ctx, {
    productId: args.line.productId,
    warehouseId: args.order.warehouseId,
    ...(args.line.variantId !== undefined ? { variantId: args.line.variantId } : {}),
  });
  const issued = await allocateStock(ctx, {
    ...holdFor(args.order, args.line, args.actorId),
    qty: args.qty,
    ...(position.unitCost !== undefined ? { unitCost: position.unitCost } : {}),
  });
  const reservedQty = reservedOf(args.line) - args.qty;
  const storedReserved = reservedQty <= ORDER_QTY_EPSILON ? 0 : reservedQty;
  const fulfilledQty = fulfilledOf(args.line) + args.qty;
  await ctx.db.patch(args.line._id, {
    reservedQty: storedReserved,
    fulfilledQty,
    backorder: isBackordered({ qty: args.line.qty, reservedQty: storedReserved, fulfilledQty }),
  });
  const next: SalesOrderStatus = "fulfilling";
  await ctx.db.patch(args.order._id, { status: next, updatedAt: Date.now() });
  return { issueId: issued.issueId, unitCost: position.unitCost };
}

function holdFor(order: Doc<"salesOrders">, line: Doc<"salesOrderLines">, actorId: Id<"users">) {
  if (order.warehouseId === undefined) throw new ConvexError("Confirm the order before shipping.");
  return {
    productId: line.productId,
    ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
    warehouseId: order.warehouseId,
    referenceType: SALES_ORDER_REFERENCE,
    referenceId: order._id,
    actorId,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const orders = await ctx.db.query("salesOrders").collect();
    const customers = await ctx.db.query("customers").collect();
    const names = new Map(customers.map((row) => [row._id, row]));
    const presented = [];
    for (const order of orders) {
      const lines = await linesOf(ctx, order._id);
      const customer = names.get(order.customerId);
      presented.push({
        _id: order._id,
        docNumber: order.docNumber,
        quoteId: order.quoteId,
        customerName: customer?.name ?? "Customer",
        status: order.status,
        currency: order.currency,
        decimalPlaces: order.decimalPlaces,
        gross: quoteTotals(lines, order.decimalPlaces).gross,
        createdAt: order.createdAt,
      });
    }
    presented.sort((a, b) => b.createdAt - a.createdAt || a._id.localeCompare(b._id));
    return presented;
  },
});

export const get = query({
  args: {
    salesOrderId: v.id("salesOrders"),
    /** While the order is a draft, availability is read at this warehouse. */
    warehouseId: v.optional(v.id("warehouses")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const order = await ctx.db.get(args.salesOrderId);
    if (order === null) return null;
    const customer = await ctx.db.get(order.customerId);
    const quote = await ctx.db.get(order.quoteId);
    const stockWarehouseId = order.warehouseId ?? args.warehouseId;
    const warehouse = stockWarehouseId === undefined ? null : await ctx.db.get(stockWarehouseId);
    const lines = await linesOf(ctx, order._id);
    const today = priceDay(Date.now());
    const presented = [];
    for (const line of lines) {
      let liveUnitPrice: number | null = null;
      if (today !== null) {
        try {
          const resolved = await resolveStoredPrice(ctx, {
            customerId: order.customerId,
            productId: line.productId,
            variantId: line.variantId ?? null,
            qty: line.qty,
            date: today,
            currency: order.currency,
          });
          liveUnitPrice = resolved.unitPrice;
        } catch (err) {
          if (!(err instanceof ConvexError)) throw err;
          liveUnitPrice = null;
        }
      }
      let available: number | null = null;
      let onHand: number | null = null;
      if (stockWarehouseId !== undefined) {
        const position = await stockPosition(ctx, {
          productId: line.productId,
          warehouseId: stockWarehouseId,
          ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
        });
        available = position.available;
        onHand = position.onHand;
      }
      const product = await ctx.db.get(line.productId);
      presented.push({
        ...presentLine(line),
        liveUnitPrice,
        available,
        onHand,
        marginPercent: marginPercent(line.unitPrice, product?.costPrice),
      });
    }
    return {
      order: {
        ...order,
        customerName: customer?.name ?? "Customer",
        customerCode: customer?.code ?? "",
        customerStatus: customer?.status ?? null,
        quoteNumber: quote?.docNumber ?? "",
        warehouseCode: warehouse?.code ?? "",
        warehouseName: warehouse?.name ?? "",
      },
      lines: presented,
      totals: quoteTotals(lines, order.decimalPlaces),
    };
  },
});

export const confirm = auditedMutation({
  entity: "salesOrders",
  action: "confirm",
  args: { salesOrderId: v.id("salesOrders"), warehouseId: v.id("warehouses") },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "create");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(orderStatusError(order.status, "confirmed"));
    const customer = await ctx.db.get(order.customerId);
    if (customer === null) throw new ConvexError("Customer not found.");
    if (customer.status === "closed") throw new ConvexError("That customer is closed.");
    const warehouse = await ctx.db.get(args.warehouseId);
    if (warehouse === null) throw new ConvexError("Warehouse not found.");
    if (!warehouse.active) {
      throw new ConvexError("That warehouse is inactive. Choose an active warehouse.");
    }
    const lines = await linesOf(ctx, order._id);
    if (lines.length === 0) throw new ConvexError("Add a line before confirming the order.");
    const before = await salesOrderAudit(ctx, order);
    const now = Date.now();
    await ctx.db.patch(order._id, {
      status: "confirmed",
      warehouseId: args.warehouseId,
      updatedAt: now,
    });
    const confirmed = await requireOrder(ctx, order._id);
    for (const line of lines) {
      const position = await stockPosition(ctx, {
        productId: line.productId,
        warehouseId: args.warehouseId,
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
      });
      const take = reserveTake(openOrderQty(line), position.available);
      if (take > ORDER_QTY_EPSILON) {
        await reserveStock(ctx, {
          ...holdFor(confirmed, line, actorId),
          qty: take,
          ...(position.unitCost !== undefined ? { unitCost: position.unitCost } : {}),
        });
      }
      const reservedQty = take;
      await ctx.db.patch(line._id, {
        reservedQty,
        fulfilledQty: 0,
        backorder: isBackordered({ qty: line.qty, reservedQty, fulfilledQty: 0 }),
      });
    }
    const afterOrder = await requireOrder(ctx, order._id);
    return {
      result: order._id,
      audit: { entityId: order._id, before, after: await salesOrderAudit(ctx, afterOrder) },
    };
  },
});

export const reserve = auditedMutation({
  entity: "salesOrders",
  action: "reserve",
  args: {
    salesOrderId: v.id("salesOrders"),
    lineId: v.optional(v.id("salesOrderLines")),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "edit");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(reserveStatusError(order.status));
    if (order.warehouseId === undefined) {
      throw new ConvexError("Confirm the order before reserving more stock.");
    }
    const lines = await linesOf(ctx, order._id);
    const targets =
      args.lineId === undefined ? lines : lines.filter((line) => line._id === args.lineId);
    if (args.lineId !== undefined && targets.length === 0) {
      throw new ConvexError("That line isn't on this order.");
    }
    const before = await salesOrderAudit(ctx, order);
    let took = 0;
    for (const line of targets) {
      const open = openOrderQty(line);
      if (open <= ORDER_QTY_EPSILON) continue;
      const position = await stockPosition(ctx, {
        productId: line.productId,
        warehouseId: order.warehouseId,
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
      });
      const take = reserveTake(open, position.available);
      if (take <= ORDER_QTY_EPSILON) continue;
      await reserveStock(ctx, {
        ...holdFor(order, line, actorId),
        qty: take,
        ...(position.unitCost !== undefined ? { unitCost: position.unitCost } : {}),
      });
      const reservedQty = reservedOf(line) + take;
      const fulfilledQty = fulfilledOf(line);
      await ctx.db.patch(line._id, {
        reservedQty,
        fulfilledQty,
        backorder: isBackordered({ qty: line.qty, reservedQty, fulfilledQty }),
      });
      took += take;
    }
    if (took <= ORDER_QTY_EPSILON) throw new ConvexError("Nothing available to reserve.");
    await ctx.db.patch(order._id, { updatedAt: Date.now() });
    const afterOrder = await requireOrder(ctx, order._id);
    return {
      result: order._id,
      audit: { entityId: order._id, before, after: await salesOrderAudit(ctx, afterOrder) },
    };
  },
});

export const fulfill = auditedMutation({
  entity: "salesOrders",
  action: "fulfill",
  args: {
    salesOrderId: v.id("salesOrders"),
    lineId: v.id("salesOrderLines"),
    qty: v.number(),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "edit");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(shipStatusError(order.status));
    const lines = await linesOf(ctx, order._id);
    const line = lines.find((row) => row._id === args.lineId);
    if (line === undefined) throw new ConvexError("That line isn't on this order.");
    const reserved = reservedOf(line);
    throwIf(shipmentQtyError(args.qty, reserved));
    const claimed = await openPackedQty(ctx, line._id);
    if (args.qty > reserved - claimed + ORDER_QTY_EPSILON) {
      throw new ConvexError("That quantity is already on a packing slip.");
    }
    const before = await salesOrderAudit(ctx, order);
    await applyShipment(ctx, { order, line, qty: args.qty, actorId });
    const afterOrder = await requireOrder(ctx, order._id);
    return {
      result: order._id,
      audit: { entityId: order._id, before, after: await salesOrderAudit(ctx, afterOrder) },
    };
  },
});

export const invoice = auditedMutation({
  entity: "salesOrders",
  action: "invoice",
  args: { salesOrderId: v.id("salesOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(orderStatusError(order.status, "invoiced"));
    const lines = await linesOf(ctx, order._id);
    if (!readyToInvoice(lines)) {
      throw new ConvexError("Ship every line before invoicing this order.");
    }
    const before = await salesOrderAudit(ctx, order);
    await ctx.db.patch(order._id, { status: "invoiced", updatedAt: Date.now() });
    const afterOrder = await requireOrder(ctx, order._id);
    return {
      result: order._id,
      audit: { entityId: order._id, before, after: await salesOrderAudit(ctx, afterOrder) },
    };
  },
});

export const close = auditedMutation({
  entity: "salesOrders",
  action: "close",
  args: { salesOrderId: v.id("salesOrders") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(orderStatusError(order.status, "closed"));
    const before = await salesOrderAudit(ctx, order);
    await ctx.db.patch(order._id, { status: "closed", updatedAt: Date.now() });
    const afterOrder = await requireOrder(ctx, order._id);
    return {
      result: order._id,
      audit: { entityId: order._id, before, after: await salesOrderAudit(ctx, afterOrder) },
    };
  },
});

export const cancel = auditedMutation({
  entity: "salesOrders",
  action: "cancel",
  args: { salesOrderId: v.id("salesOrders") },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "sales", "create");
    const order = await requireOrder(ctx, args.salesOrderId);
    throwIf(orderStatusError(order.status, "cancelled"));
    const before = await salesOrderAudit(ctx, order);
    const slips = await ctx.db
      .query("deliveries")
      .withIndex("by_order", (q) => q.eq("salesOrderId", order._id))
      .collect();
    for (const slip of slips) {
      if (slip.status !== "packed") continue;
      await ctx.db.patch(slip._id, { status: "cancelled", updatedAt: Date.now() });
      await appendAudit(ctx, {
        entity: "deliveries",
        action: "cancel",
        entityId: slip._id,
        before: { status: "packed" },
        after: { status: "cancelled" },
      });
    }
    const lines = await linesOf(ctx, order._id);
    for (const line of lines) {
      const reserved = reservedOf(line);
      if (reserved > ORDER_QTY_EPSILON && order.warehouseId !== undefined) {
        await releaseStock(ctx, { ...holdFor(order, line, actorId), qty: reserved });
      }
      await ctx.db.patch(line._id, { reservedQty: 0, backorder: false });
    }
    await ctx.db.patch(order._id, { status: "cancelled", updatedAt: Date.now() });
    const afterOrder = await requireOrder(ctx, order._id);
    return {
      result: order._id,
      audit: { entityId: order._id, before, after: await salesOrderAudit(ctx, afterOrder) },
    };
  },
});
