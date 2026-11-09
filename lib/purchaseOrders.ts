import { priceDayFromInput } from "./pricing";
import { requisitionPriceError, requisitionQtyError } from "./requisitions";

/**
 * Purchase orders (PH2-21). A draft carries the agreed price, tax, and
 * the date the goods are expected. Sending freezes that snapshot and
 * marks the order sent. A receipt (PH2-22) moves it to partially
 * received or received. A vendor bill (PH2-23) marks it billed. Email
 * waits until Phase 4 wires Resend. The PDF is the send document.
 */

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "sent",
  "partiallyReceived",
  "received",
  "billed",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export function purchaseOrderStatusLabel(status: PurchaseOrderStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "partiallyReceived":
      return "Partially received";
    case "received":
      return "Received";
    case "billed":
      return "Billed";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function purchaseOrderStatusColor(
  status: PurchaseOrderStatus,
): "gray" | "brand" | "warning" | "success" {
  switch (status) {
    case "draft":
      return "gray";
    case "sent":
      return "brand";
    case "partiallyReceived":
      return "warning";
    case "received":
    case "billed":
      return "success";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function purchaseOrderExpectedError(ms: number): string | null {
  if (!Number.isInteger(ms)) return "Enter the date as YYYY-MM-DD.";
  const iso = new Date(ms).toISOString().slice(0, 10);
  const parsed = priceDayFromInput(iso);
  if ("error" in parsed || parsed.ms !== ms) return "Enter the date as YYYY-MM-DD.";
  return null;
}

export function purchaseOrderPriceError(price: number): string | null {
  return requisitionPriceError(price);
}

export function purchaseOrderQtyError(qty: number): string | null {
  return requisitionQtyError(qty);
}

export function purchaseOrderEditError(status: PurchaseOrderStatus): string | null {
  switch (status) {
    case "draft":
      return null;
    case "sent":
    case "partiallyReceived":
    case "received":
    case "billed":
      return `A ${purchaseOrderStatusLabel(status).toLowerCase()} purchase order can't be edited.`;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function purchaseOrderSendError(status: PurchaseOrderStatus): string | null {
  switch (status) {
    case "draft":
      return null;
    case "sent":
      return "This purchase order is already sent.";
    case "partiallyReceived":
    case "received":
    case "billed":
      return `A ${purchaseOrderStatusLabel(status).toLowerCase()} purchase order can't be sent.`;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * A receipt against a sent or partly received order. The received
 * quantity is the total accepted so far, not this delivery alone.
 * PH2-22 posts the stock movement and then uses this status.
 */
export function purchaseOrderReceivedStatus(
  status: PurchaseOrderStatus,
  orderedQty: number,
  receivedQty: number,
): { error: string } | { status: "partiallyReceived" | "received" } {
  switch (status) {
    case "sent":
    case "partiallyReceived":
      break;
    case "draft":
      return { error: "Send the purchase order before receiving it." };
    case "received":
      return { error: "This purchase order is already received." };
    case "billed":
      return { error: "A billed purchase order can't be received." };
    default: {
      const unreachable: never = status;
      return { error: unreachable };
    }
  }
  if (!(receivedQty > 0)) return { error: "Received quantity must be greater than zero." };
  if (receivedQty > orderedQty) return { error: "Received quantity can't exceed the order." };
  if (receivedQty < orderedQty) return { status: "partiallyReceived" };
  return { status: "received" };
}

/** A vendor bill (PH2-23) follows a fully received order. */
export function purchaseOrderBillError(status: PurchaseOrderStatus): string | null {
  switch (status) {
    case "received":
      return null;
    case "draft":
      return "Send the purchase order before billing it.";
    case "sent":
    case "partiallyReceived":
      return "Bill a purchase order after it is received.";
    case "billed":
      return "This purchase order is already billed.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
