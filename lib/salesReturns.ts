import { invoiceStatusLabel, type InvoiceStatus } from "./invoices";
import { orderStatusLabel, type SalesOrderStatus } from "./salesOrders";

/**
 * Sales returns (PH2-18).
 *
 * A request names the lines and the quantity coming back, from a
 * posted invoice or from an order that has already shipped. Receiving
 * inspects each line: restock, quarantine, or write-off. The outcome
 * is a credit note or a draft exchange order. Cancelling is only
 * allowed before the goods are received.
 */

export const RETURN_STATUSES = [
  "requested",
  "received",
  "credited",
  "exchanged",
  "cancelled",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_DISPOSITIONS = ["restock", "quarantine", "writeOff"] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export const RETURN_REASON_MAX = 500;

const QTY_EPSILON = 1e-9;

export function returnStatusLabel(status: ReturnStatus): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "received":
      return "Received";
    case "credited":
      return "Credited";
    case "exchanged":
      return "Exchanged";
    case "cancelled":
      return "Cancelled";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function returnDispositionLabel(disposition: ReturnDisposition): string {
  switch (disposition) {
    case "restock":
      return "Restock";
    case "quarantine":
      return "Quarantine";
    case "writeOff":
      return "Write off";
    default: {
      const unreachable: never = disposition;
      return unreachable;
    }
  }
}

/** Quantity still open to request. A non-positive result is zero. */
export function returnableQty(limit: number, claimed: number): number {
  const left = limit - claimed;
  return left > QTY_EPSILON ? left : 0;
}

export function returnQtyError(qty: number, remaining: number): string | null {
  if (!Number.isFinite(qty) || qty <= QTY_EPSILON) {
    return "Quantity must be greater than zero.";
  }
  if (qty > remaining + QTY_EPSILON) {
    return remaining > QTY_EPSILON
      ? `Only ${qtyText(remaining)} is left to return on this line.`
      : "Nothing is left to return on this line.";
  }
  return null;
}

export function returnReasonError(raw: string): string | null {
  const reason = raw.trim();
  if (reason === "") return "Enter a reason.";
  if (reason.length > RETURN_REASON_MAX) {
    return `Reason must be ${RETURN_REASON_MAX} characters or fewer.`;
  }
  return null;
}

export function returnInvoiceStatusError(status: InvoiceStatus): string | null {
  if (status === "posted" || status === "paid") return null;
  return `A ${invoiceStatusLabel(status).toLowerCase()} invoice can't be returned.`;
}

/** Goods can come back only after they have shipped. */
export function returnOrderStatusError(status: SalesOrderStatus): string | null {
  switch (status) {
    case "fulfilling":
    case "invoiced":
    case "closed":
      return null;
    case "draft":
    case "confirmed":
    case "cancelled":
      return `A ${orderStatusLabel(status).toLowerCase()} order has nothing to take back.`;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function receiveReturnError(status: ReturnStatus): string | null {
  if (status === "requested") return null;
  return `A ${returnStatusLabel(status).toLowerCase()} return can't be received.`;
}

export function creditReturnError(status: ReturnStatus, hasInvoice: boolean): string | null {
  if (status !== "received") {
    return `A ${returnStatusLabel(status).toLowerCase()} return can't be credited.`;
  }
  if (!hasInvoice) return "This return has no invoice to credit. Exchange it instead.";
  return null;
}

export function exchangeReturnError(status: ReturnStatus): string | null {
  if (status === "received") return null;
  return `A ${returnStatusLabel(status).toLowerCase()} return can't be exchanged.`;
}

export function cancelReturnError(status: ReturnStatus): string | null {
  if (status === "requested") return null;
  return `A ${returnStatusLabel(status).toLowerCase()} return can't be cancelled.`;
}

function qtyText(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}
