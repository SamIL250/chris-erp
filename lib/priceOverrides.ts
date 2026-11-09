import { priceError, roundUnitPrice } from "./pricing";

/**
 * A manual price on a document line (PH2-08).
 *
 * The line starts from `resolvePrice`. Staff may replace that unit with
 * a typed price, or take a percent off it. Both need a reason. The
 * discount is how far the new unit sits below the resolved unit, rounded
 * to two decimal places. Above `OVERRIDE_THRESHOLD_PERCENT` the line is
 * flagged `needsApproval` and a second person confirms it. A raise, or a
 * discount at the threshold, does not. Phase 6 replaces this single
 * percent with configurable rules.
 *
 * A pending or rejected override does not change what the line charges.
 * The resolved unit stays until the override is applied or approved.
 * Quotes and the other sales documents store the line itself (PH2-11+);
 * this row is only the price decision.
 */

/** A discount strictly above this percent needs a second person. */
export const OVERRIDE_THRESHOLD_PERCENT = 10;

export const OVERRIDE_REASON_MAX = 200;
export const DOCUMENT_REF_MAX = 128;

export const OVERRIDE_DOCUMENT_KINDS = ["quote", "salesOrder", "invoice", "creditNote"] as const;
export type OverrideDocumentKind = (typeof OVERRIDE_DOCUMENT_KINDS)[number];

export const OVERRIDE_STATUSES = ["applied", "pending", "approved", "rejected"] as const;
export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number];

export function normalizeOverrideReason(raw: string): string {
  return raw.trim();
}

export function overrideReasonError(raw: string): string | null {
  const reason = normalizeOverrideReason(raw);
  if (reason.length < 1) return "A reason is required.";
  if (reason.length > OVERRIDE_REASON_MAX) {
    return `Reason must be ${OVERRIDE_REASON_MAX} characters or fewer.`;
  }
  return null;
}

export function documentRefError(raw: string, label: "Document" | "Line"): string | null {
  const value = raw.trim();
  if (value.length < 1) return `${label} is required.`;
  if (value.length > DOCUMENT_REF_MAX) {
    return `${label} must be ${DOCUMENT_REF_MAX} characters or fewer.`;
  }
  return null;
}

/** A typed discount. Zero is not an override. 100% makes the unit free. */
export function discountPercentError(percent: number): string | null {
  if (!Number.isFinite(percent)) return "Discount must be a finite number.";
  if (percent <= 0) return "Discount must be greater than zero.";
  if (percent > 100) return "Discount can't be more than 100%.";
  return null;
}

export type PriceOverrideInput = {
  resolvedUnitPrice: number | null;
  decimalPlaces: number;
} & ({ mode: "price"; manualPrice: number } | { mode: "discount"; discountPercent: number });

export type PriceOverrideDecision = {
  unitPrice: number;
  /**
   * The achieved discount, after the unit is rounded. `null` when there
   * was no resolved price to measure against. `0` when the override does
   * not lower the price.
   */
  discountPercent: number | null;
  needsApproval: boolean;
};

/**
 * The price decision for one line. An `{ error }` result is refused
 * before anything is stored.
 */
export function priceOverride(
  input: PriceOverrideInput,
): { error: string } | PriceOverrideDecision {
  if (
    !Number.isInteger(input.decimalPlaces) ||
    input.decimalPlaces < 0 ||
    input.decimalPlaces > 6
  ) {
    return { error: "That currency has no decimal places." };
  }

  let resolved: number | null = null;
  if (input.resolvedUnitPrice !== null) {
    const message = priceError(input.resolvedUnitPrice);
    if (message !== null) return { error: message };
    resolved = roundUnitPrice(input.resolvedUnitPrice, input.decimalPlaces);
  }

  let unit: number;
  switch (input.mode) {
    case "price": {
      const message = priceError(input.manualPrice);
      if (message !== null) return { error: message };
      unit = roundUnitPrice(input.manualPrice, input.decimalPlaces);
      break;
    }
    case "discount": {
      const message = discountPercentError(input.discountPercent);
      if (message !== null) return { error: message };
      if (resolved === null) return { error: "There's no price to discount." };
      unit = roundUnitPrice(resolved * (1 - input.discountPercent / 100), input.decimalPlaces);
      break;
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }

  if (resolved === null) {
    return { unitPrice: unit, discountPercent: null, needsApproval: true };
  }
  if (unit === resolved) return { error: "That price matches the resolved price." };

  const achieved = resolved === 0 ? 0 : roundUnitPrice(((resolved - unit) / resolved) * 100, 2);
  const discountPercent = achieved < 0 ? 0 : achieved;
  return {
    unitPrice: unit,
    discountPercent,
    needsApproval: discountPercent > OVERRIDE_THRESHOLD_PERCENT,
  };
}

/**
 * What the line charges right now. Pending and rejected keep the
 * resolved unit (or nothing, when there wasn't one). Applied and
 * approved charge the override.
 */
export function chargedUnitPrice(row: {
  status: OverrideStatus;
  unitPrice: number;
  resolvedUnitPrice: number | null;
}): number | null {
  switch (row.status) {
    case "applied":
    case "approved":
      return row.unitPrice;
    case "pending":
    case "rejected":
      return row.resolvedUnitPrice;
    default: {
      const unreachable: never = row.status;
      return unreachable;
    }
  }
}
