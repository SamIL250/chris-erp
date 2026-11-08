/**
 * Serial lifecycle (PH1-14): the state machine and the warranty lookup.
 * Pure and dependency-free so Phase 5 mutations and the public "check
 * warranty" page share one answer. No writer lives here — receipt, pick,
 * and return mutations arrive with PH5-01…03 and must call
 * `serialTransitionError` before they patch `serials.status`.
 *
 * States match the table union. The happy path named in PH5-03 is
 * available → reserved → shipped → returned → service, with disabled as
 * the terminal write-off. Releases and restocks are the edges back:
 *
 *   available → reserved | disabled
 *   reserved  → available | shipped
 *   shipped   → returned
 *   returned  → available | service | disabled
 *   service   → available | shipped | disabled
 *   disabled  → (none)
 *
 * `service → shipped` is a repaired unit sent back to the customer.
 * `service → available` is a repaired unit returned to stock. A no-op
 * (same state) is not an error — callers use that to skip an audit.
 */

export const SERIAL_STATUSES = [
  "available",
  "reserved",
  "shipped",
  "returned",
  "service",
  "disabled",
] as const;

export type SerialStatus = (typeof SERIAL_STATUSES)[number];

/** Legal next states. A missing key cannot compile — the union is closed. */
export const SERIAL_TRANSITIONS: Record<SerialStatus, readonly SerialStatus[]> = {
  available: ["reserved", "disabled"],
  reserved: ["available", "shipped"],
  shipped: ["returned"],
  returned: ["available", "service", "disabled"],
  service: ["available", "shipped", "disabled"],
  disabled: [],
};

/** Scanned serials stay case-sensitive; only surrounding space is dropped. */
export const MAX_SERIAL_NUMBER = 64;

export function normalizeSerialNumber(raw: string): string {
  return raw.trim();
}

/** Null when the number can be stored. */
export function serialNumberError(raw: string): string | null {
  const number = normalizeSerialNumber(raw);
  if (number.length === 0) return "Serial number can't be empty.";
  if (number.length > MAX_SERIAL_NUMBER) {
    return `Serial number must be ${MAX_SERIAL_NUMBER} characters or fewer.`;
  }
  return null;
}

/**
 * Null when `to` is a legal next state, or the same state. The message
 * names both sides so a rejected pick/receipt can show it verbatim.
 */
export function serialTransitionError(from: SerialStatus, to: SerialStatus): string | null {
  if (from === to) return null;
  if (SERIAL_TRANSITIONS[from].includes(to)) return null;
  return `A serial can't move from ${from} to ${to}.`;
}

export type WarrantyLookup = "none" | "valid" | "expired";

/**
 * Warranty answer for one serial at `now` (epoch ms). `none` when the unit
 * was never registered (no start, or a term that isn't a positive count).
 * The end is the start plus `warrantyMonths` in UTC calendar months — a
 * 24-month term sold on 31 Jan ends on 31 Jan two years later, not
 * 24 × 30 days. `remainingMonths` is whole months still to run, 0 once
 * expired.
 */
export function warrantyLookup(args: {
  warrantyStart?: number;
  warrantyMonths?: number;
  now: number;
}): { status: WarrantyLookup; endsAt: number | null; remainingMonths: number | null } {
  const { warrantyStart, warrantyMonths, now } = args;
  if (
    warrantyStart === undefined ||
    warrantyMonths === undefined ||
    !Number.isFinite(warrantyStart) ||
    !Number.isFinite(warrantyMonths) ||
    warrantyMonths <= 0
  ) {
    return { status: "none", endsAt: null, remainingMonths: null };
  }
  const endsAt = addUtcMonths(warrantyStart, warrantyMonths);
  if (now >= endsAt) return { status: "expired", endsAt, remainingMonths: 0 };
  return { status: "valid", endsAt, remainingMonths: wholeUtcMonthsUntil(now, endsAt) };
}

function addUtcMonths(epoch: number, months: number): number {
  const date = new Date(epoch);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

/** Largest whole UTC-month count that still lands on or before `endsAt`. */
function wholeUtcMonthsUntil(now: number, endsAt: number): number {
  const from = new Date(now);
  const to = new Date(endsAt);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (addUtcMonths(now, months) > endsAt) months -= 1;
  return Math.max(0, months);
}
