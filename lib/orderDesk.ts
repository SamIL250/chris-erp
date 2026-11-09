import { packableQty } from "./deliveries";
import type { InvoiceStatus } from "./invoices";
import { unbilledQty } from "./invoices";
import type { ReturnStatus } from "./salesReturns";
import type { SalesOrderStatus } from "./salesOrders";

/**
 * Order desk (PH2-19).
 *
 * Five queues. An open order is not closed and not cancelled. To pick
 * is reserved quantity that is not already on a packed slip. To ship
 * is a packed slip. To bill is shipped quantity on an order that can
 * still be invoiced, plus a draft invoice. A return is pending until
 * it is credited, exchanged, or cancelled.
 */

export const DESK_TILES = ["open", "pick", "ship", "bill", "returns"] as const;

export type DeskTile = (typeof DESK_TILES)[number];

export function deskTileLabel(tile: DeskTile): string {
  switch (tile) {
    case "open":
      return "Open orders";
    case "pick":
      return "To pick";
    case "ship":
      return "To ship";
    case "bill":
      return "To bill";
    case "returns":
      return "Returns pending";
    default: {
      const unreachable: never = tile;
      return unreachable;
    }
  }
}

/** Draft, confirmed, fulfilling, and invoiced. Closed and cancelled are done. */
export function isOpenOrder(status: SalesOrderStatus): boolean {
  switch (status) {
    case "draft":
    case "confirmed":
    case "fulfilling":
    case "invoiced":
      return true;
    case "closed":
    case "cancelled":
      return false;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Reserved quantity that is not already on a packed slip. */
export function toPickQty(reserved: number, packed: number): number {
  return packableQty(reserved, packed);
}

export function isToShip(status: "packed" | "shipped" | "cancelled"): boolean {
  switch (status) {
    case "packed":
      return true;
    case "shipped":
    case "cancelled":
      return false;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * Shipped quantity still to invoice. An invoiced or closed order is
 * not listed here: the invoice action only accepts a confirmed or
 * fulfilling order. A draft invoice is listed on its own.
 */
export function toBillQty(status: SalesOrderStatus, fulfilled: number, billed: number): number {
  switch (status) {
    case "confirmed":
    case "fulfilling":
      return unbilledQty(fulfilled, billed);
    case "draft":
    case "invoiced":
    case "closed":
    case "cancelled":
      return 0;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function isDraftInvoice(status: InvoiceStatus): boolean {
  switch (status) {
    case "draft":
      return true;
    case "posted":
    case "paid":
    case "void":
      return false;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Requested or received. Credited, exchanged, and cancelled are done. */
export function isReturnPending(status: ReturnStatus): boolean {
  switch (status) {
    case "requested":
    case "received":
      return true;
    case "credited":
    case "exchanged":
    case "cancelled":
      return false;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
