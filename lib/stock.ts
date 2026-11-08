import { MAX_PRICE } from "./pricing";

/**
 * Stock ledger rules (PH1-17). Pure — the mutation and the later on-hand
 * query (PH1-18) both call these so a receipt can never be stored as a
 * negative and then summed as if it were one.
 *
 * Sign contract (`qty`):
 * - receipt, transferIn, reservation: greater than zero
 * - issue, transferOut, release: less than zero
 * - adjustment: either sign, never zero
 *
 * On-hand is the sum of the physical types. Reserved is the sum of
 * reservation + release (a release is negative, so it shrinks the hold).
 * `available = onHand − reserved`.
 */

export const STOCK_MOVEMENT_TYPES = [
  "receipt",
  "issue",
  "transferIn",
  "transferOut",
  "adjustment",
  "reservation",
  "release",
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

const PHYSICAL: ReadonlySet<StockMovementType> = new Set([
  "receipt",
  "issue",
  "transferIn",
  "transferOut",
  "adjustment",
]);

const TYPE_LABEL: Record<StockMovementType, string> = {
  receipt: "A receipt",
  issue: "An issue",
  transferIn: "A transfer in",
  transferOut: "A transfer out",
  adjustment: "An adjustment",
  reservation: "A reservation",
  release: "A release",
};

export function isStockMovementType(value: string): value is StockMovementType {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

/** How much this line changes physical on-hand. Holds contribute 0. */
export function onHandDelta(type: StockMovementType, qty: number): number {
  return PHYSICAL.has(type) ? qty : 0;
}

/** How much this line changes the reserved hold. Physical lines contribute 0. */
export function reservedDelta(type: StockMovementType, qty: number): number {
  return type === "reservation" || type === "release" ? qty : 0;
}

/**
 * Totals for one product at one warehouse (PH1-18). Order does not
 * matter. `available` is not stored — it is on-hand minus the hold.
 */
export function stockBalance(lines: readonly { type: StockMovementType; qty: number }[]): {
  onHand: number;
  reserved: number;
  available: number;
} {
  let onHand = 0;
  let reserved = 0;
  for (const line of lines) {
    onHand += onHandDelta(line.type, line.qty);
    reserved += reservedDelta(line.type, line.qty);
  }
  return { onHand, reserved, available: onHand - reserved };
}

/**
 * Placeholder unit cost: the latest physical line that recorded one.
 * Walk the lines in ledger order. Holds are skipped. This is not the
 * moving-average cost (PH3-06).
 */
export function latestUnitCost(
  lines: readonly { type: StockMovementType; unitCost?: number }[],
): number | undefined {
  let cost: number | undefined;
  for (const line of lines) {
    if (!PHYSICAL.has(line.type) || line.unitCost === undefined) continue;
    cost = line.unitCost;
  }
  return cost;
}

/** Placeholder value: on-hand × {@link latestUnitCost}, to the cent. */
export function placeholderValue(onHand: number, unitCost: number | undefined): number | undefined {
  if (unitCost === undefined || !Number.isFinite(onHand)) return undefined;
  return Math.round(onHand * unitCost * 100) / 100;
}

export const ADJUSTMENT_REASONS = ["damage", "countCorrection", "writeOff", "found"] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** How long a warehouse note on a manual adjustment may be. */
export const ADJUSTMENT_NOTE_MAX = 500;

export function isAdjustmentReason(value: string): value is AdjustmentReason {
  return (ADJUSTMENT_REASONS as readonly string[]).includes(value);
}

/**
 * Reason decides the sign (PH1-20). Damage and write-off leave the
 * shelf, so the quantity is negative. Found stock arrives, so it is
 * positive. A count correction may go either way, and never zero.
 */
export function adjustmentReasonError(reason: string | undefined, qty: number): string | null {
  if (!Number.isFinite(qty) || qty === 0) return "An adjustment quantity can't be zero.";
  if (reason === undefined || !isAdjustmentReason(reason)) {
    return "Choose a reason: damage, count correction, write-off, or found.";
  }
  switch (reason) {
    case "damage":
    case "writeOff":
      return qty < 0
        ? null
        : "Damage and write-off quantities are removed, so they have to be negative.";
    case "found":
      return qty > 0 ? null : "A found quantity is stock that turned up, so it has to be positive.";
    case "countCorrection":
      return null;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/** Blank is absent. A present note is trimmed and capped. */
export function adjustmentNoteError(note: string | undefined): string | null {
  if (note === undefined) return null;
  if (note.trim().length > ADJUSTMENT_NOTE_MAX) {
    return `The note must be ${ADJUSTMENT_NOTE_MAX} characters or fewer.`;
  }
  return null;
}

export function normalizeAdjustmentNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

export function movementQtyError(type: StockMovementType, qty: number): string | null {
  if (!Number.isFinite(qty)) return "Quantity must be a finite number.";
  const label = TYPE_LABEL[type];
  switch (type) {
    case "receipt":
    case "transferIn":
    case "reservation":
      return qty > 0 ? null : `${label} quantity must be greater than zero.`;
    case "issue":
    case "transferOut":
    case "release":
      return qty < 0 ? null : `${label} quantity must be less than zero.`;
    case "adjustment":
      return qty !== 0 ? null : "An adjustment quantity can't be zero.";
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

/** Absent is fine. A present cost is a non-negative amount, same cap as a price. */
export function unitCostError(unitCost: number | undefined): string | null {
  if (unitCost === undefined) return null;
  if (!Number.isFinite(unitCost)) return "Unit cost must be a finite number.";
  if (unitCost < 0) return "Unit cost can't be negative.";
  if (unitCost > MAX_PRICE) return `Unit cost must be ${MAX_PRICE} or less.`;
  return null;
}

const REFERENCE_TYPE_MAX = 40;
const REFERENCE_ID_MAX = 128;

/**
 * Both absent, or both present. Blank is absent. The type is a document
 * name (`salesOrder`, `goodsReceipt`) — letters and digits, so a later
 * table can adopt it without a schema change.
 */
export function referenceError(
  referenceType: string | undefined,
  referenceId: string | undefined,
): string | null {
  const type = referenceType?.trim() ?? "";
  const id = referenceId?.trim() ?? "";
  if (type === "" && id === "") return null;
  if (type === "" || id === "") return "A reference needs both a document type and an id.";
  if (type.length > REFERENCE_TYPE_MAX) {
    return `Reference type must be ${REFERENCE_TYPE_MAX} characters or fewer.`;
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(type)) {
    return "Reference type must start with a letter and use only letters and numbers.";
  }
  if (id.length > REFERENCE_ID_MAX) {
    return `Reference id must be ${REFERENCE_ID_MAX} characters or fewer.`;
  }
  return null;
}

export function normalizeReference(
  referenceType: string | undefined,
  referenceId: string | undefined,
): { referenceType?: string; referenceId?: string } {
  const type = referenceType?.trim() ?? "";
  const id = referenceId?.trim() ?? "";
  if (type === "" && id === "") return {};
  return { referenceType: type, referenceId: id };
}
