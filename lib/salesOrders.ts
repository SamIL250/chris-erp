/**
 * Sales-order lifecycle (PH2-12).
 *
 * Draft confirms into a reservation at one warehouse. A short line is
 * flagged backorder and keeps the rest of the order. Shipping a
 * reserved quantity moves the order to fulfilling. The packing slip
 * is the document that ships (PH2-14). A quantity that already left
 * is not packed again, and it is not issued a second time.
 * Invoiced and closed wait until every line has shipped. Cancelling
 * gives back whatever is still reserved. Stock that already left stays
 * out — a return is a later document.
 */

export const SALES_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "fulfilling",
  "invoiced",
  "closed",
  "cancelled",
] as const;

export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const SALES_ORDER_CHANNELS = ["manual", "storefront"] as const;

export type SalesOrderChannel = (typeof SALES_ORDER_CHANNELS)[number];

/** Ledger reference written by confirm, ship, and cancel. */
export const SALES_ORDER_REFERENCE = "salesOrder";

/** Float dust. A quantity this close to the line still fits. */
export const ORDER_QTY_EPSILON = 1e-9;

const STATUS_LABEL: Record<SalesOrderStatus, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  fulfilling: "Fulfilling",
  invoiced: "Invoiced",
  closed: "Closed",
  cancelled: "Cancelled",
};

export function isSalesOrderStatus(value: string): value is SalesOrderStatus {
  return (SALES_ORDER_STATUSES as readonly string[]).includes(value);
}

export function orderStatusLabel(status: SalesOrderStatus): string {
  return STATUS_LABEL[status];
}

export function isSalesOrderChannel(value: string): value is SalesOrderChannel {
  return (SALES_ORDER_CHANNELS as readonly string[]).includes(value);
}

export function orderChannelLabel(channel: SalesOrderChannel): string {
  switch (channel) {
    case "manual":
      return "Manual";
    case "storefront":
      return "Storefront";
    default: {
      const unreachable: never = channel;
      return unreachable;
    }
  }
}

/**
 * The forward path is draft → confirmed → fulfilling → invoiced →
 * closed. Cancel is allowed until the order is invoiced.
 */
export function orderStatusError(from: SalesOrderStatus, to: SalesOrderStatus): string | null {
  const allowed: Record<SalesOrderStatus, readonly SalesOrderStatus[]> = {
    draft: ["confirmed", "cancelled"],
    confirmed: ["fulfilling", "cancelled"],
    fulfilling: ["invoiced", "cancelled"],
    invoiced: ["closed"],
    closed: [],
    cancelled: [],
  };
  if (from === to || !allowed[from].includes(to)) {
    return `A ${orderStatusLabel(from).toLowerCase()} order can't be marked ${orderStatusLabel(to).toLowerCase()}.`;
  }
  return null;
}

/** Shipping is allowed once the order is confirmed, including a later part. */
export function shipStatusError(status: SalesOrderStatus): string | null {
  if (status === "confirmed" || status === "fulfilling") return null;
  return `A ${orderStatusLabel(status).toLowerCase()} order can't be shipped.`;
}

/** More stock can be reserved while the order is still open. */
export function reserveStatusError(status: SalesOrderStatus): string | null {
  if (status === "confirmed" || status === "fulfilling") return null;
  return `A ${orderStatusLabel(status).toLowerCase()} order can't reserve more stock.`;
}

export function reservedOf(line: { reservedQty?: number }): number {
  return line.reservedQty ?? 0;
}

export function fulfilledOf(line: { fulfilledQty?: number }): number {
  return line.fulfilledQty ?? 0;
}

/** Still unordered against stock: not reserved and not shipped. */
export function openOrderQty(line: {
  qty: number;
  reservedQty?: number;
  fulfilledQty?: number;
}): number {
  const open = line.qty - reservedOf(line) - fulfilledOf(line);
  return open > ORDER_QTY_EPSILON ? open : 0;
}

/** True when some of the ordered quantity is neither reserved nor shipped. */
export function isBackordered(line: {
  qty: number;
  reservedQty?: number;
  fulfilledQty?: number;
}): boolean {
  return line.qty > reservedOf(line) + fulfilledOf(line) + ORDER_QTY_EPSILON;
}

/** How much of the free stock this line takes. Never more than what is still open. */
export function reserveTake(open: number, available: number): number {
  if (!(open > ORDER_QTY_EPSILON) || !(available > ORDER_QTY_EPSILON)) return 0;
  return Math.min(open, available);
}

export function shipmentQtyError(qty: number, reserved: number): string | null {
  if (!Number.isFinite(qty) || qty <= ORDER_QTY_EPSILON) {
    return "Quantity must be greater than zero.";
  }
  if (qty > reserved + ORDER_QTY_EPSILON) {
    return reserved > ORDER_QTY_EPSILON
      ? `Only ${qtyText(reserved)} is reserved on this line.`
      : "Nothing is reserved on this line.";
  }
  return null;
}

/** Every ordered unit has shipped. An empty order is not ready. */
export function readyToInvoice(lines: readonly { qty: number; fulfilledQty?: number }[]): boolean {
  return (
    lines.length > 0 && lines.every((line) => fulfilledOf(line) + ORDER_QTY_EPSILON >= line.qty)
  );
}

function qtyText(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}
