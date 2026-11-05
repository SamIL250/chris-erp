/**
 * PH1-12 track-flag rules — cross-field consistency for the seven product
 * tracking fields (`serialTracked`, `lotTracked`, `expiryRequired`,
 * `warrantyEligible`, `warrantyMonths`, `shelfLifeDays`, `allowBackorder`).
 *
 * One source of messages, three consumers: the product editor's zod quiet
 * gate (numeric couplings only — see below), `products.create`/`update`,
 * and `variants.update` (which carries the five boolean flags; the two
 * numeric rules pass through as unset). Rejection happens BEFORE any diff
 * or patch, so a violated combination is never stored and never audited.
 *
 * Rules (first violation wins):
 *  1. serial ⊥ lot — one policy per product (research §4.10: "serial OR
 *     lot policy per product (configurable)")
 *  2. expiry ⇒ lot — the batch carries the date; `lots.expiryDate` (PH1-14)
 *     is where it will live, serials don't have a date slot
 *  3. warrantyMonths > 0 ⇒ warrantyEligible — a term on a non-warranty
 *     product is stale data waiting to happen
 *  4. shelfLifeDays > 0 ⇒ expiryRequired — shelf life only feeds expiry
 *     math at receipt (the Odoo coupling: expiration fields appear with
 *     the expiration toggle); free-form display specs belong to attribute
 *     definitions (PH1-04), not here
 *
 * Deliberate NON-rules: eligible WITHOUT months (terms can vary per
 * batch/order — PH1-17's claim flow may require them at claim time),
 * expiry WITHOUT shelf life (supplier-stated dates arrive on the lot),
 * warranty WITHOUT serial (receipt-based coverage is legitimate), and
 * `allowBackorder` (nothing consumes it until sales exist — PH2).
 *
 * `0` counts as unset for both numeric fields (the same "absent" meaning
 * the readers use: `flag === true` / months-present checks).
 */

export const TRACKING_RULES = {
  serialLot: "Serial and lot tracking are mutually exclusive — choose one per product.",
  expiryNeedsLot: "Expiry dates require lot tracking — enable Lot tracked first.",
  warrantyMonthsNeedEligible: "Warranty months can only be set on a warranty-eligible product.",
  shelfLifeNeedsExpiry: "Shelf life days can only be set when expiry is required.",
} as const;

export type TrackingFlags = {
  serialTracked: boolean;
  lotTracked: boolean;
  expiryRequired: boolean;
  warrantyEligible: boolean;
  warrantyMonths?: number | undefined;
  shelfLifeDays?: number | undefined;
};

/** First violated rule's message, or null when the combination is valid. */
export function trackingError(flags: TrackingFlags): string | null {
  if (flags.serialTracked && flags.lotTracked) return TRACKING_RULES.serialLot;
  if (flags.expiryRequired && !flags.lotTracked) return TRACKING_RULES.expiryNeedsLot;
  if ((flags.warrantyMonths ?? 0) > 0 && !flags.warrantyEligible) {
    return TRACKING_RULES.warrantyMonthsNeedEligible;
  }
  if ((flags.shelfLifeDays ?? 0) > 0 && !flags.expiryRequired) {
    return TRACKING_RULES.shelfLifeNeedsExpiry;
  }
  return null;
}
