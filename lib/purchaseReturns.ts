/**
 * Purchase returns to a vendor (PH2-24). A return names receipt lines
 * whose quantity already entered stock. That quantity leaves as a stock
 * issue. The document number (`DBN-`) is the debit note reference.
 * Rejected quantity never entered, so it cannot be returned. Posting
 * writes one pending debit-note journal intent.
 */

export const PURCHASE_RETURN_REFERENCE_TYPE = "purchaseReturn";

export const RETURN_REASON_MAX = 200;

export const RETURN_LINE_CAP = 100;

const QTY_EPSILON = 1e-9;

function qtyText(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

/** Quantity still on the receipt line, after earlier returns. */
export function purchaseReturnQtyError(input: {
  received: number;
  alreadyReturned: number;
  qty: number;
}): string | null {
  if (!Number.isFinite(input.qty) || input.qty < 0) {
    return "Return quantity can't be negative.";
  }
  if (input.qty === 0) return "Enter a quantity to return.";
  const open = input.received - input.alreadyReturned;
  if (open <= QTY_EPSILON) return "Nothing on this receipt line is left to return.";
  if (input.qty > open + QTY_EPSILON) {
    return "That quantity is more than this receipt line still holds.";
  }
  return null;
}

export function purchaseReturnReasonError(reason: string | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length === 0) return "Add a reason for the return.";
  if (trimmed.length > RETURN_REASON_MAX) {
    return `The reason must be ${RETURN_REASON_MAX} characters or fewer.`;
  }
  return null;
}

export function normalizeReturnReason(reason: string): string {
  return reason.trim();
}

/**
 * A return cannot take free stock below zero. Reserved quantity stays.
 * `qty` is the positive amount leaving.
 */
export function returnStockError(input: {
  qty: number;
  available: number;
  reserved: number;
}): string | null {
  if (input.qty <= input.available + QTY_EPSILON) return null;
  if (input.available <= QTY_EPSILON) {
    return input.reserved > QTY_EPSILON
      ? "Nothing is free to return. The stock on hand is reserved."
      : "Nothing on hand to return.";
  }
  return input.reserved > QTY_EPSILON
    ? `Only ${qtyText(input.available)} can be returned. The rest is reserved.`
    : `Only ${qtyText(input.available)} on hand to return.`;
}

/** Sum of quantity × receipt unit cost, to the cent. Null when no line has a cost. */
export function debitNoteAmount(
  lines: readonly { qty: number; unitCost?: number | null }[],
): number | null {
  if (lines.length === 0 || lines.every((line) => line.unitCost == null)) return null;
  const total = lines.reduce((sum, line) => sum + line.qty * (line.unitCost ?? 0), 0);
  return Math.round(total * 100) / 100;
}
