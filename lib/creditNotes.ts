import { invoiceStatusLabel, type InvoiceStatus } from "./invoices";

/**
 * Credit notes (PH2-17).
 *
 * A note reduces one posted or paid invoice. A return may put the
 * goods back in stock. An adjustment never does. Posting writes one
 * `creditNote` journal intent. A draft can be voided. The return
 * request and the inspection are a sales return.
 */

export const CREDIT_KINDS = ["return", "adjustment"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

export const CREDIT_STATUSES = ["draft", "posted", "void"] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export const CREDIT_REASON_MAX = 500;

const QTY_EPSILON = 1e-9;

export function creditKindLabel(kind: CreditKind): string {
  switch (kind) {
    case "return":
      return "Return";
    case "adjustment":
      return "Adjustment";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function creditStatusLabel(status: CreditStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "posted":
      return "Posted";
    case "void":
      return "Void";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Invoice quantity not already on a draft or posted credit note. */
export function uncreditedQty(invoiced: number, credited: number): number {
  const left = invoiced - credited;
  return left > QTY_EPSILON ? left : 0;
}

export function creditQtyError(qty: number, remaining: number): string | null {
  if (!Number.isFinite(qty) || qty <= QTY_EPSILON) {
    return "Quantity must be greater than zero.";
  }
  if (qty > remaining + QTY_EPSILON) {
    return remaining > QTY_EPSILON
      ? `Only ${qtyText(remaining)} is left to credit on this line.`
      : "Nothing is left to credit on this line.";
  }
  return null;
}

export function creditInvoiceStatusError(status: InvoiceStatus): string | null {
  if (status === "posted" || status === "paid") return null;
  return `A ${invoiceStatusLabel(status).toLowerCase()} invoice can't be credited.`;
}

/** An adjustment never puts goods back. A return may. */
export function restockError(kind: CreditKind, restock: boolean): string | null {
  if (kind === "adjustment" && restock) {
    return "An adjustment does not put goods back in stock.";
  }
  return null;
}

export function creditReasonError(raw: string): string | null {
  const reason = raw.trim();
  if (reason === "") return "Enter a reason.";
  if (reason.length > CREDIT_REASON_MAX) {
    return `Reason must be ${CREDIT_REASON_MAX} characters or fewer.`;
  }
  return null;
}

export function postCreditError(status: CreditStatus): string | null {
  if (status === "draft") return null;
  return `A ${creditStatusLabel(status).toLowerCase()} credit note can't be posted.`;
}

export function voidCreditError(status: CreditStatus): string | null {
  if (status === "draft") return null;
  return `A ${creditStatusLabel(status).toLowerCase()} credit note can't be voided.`;
}

function qtyText(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}
