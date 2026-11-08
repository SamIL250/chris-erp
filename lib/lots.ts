/**
 * Lot / batch master rules (PH1-14). Pure helpers the Phase 5 receipt and
 * allocation mutations will call. Disposition values match the `lots.status`
 * union. Quantity and warehouse live on the stock ledger (PH1-17), not here.
 *
 * Transitions (PH5-09 inspection, PH5-11 recall):
 *
 *   released    → quarantined | recalled | expired
 *   quarantined → released | recalled | expired
 *   recalled    → (none — a recall sticks; recovery is per customer)
 *   expired     → (none)
 *
 * A `released` lot whose expiry date has passed is treated as `expired` by
 * `effectiveLotStatus` without a write. Quarantine and recall outrank the
 * date: a recalled lot that has also expired stays `recalled`, because the
 * recall pack (PH5-10) must still find it.
 */

export const LOT_STATUSES = ["released", "quarantined", "recalled", "expired"] as const;

export type LotStatus = (typeof LOT_STATUSES)[number];

export const LOT_TRANSITIONS: Record<LotStatus, readonly LotStatus[]> = {
  released: ["quarantined", "recalled", "expired"],
  quarantined: ["released", "recalled", "expired"],
  recalled: [],
  expired: [],
};

/** Supplier batch codes stay case-sensitive; only surrounding space is dropped. */
export const MAX_LOT_NUMBER = 64;
export const MAX_LOT_SUPPLIER = 200;

export function normalizeLotNumber(raw: string): string {
  return raw.trim();
}

export function lotNumberError(raw: string): string | null {
  const number = normalizeLotNumber(raw);
  if (number.length === 0) return "Lot number can't be empty.";
  if (number.length > MAX_LOT_NUMBER) {
    return `Lot number must be ${MAX_LOT_NUMBER} characters or fewer.`;
  }
  return null;
}

/** Null when the supplier label can be stored. Absent is allowed. */
export function lotSupplierError(supplier: string | undefined): string | null {
  if (supplier === undefined) return null;
  const trimmed = supplier.trim();
  if (trimmed.length === 0) return "Supplier can't be blank — leave it empty instead.";
  if (trimmed.length > MAX_LOT_SUPPLIER) {
    return `Supplier must be ${MAX_LOT_SUPPLIER} characters or fewer.`;
  }
  return null;
}

export function normalizeLotSupplier(supplier: string | undefined): string | undefined {
  if (supplier === undefined) return undefined;
  const trimmed = supplier.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Date order on a lot master. First violation wins.
 * An already-expired receipt is legal — the date check only rejects
 * impossible order (manufactured after receipt, or expiry before
 * manufacture). `expiryRequired` comes from the product's track flag.
 */
export function lotDateError(args: {
  receivedDate: number;
  mfgDate?: number;
  expiryDate?: number;
  expiryRequired: boolean;
}): string | null {
  if (!Number.isFinite(args.receivedDate)) return "Received date must be a real date.";
  if (args.mfgDate !== undefined && !Number.isFinite(args.mfgDate)) {
    return "Manufacturing date must be a real date.";
  }
  if (args.expiryDate !== undefined && !Number.isFinite(args.expiryDate)) {
    return "Expiry date must be a real date.";
  }
  if (args.expiryRequired && args.expiryDate === undefined) {
    return "Expiry date is required when the product requires expiry.";
  }
  if (args.mfgDate !== undefined && args.mfgDate > args.receivedDate) {
    return "Manufacturing date can't be after the received date.";
  }
  if (
    args.mfgDate !== undefined &&
    args.expiryDate !== undefined &&
    args.expiryDate < args.mfgDate
  ) {
    return "Expiry date can't be before the manufacturing date.";
  }
  return null;
}

/** Null when `to` is legal, or the same disposition. */
export function lotTransitionError(from: LotStatus, to: LotStatus): string | null {
  if (from === to) return null;
  if (LOT_TRANSITIONS[from].includes(to)) return null;
  return `A lot can't move from ${from} to ${to}.`;
}

/**
 * Disposition a reader should act on. Stored `quarantined` / `recalled`
 * win over the calendar. A `released` or `expired` row whose expiry is at
 * or before `now` reads as `expired`.
 */
export function effectiveLotStatus(
  status: LotStatus,
  expiryDate: number | undefined,
  now: number,
): LotStatus {
  if (status === "quarantined" || status === "recalled") return status;
  if (expiryDate !== undefined && Number.isFinite(expiryDate) && expiryDate <= now)
    return "expired";
  return status;
}

/** True when a delivery may allocate this lot. Only a still-released lot. */
export function lotBlocksSale(
  status: LotStatus,
  expiryDate: number | undefined,
  now: number,
): boolean {
  return effectiveLotStatus(status, expiryDate, now) !== "released";
}
