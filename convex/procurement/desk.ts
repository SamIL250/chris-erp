import { formatQty } from "../../lib/inventory-display";
import { priceDayLabel } from "../../lib/pricing";
import {
  isBillPendingMatch,
  isOpenPurchaseOrder,
  isOverdueDelivery,
  pendingReceiptQty,
  procurementDeskToday,
} from "../../lib/procurementDesk";
import { purchaseOrderStatusLabel, type PurchaseOrderStatus } from "../../lib/purchaseOrders";
import { vendorBillStatusLabel, type VendorBillStatus } from "../../lib/vendorBills";
import { requirePermission } from "../_lib/permissions";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Procurement desk (PH2-25). One read, `procurement.view`, of the four
 * queues. The tiles are this query, so a receipt or a matched bill
 * moves the counts without a refresh.
 */

type Item = {
  id: string;
  kind: "purchaseOrder" | "vendorBill";
  number: string;
  vendorName: string;
  detail: string;
};

function byNumber(a: Item, b: Item): number {
  return a.number.localeCompare(b.number) || a.id.localeCompare(b.id);
}

async function vendorName(ctx: QueryCtx, vendorId: Id<"vendors">, names: Map<string, string>) {
  const cached = names.get(vendorId);
  if (cached !== undefined) return cached;
  const vendor = await ctx.db.get(vendorId);
  const name = vendor?.name ?? "Vendor";
  names.set(vendorId, name);
  return name;
}

async function acceptedQty(ctx: QueryCtx, purchaseOrderId: Id<"purchaseOrders">) {
  const receipts = await ctx.db
    .query("goodsReceipts")
    .withIndex("by_purchase_order", (q) => q.eq("purchaseOrderId", purchaseOrderId))
    .collect();
  let accepted = 0;
  for (const receipt of receipts) {
    const lines = await ctx.db
      .query("goodsReceiptLines")
      .withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id))
      .collect();
    for (const line of lines) {
      if (line.purchaseOrderLineId === undefined) continue;
      accepted += line.qtyAccepted ?? line.qty;
    }
  }
  return accepted;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "procurement", "view");
    const today = procurementDeskToday(Date.now());
    const names = new Map<string, string>();
    const open: Item[] = [];
    const overdue: Item[] = [];
    const receipts: Item[] = [];
    let receiptUnits = 0;

    const orders = await ctx.db.query("purchaseOrders").collect();
    for (const order of orders) {
      const status = order.status as PurchaseOrderStatus;
      const name = await vendorName(ctx, order.vendorId, names);
      if (isOpenPurchaseOrder(status)) {
        open.push({
          id: order._id,
          kind: "purchaseOrder",
          number: order.docNumber,
          vendorName: name,
          detail: purchaseOrderStatusLabel(status),
        });
      }
      if (isOverdueDelivery(status, order.expectedDate, today)) {
        overdue.push({
          id: order._id,
          kind: "purchaseOrder",
          number: order.docNumber,
          vendorName: name,
          detail: `Expected ${priceDayLabel(order.expectedDate)}`,
        });
      }
      const lines = await ctx.db
        .query("purchaseOrderLines")
        .withIndex("by_order", (q) => q.eq("purchaseOrderId", order._id))
        .collect();
      const ordered = lines.reduce((sum, line) => sum + line.qty, 0);
      const remaining = pendingReceiptQty(status, ordered, await acceptedQty(ctx, order._id));
      if (remaining > 0) {
        receiptUnits += remaining;
        receipts.push({
          id: order._id,
          kind: "purchaseOrder",
          number: order.docNumber,
          vendorName: name,
          detail: `${formatQty(remaining)} to receive`,
        });
      }
    }

    const bills: Item[] = [];
    const vendorBills = await ctx.db.query("vendorBills").collect();
    for (const bill of vendorBills) {
      const status = bill.status as VendorBillStatus;
      if (!isBillPendingMatch(status)) continue;
      bills.push({
        id: bill._id,
        kind: "vendorBill",
        number: bill.docNumber,
        vendorName: await vendorName(ctx, bill.vendorId, names),
        detail: vendorBillStatusLabel(status),
      });
    }

    open.sort(byNumber);
    overdue.sort(byNumber);
    receipts.sort(byNumber);
    bills.sort(byNumber);
    return {
      open: { count: open.length, rows: open },
      overdue: { count: overdue.length, rows: overdue },
      receipts: { count: receipts.length, units: receiptUnits, rows: receipts },
      bills: { count: bills.length, rows: bills },
    };
  },
});
