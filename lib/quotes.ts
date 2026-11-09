import { lineAmount, priceDay, roundUnitPrice } from "./pricing";

/**
 * Quote rules (PH2-11).
 *
 * A quote is a draft until it is sent. Sent can be accepted, rejected,
 * or expired. Accepted is what converts to a sales order, and the order
 * keeps the prices already on the quote. Rejected and expired stop.
 *
 * Tax is snapshotted from the customer's tax group and the product's
 * category. An exempt product, or a group with no rate for that
 * category, charges no tax. Inclusive rates treat the line amount as
 * the gross; exclusive rates add the tax on top. Basis points keep the
 * rate exact (20% is 2000).
 */

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_NOTE_MAX = 2_000;

export const TAX_CATEGORIES = ["standard", "reduced", "zero", "exempt"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export function quoteStatusLabel(status: QuoteStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Blank clears the note. A stored note is the trimmed text. */
export function quoteNoteError(raw: string): string | null {
  const note = raw.trim();
  if (note.length > QUOTE_NOTE_MAX) {
    return `Notes must be ${QUOTE_NOTE_MAX} characters or fewer.`;
  }
  return null;
}

/**
 * Draft can be sent, rejected, or expired. Sent can be accepted,
 * rejected, or expired. Accepted, rejected, and expired stay there.
 */
export function quoteStatusError(from: QuoteStatus, to: QuoteStatus): string | null {
  const allowed: Record<QuoteStatus, readonly QuoteStatus[]> = {
    draft: ["sent", "rejected", "expired"],
    sent: ["accepted", "rejected", "expired"],
    accepted: [],
    rejected: [],
    expired: [],
  };
  if (from === to || !allowed[from].includes(to)) {
    return `A ${quoteStatusLabel(from).toLowerCase()} quote can't be marked ${quoteStatusLabel(to).toLowerCase()}.`;
  }
  return null;
}

/** Both ends are UTC midnights. The quote may expire on its own date. */
export function validityError(quoteDate: number, validUntil: number): string | null {
  if (priceDay(quoteDate) !== quoteDate) return "Enter the quote date as YYYY-MM-DD.";
  if (priceDay(validUntil) !== validUntil) return "Enter the valid-until date as YYYY-MM-DD.";
  if (validUntil < quoteDate) return "The quote expires before its date.";
  return null;
}

/** A quote whose last valid day is before today. Today is still valid. */
export function quoteLapsed(validUntil: number, now: number): boolean {
  const today = priceDay(now);
  if (today === null) return false;
  return validUntil < today;
}

export type LineTax = {
  /** The extended price the customer is charged before tax is interpreted. */
  lineAmount: number;
  net: number;
  tax: number;
  gross: number;
};

/**
 * Tax on one line. `rateBps` of 0 charges nothing. Inclusive pulls the
 * tax out of the line amount. Exclusive adds it. Each figure rounds to
 * the currency's decimal places.
 */
export function taxOnLine(input: {
  unitPrice: number;
  qty: number;
  decimalPlaces: number;
  rateBps: number;
  inclusive: boolean;
}): LineTax {
  const extended = lineAmount(input.unitPrice, input.qty, input.decimalPlaces);
  if (!(input.rateBps > 0)) {
    return { lineAmount: extended, net: extended, tax: 0, gross: extended };
  }
  if (input.inclusive) {
    const tax = roundUnitPrice(
      (extended * input.rateBps) / (10_000 + input.rateBps),
      input.decimalPlaces,
    );
    const net = roundUnitPrice(extended - tax, input.decimalPlaces);
    return { lineAmount: extended, net, tax, gross: extended };
  }
  const tax = roundUnitPrice((extended * input.rateBps) / 10_000, input.decimalPlaces);
  const gross = roundUnitPrice(extended + tax, input.decimalPlaces);
  return { lineAmount: extended, net: extended, tax, gross };
}

export function quoteTotals(
  lines: { net: number; tax: number; gross: number }[],
  decimalPlaces: number,
): { net: number; tax: number; gross: number } {
  let net = 0;
  let tax = 0;
  let gross = 0;
  for (const line of lines) {
    net += line.net;
    tax += line.tax;
    gross += line.gross;
  }
  return {
    net: roundUnitPrice(net, decimalPlaces),
    tax: roundUnitPrice(tax, decimalPlaces),
    gross: roundUnitPrice(gross, decimalPlaces),
  };
}
