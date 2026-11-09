import { intentPeriod } from "./deliveries";
import { roundUnitPrice } from "./pricing";
import type { TaxCategory } from "./quotes";
import { orderStatusLabel, readyToInvoice, type SalesOrderStatus } from "./salesOrders";

/**
 * Sales invoices (PH2-16).
 *
 * A draft is generated from quantity that has already shipped, on the
 * order or on one delivery. The charged unit and the tax rate are
 * copied from the order line. Posting writes one `salesInvoice`
 * journal intent. A draft can be voided. A posted invoice is marked
 * paid here; a payment that reduces the balance waits for Phase 3.
 * Voiding a posted invoice waits for a credit note (PH2-17).
 */

export const INVOICE_STATUSES = ["draft", "posted", "paid", "void"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const QTY_EPSILON = 1e-9;
const DAY_MS = 86_400_000;

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  paid: "Paid",
  void: "Void",
};

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return STATUS_LABEL[status];
}

export function taxCategoryLabel(category: TaxCategory): string {
  switch (category) {
    case "standard":
      return "Standard";
    case "reduced":
      return "Reduced";
    case "zero":
      return "Zero";
    case "exempt":
      return "Exempt";
    default: {
      const unreachable: never = category;
      return unreachable;
    }
  }
}

/** Shipped quantity that is not already on a draft, posted, or paid invoice. */
export function unbilledQty(fulfilled: number, billed: number): number {
  const left = fulfilled - billed;
  return left > QTY_EPSILON ? left : 0;
}

/** UTC midnight of the due date. Zero terms are due on the invoice date. */
export function dueOn(invoiceDate: number, paymentTermsDays: number): number {
  return invoiceDate + paymentTermsDays * DAY_MS;
}

export function invoicePeriod(invoiceDate: number): string {
  return intentPeriod(invoiceDate);
}

export function invoiceOrderStatusError(status: SalesOrderStatus): string | null {
  if (status === "confirmed" || status === "fulfilling") return null;
  return `A ${orderStatusLabel(status).toLowerCase()} order can't be invoiced.`;
}

export function postInvoiceError(status: InvoiceStatus): string | null {
  if (status === "draft") return null;
  return `A ${invoiceStatusLabel(status).toLowerCase()} invoice can't be posted.`;
}

export function voidInvoiceError(status: InvoiceStatus): string | null {
  if (status === "draft") return null;
  return `A ${invoiceStatusLabel(status).toLowerCase()} invoice can't be voided.`;
}

export function payInvoiceError(status: InvoiceStatus): string | null {
  if (status === "posted") return null;
  return `A ${invoiceStatusLabel(status).toLowerCase()} invoice can't be marked paid.`;
}

export type TaxSlice = {
  taxCategory: TaxCategory;
  rateBps: number;
  inclusive: boolean;
  net: number;
  tax: number;
};

/** Tax summed by category and rate. Each figure rounds to the currency. */
export function taxBreakdown(
  lines: readonly {
    taxCategory: TaxCategory;
    rateBps: number;
    inclusive: boolean;
    net: number;
    tax: number;
  }[],
  decimalPlaces: number,
): TaxSlice[] {
  const groups = new Map<string, TaxSlice>();
  for (const line of lines) {
    const key = `${line.taxCategory}:${line.rateBps}:${line.inclusive ? "in" : "ex"}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        taxCategory: line.taxCategory,
        rateBps: line.rateBps,
        inclusive: line.inclusive,
        net: line.net,
        tax: line.tax,
      });
      continue;
    }
    existing.net += line.net;
    existing.tax += line.tax;
  }
  return [...groups.values()].map((slice) => ({
    ...slice,
    net: roundUnitPrice(slice.net, decimalPlaces),
    tax: roundUnitPrice(slice.tax, decimalPlaces),
  }));
}

/**
 * The order can move to invoiced once every line has shipped and
 * every shipped unit sits on an invoice that is still open.
 */
export function orderCoveredByInvoices(
  lines: readonly { qty: number; fulfilledQty?: number; billedQty: number }[],
): boolean {
  if (!readyToInvoice(lines)) return false;
  return lines.every((line) => unbilledQty(line.fulfilledQty ?? 0, line.billedQty) === 0);
}
