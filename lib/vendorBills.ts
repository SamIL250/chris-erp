import { purchaseOrderExpectedError, purchaseOrderPriceError, purchaseOrderQtyError } from "./purchaseOrders";

/**
 * Vendor bills (PH2-23). An open bill is recorded from a received
 * purchase order or on its own. Matching compares the order, the
 * received quantity, and the bill. A price within 2% of the agreed
 * price passes. Quantity must equal what was received. A difference
 * between ordered and received is shown and does not block the match.
 * Matching writes a `vendorBill` journal intent. Payment is Phase 3,
 * so a bill is never marked paid here.
 */

export const VENDOR_BILL_STATUSES = ["open", "matched", "paid"] as const;
export type VendorBillStatus = (typeof VENDOR_BILL_STATUSES)[number];

/** Unit price may differ from the order by this fraction and still match. */
export const BILL_PRICE_TOLERANCE = 0.02;

export const BILL_REFERENCE_MAX = 40;

export function vendorBillStatusLabel(status: VendorBillStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "matched":
      return "Matched";
    case "paid":
      return "Paid";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function vendorBillStatusColor(
  status: VendorBillStatus,
): "warning" | "success" | "gray" {
  switch (status) {
    case "open":
      return "warning";
    case "matched":
      return "success";
    case "paid":
      return "gray";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function vendorBillQtyError(qty: number): string | null {
  return purchaseOrderQtyError(qty);
}

export function vendorBillPriceError(price: number): string | null {
  return purchaseOrderPriceError(price);
}

export function vendorBillDateError(ms: number): string | null {
  return purchaseOrderExpectedError(ms);
}

export function vendorBillReferenceError(reference: string | undefined): string | null {
  if (reference === undefined) return null;
  const trimmed = reference.trim();
  if (trimmed.length > BILL_REFERENCE_MAX) {
    return `A vendor reference can be at most ${BILL_REFERENCE_MAX} characters.`;
  }
  return null;
}

export function normalizeBillReference(reference: string | undefined): string | undefined {
  if (reference === undefined) return undefined;
  const trimmed = reference.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function vendorBillEditError(status: VendorBillStatus): string | null {
  switch (status) {
    case "open":
      return null;
    case "matched":
      return "A matched bill can't be edited.";
    case "paid":
      return "A paid bill can't be edited.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function vendorBillMatchError(status: VendorBillStatus): string | null {
  switch (status) {
    case "open":
      return null;
    case "matched":
      return "This bill is already matched.";
    case "paid":
      return "This bill is already paid.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Payment clears a matched bill in Phase 3. No status can be paid here. */
export function vendorBillPayError(status: VendorBillStatus): string {
  switch (status) {
    case "open":
    case "matched":
    case "paid":
      return "Recording a payment is Phase 3.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export type BillComparison = {
  orderedQty: number | null;
  receivedQty: number | null;
  billedQty: number;
  orderPrice: number | null;
  billPrice: number;
};

export type BillMatchIssue = { message: string; blocks: boolean };

/**
 * Ordered, received, and billed. A standalone bill has nothing to
 * compare, so it has no issues. Received differing from ordered is a
 * warning. Billed quantity and a price outside the tolerance block
 * the match.
 */
export function billMatchIssues(row: BillComparison): BillMatchIssue[] {
  if (row.orderedQty === null || row.receivedQty === null || row.orderPrice === null) return [];
  const issues: BillMatchIssue[] = [];
  if (qtyKey(row.receivedQty) !== qtyKey(row.orderedQty)) {
    issues.push({ message: "Received quantity differs from the order.", blocks: false });
  }
  if (qtyKey(row.billedQty) !== qtyKey(row.receivedQty)) {
    issues.push({ message: "Billed quantity differs from what was received.", blocks: true });
  }
  const diff = Math.abs(cents(row.billPrice) - cents(row.orderPrice));
  const band = Math.round(Math.abs(row.orderPrice) * BILL_PRICE_TOLERANCE * 100);
  if (diff > band) {
    issues.push({
      message: "Unit price differs from the order by more than the tolerance.",
      blocks: true,
    });
  }
  return issues;
}

export function billMatchBlocked(row: BillComparison): boolean {
  return billMatchIssues(row).some((issue) => issue.blocks);
}

function qtyKey(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

function cents(value: number): number {
  return Math.round(value * 100);
}
