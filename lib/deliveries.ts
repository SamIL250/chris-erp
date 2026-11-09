/**
 * Packing slips (PH2-14).
 *
 * A slip claims reserved quantity. It does not move stock. Shipping
 * is the goods issue: the order line is fulfilled, the issue keeps
 * the unit cost, and one cost-of-goods intent is written. Quantity
 * that already left the warehouse is not packed, so it is not issued
 * again.
 */

import { orderStatusLabel, type SalesOrderStatus } from "./salesOrders";
import { roundMoney } from "./statements";

export const DELIVERY_STATUSES = ["packed", "shipped", "cancelled"] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const CARRIER_MAX = 80;
export const TRACKING_MAX = 40;

const QTY_EPSILON = 1e-9;

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  packed: "Packed",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(value);
}

export function deliveryStatusLabel(status: DeliveryStatus): string {
  return STATUS_LABEL[status];
}

/** Packing is allowed once the order is confirmed, including a later part. */
export function packStatusError(status: SalesOrderStatus): string | null {
  if (status === "confirmed" || status === "fulfilling") return null;
  return `A ${orderStatusLabel(status).toLowerCase()} order can't be packed.`;
}

/** Still reserved, and not already sitting on another packed slip. */
export function packableQty(reserved: number, packed: number): number {
  const left = reserved - packed;
  return left > QTY_EPSILON ? left : 0;
}

export function packQtyError(qty: number, packable: number): string | null {
  if (!Number.isFinite(qty) || qty <= QTY_EPSILON) {
    return "Quantity must be greater than zero.";
  }
  if (qty > packable + QTY_EPSILON) {
    return packable > QTY_EPSILON
      ? `Only ${qtyText(packable)} can be packed on this line.`
      : "Nothing is left to pack on this line.";
  }
  return null;
}

export function shipDeliveryError(status: DeliveryStatus): string | null {
  if (status === "packed") return null;
  return `A ${deliveryStatusLabel(status).toLowerCase()} delivery can't be shipped.`;
}

export function cancelDeliveryError(status: DeliveryStatus): string | null {
  if (status === "packed") return null;
  return `A ${deliveryStatusLabel(status).toLowerCase()} delivery can't be cancelled.`;
}

export function carrierError(value: string): string | null {
  const carrier = value.trim();
  if (carrier === "") return "Enter a carrier.";
  if (carrier.length > CARRIER_MAX) return `Carrier must be ${CARRIER_MAX} characters or fewer.`;
  return null;
}

export function trackingError(value: string): string | null {
  const tracking = value.trim();
  if (tracking === "") return "Enter a tracking number.";
  if (tracking.length > TRACKING_MAX) {
    return `Tracking number must be ${TRACKING_MAX} characters or fewer.`;
  }
  return null;
}

/** `YYYY-MM` from a UTC midnight ship date. */
export function intentPeriod(shippedAt: number): string {
  return new Date(shippedAt).toISOString().slice(0, 7);
}

/** Quantity times the captured unit cost. No cost is zero, so the intent still exists. */
export function cogsAmount(qty: number, unitCost: number | undefined): number {
  if (unitCost === undefined) return 0;
  return roundMoney(qty * unitCost);
}

function qtyText(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}
