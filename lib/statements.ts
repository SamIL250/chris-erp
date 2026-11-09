/**
 * Partner statement math (PH2-05).
 *
 * A customer balance is invoices, less credits and payments. Posted
 * and paid invoices add their gross. A posted credit note subtracts
 * its gross. Payments stay zero until those documents exist, and
 * marking an invoice paid does not count as a payment. A return is
 * listed and does not change the balance until its credit note posts.
 * Available
 * credit is the limit minus that balance. A missing limit is no cap.
 *
 * A vendor's received total is the cost on goods receipts that name
 * them. A line with no unit cost adds nothing. Bills are not in this
 * figure.
 */

export const CUSTOMER_DOCUMENT_KINDS = [
  "quote",
  "salesOrder",
  "delivery",
  "invoice",
  "creditNote",
  "salesReturn",
] as const;

export type CustomerDocumentKind = (typeof CUSTOMER_DOCUMENT_KINDS)[number];

export type CustomerDocument = {
  kind: CustomerDocumentKind;
  id: string;
  number: string;
  at: number;
  amount: number;
};

export function documentKindLabel(kind: CustomerDocumentKind): string {
  switch (kind) {
    case "quote":
      return "Quote";
    case "salesOrder":
      return "Sales order";
    case "delivery":
      return "Delivery";
    case "invoice":
      return "Invoice";
    case "creditNote":
      return "Credit note";
    case "salesReturn":
      return "Return";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Cents, so 0.1 + 0.2 does not surface as a long float. */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function accountBalance(parts: {
  invoiced: number;
  credited: number;
  paid: number;
}): number {
  return roundMoney(parts.invoiced - parts.credited - parts.paid);
}

/** `null` when the customer has no credit cap. */
export function availableCredit(creditLimit: number | null, balance: number): number | null {
  if (creditLimit === null) return null;
  return roundMoney(creditLimit - balance);
}

export type CostedLine = { qty: number; unitCost?: number };

/**
 * Sum of qty × unit cost. `null` when no line carries a cost, so a
 * receipt that never recorded one is not shown as zero.
 */
export function receiptAmount(lines: CostedLine[]): number | null {
  let sum = 0;
  let any = false;
  for (const line of lines) {
    if (line.unitCost === undefined) continue;
    any = true;
    sum += line.qty * line.unitCost;
  }
  return any ? roundMoney(sum) : null;
}

export function receivedTotal(amounts: (number | null)[]): number {
  let sum = 0;
  for (const amount of amounts) sum += amount ?? 0;
  return roundMoney(sum);
}
