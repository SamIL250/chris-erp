/**
 * Manual goods receipt (PH1-22). The reference note is required: without
 * a purchase order, the note is the only record of why the stock arrived.
 * A purchase-order link is PH2-22, not this document.
 */

export const RECEIPT_REFERENCE_TYPE = "goodsReceipt";

export const RECEIPT_NOTE_MAX = 500;

export const RECEIPT_LINE_CAP = 100;

export function receiptNoteError(note: string | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length === 0) return "Add a reference note.";
  if (trimmed.length > RECEIPT_NOTE_MAX) {
    return `The reference note must be ${RECEIPT_NOTE_MAX} characters or fewer.`;
  }
  return null;
}

export function normalizeReceiptNote(note: string): string {
  return note.trim();
}
