/**
 * Receiving against a purchase order (PH2-22). Accepted quantity
 * fulfills the order and is what enters stock. Rejected quantity is
 * recorded and does not. Neither may pass what is still open
 * (ordered minus already accepted). Serials and lots can be named on
 * the line; the picker for them is Phase 5.
 */

export function purchaseReceiptLineError(input: {
  ordered: number;
  alreadyAccepted: number;
  accepted: number;
  rejected: number;
}): string | null {
  if (!Number.isFinite(input.accepted) || input.accepted < 0) {
    return "Accepted quantity can't be negative.";
  }
  if (!Number.isFinite(input.rejected) || input.rejected < 0) {
    return "Rejected quantity can't be negative.";
  }
  if (input.accepted === 0 && input.rejected === 0) {
    return "Enter an accepted or a rejected quantity.";
  }
  const open = input.ordered - input.alreadyAccepted;
  if (input.accepted > open) {
    return "Accepted quantity can't exceed what's still on the order.";
  }
  if (input.accepted + input.rejected > open) {
    return "Accepted and rejected quantity can't exceed what's still on the order.";
  }
  return null;
}
