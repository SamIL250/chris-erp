import { deliveryStatusLabel } from "../../lib/deliveries";
import { formatQty } from "../../lib/inventory-display";
import { invoiceStatusLabel } from "../../lib/invoices";
import {
  isDraftInvoice,
  isOpenOrder,
  isReturnPending,
  isToShip,
  toBillQty,
  toPickQty,
} from "../../lib/orderDesk";
import { fulfilledOf, orderStatusLabel } from "../../lib/salesOrders";
import { returnStatusLabel } from "../../lib/salesReturns";
import { requirePermission } from "../_lib/permissions";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { billedQty } from "./invoices";
import { openPackedQty } from "./orders";

/**
 * Order desk (PH2-19). One read, `sales.view`, of the five queues.
 * The tiles are this query, so a packed slip or a posted invoice
 * moves the counts without a refresh.
 */

type Item = {
  id: string;
  kind: "order" | "delivery" | "invoice" | "return";
  number: string;
  customerName: string;
  detail: string;
};

function byNumber(a: Item, b: Item): number {
  return a.number.localeCompare(b.number) || a.id.localeCompare(b.id);
}

async function customerName(
  ctx: QueryCtx,
  customerId: Id<"customers">,
  names: Map<string, string>,
) {
  const cached = names.get(customerId);
  if (cached !== undefined) return cached;
  const customer = await ctx.db.get(customerId);
  const name = customer?.name ?? "Customer";
  names.set(customerId, name);
  return name;
}

async function orderLines(ctx: QueryCtx, salesOrderId: Id<"salesOrders">) {
  return await ctx.db
    .query("salesOrderLines")
    .withIndex("by_order", (q) => q.eq("salesOrderId", salesOrderId))
    .collect();
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const names = new Map<string, string>();
    const open: Item[] = [];
    const pick: Item[] = [];
    const bill: Item[] = [];
    let pickUnits = 0;
    let billUnits = 0;

    const orders = await ctx.db.query("salesOrders").collect();
    for (const order of orders) {
      const name = await customerName(ctx, order.customerId, names);
      if (isOpenOrder(order.status)) {
        open.push({
          id: order._id,
          kind: "order",
          number: order.docNumber,
          customerName: name,
          detail: orderStatusLabel(order.status),
        });
      }
      const lines = await orderLines(ctx, order._id);
      let pickQty = 0;
      for (const line of lines) {
        pickQty += toPickQty(line.reservedQty ?? 0, await openPackedQty(ctx, line._id));
      }
      if (pickQty > 0) {
        pickUnits += pickQty;
        pick.push({
          id: order._id,
          kind: "order",
          number: order.docNumber,
          customerName: name,
          detail: `${formatQty(pickQty)} to pick`,
        });
      }
      const billed = await billedQty(ctx, order._id);
      let billQty = 0;
      for (const line of lines) {
        billQty += toBillQty(order.status, fulfilledOf(line), billed.get(line._id) ?? 0);
      }
      if (billQty > 0) {
        billUnits += billQty;
        bill.push({
          id: order._id,
          kind: "order",
          number: order.docNumber,
          customerName: name,
          detail: `${formatQty(billQty)} to bill`,
        });
      }
    }

    const ship: Item[] = [];
    const slips = await ctx.db.query("deliveries").collect();
    for (const slip of slips) {
      if (!isToShip(slip.status)) continue;
      const order = await ctx.db.get(slip.salesOrderId);
      const name = order === null ? "Customer" : await customerName(ctx, order.customerId, names);
      const warehouse = await ctx.db.get(slip.warehouseId);
      ship.push({
        id: slip._id,
        kind: "delivery",
        number: slip.docNumber,
        customerName: name,
        detail: warehouse === null ? deliveryStatusLabel(slip.status) : warehouse.code,
      });
    }

    const invoices = await ctx.db.query("salesInvoices").collect();
    for (const invoice of invoices) {
      if (!isDraftInvoice(invoice.status)) continue;
      const lines = await ctx.db
        .query("salesInvoiceLines")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      let qty = 0;
      for (const line of lines) qty += line.qty;
      billUnits += qty;
      bill.push({
        id: invoice._id,
        kind: "invoice",
        number: invoice.docNumber,
        customerName: await customerName(ctx, invoice.customerId, names),
        detail: invoiceStatusLabel(invoice.status),
      });
    }

    const returns: Item[] = [];
    const notes = await ctx.db.query("salesReturns").collect();
    for (const row of notes) {
      if (!isReturnPending(row.status)) continue;
      returns.push({
        id: row._id,
        kind: "return",
        number: row.docNumber,
        customerName: await customerName(ctx, row.customerId, names),
        detail: returnStatusLabel(row.status),
      });
    }

    open.sort(byNumber);
    pick.sort(byNumber);
    ship.sort(byNumber);
    bill.sort(byNumber);
    returns.sort(byNumber);
    return {
      open: { count: open.length, rows: open },
      pick: { count: pick.length, units: pickUnits, rows: pick },
      ship: { count: ship.length, rows: ship },
      bill: { count: bill.length, units: billUnits, rows: bill },
      returns: { count: returns.length, rows: returns },
    };
  },
});
