import type { PurchaseOrderStatus } from "./purchaseOrders";
import type { VendorBillStatus } from "./vendorBills";

/**
 * Procurement desk (PH2-25).
 *
 * Four queues. An open purchase order is not billed. An overdue
 * delivery has been sent, is not fully received, and its expected date
 * is before today. Receipts pending are the units still to accept on a
 * sent or partly received order. A bill is pending match while it is
 * open. A received order with no bill is not in that queue.
 */

export const PROCUREMENT_DESK_TILES = ["open", "overdue", "receipts", "bills"] as const;

export type ProcurementDeskTile = (typeof PROCUREMENT_DESK_TILES)[number];

export function procurementDeskTileLabel(tile: ProcurementDeskTile): string {
  switch (tile) {
    case "open":
      return "Open purchase orders";
    case "overdue":
      return "Overdue deliveries";
    case "receipts":
      return "Receipts pending";
    case "bills":
      return "Bills pending match";
    default: {
      const unreachable: never = tile;
      return unreachable;
    }
  }
}

/** UTC midnight of the calendar day that contains `now`. */
export function procurementDeskToday(now: number): number {
  return Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Draft, sent, partially received, and received. Billed is finished. */
export function isOpenPurchaseOrder(status: PurchaseOrderStatus): boolean {
  switch (status) {
    case "draft":
    case "sent":
    case "partiallyReceived":
    case "received":
      return true;
    case "billed":
      return false;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * Sent or partly received, and the expected day is before today.
 * A draft has not been sent. A received or billed order has arrived.
 */
export function isOverdueDelivery(
  status: PurchaseOrderStatus,
  expectedDate: number,
  today: number,
): boolean {
  switch (status) {
    case "sent":
    case "partiallyReceived":
      return expectedDate < today;
    case "draft":
    case "received":
    case "billed":
      return false;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Units still to accept. A draft is not receivable yet, and a finished order is not. */
export function pendingReceiptQty(
  status: PurchaseOrderStatus,
  ordered: number,
  accepted: number,
): number {
  switch (status) {
    case "sent":
    case "partiallyReceived": {
      const remaining = ordered - accepted;
      return remaining > 0 ? remaining : 0;
    }
    case "draft":
    case "received":
    case "billed":
      return 0;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** An open bill is waiting to be matched. Matched and paid are done. */
export function isBillPendingMatch(status: VendorBillStatus): boolean {
  switch (status) {
    case "open":
      return true;
    case "matched":
    case "paid":
      return false;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
