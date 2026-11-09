import { priceDayFromInput, priceError } from "./pricing";

/**
 * Internal requisitions (PH2-20). A request stays a draft until someone
 * with `procurement.approve` approves or rejects it. There is no money
 * threshold — the rules engine is Phase 6. The same person may approve
 * their own request when their role includes approve. Rejected is
 * terminal. Convert runs once, from approved, into a draft purchase order.
 */

export const REQUISITION_STATUSES = ["draft", "approved", "rejected"] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const REQUISITION_NOTE_MAX = 500;
export const REQUISITION_REASON_MAX = 500;
export const REQUISITION_QTY_MAX = 1_000_000;
export const REQUISITION_LINE_MAX = 100;

export function requisitionStatusLabel(status: RequisitionStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function requisitionQtyError(qty: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "Quantity must be greater than zero.";
  if (qty > REQUISITION_QTY_MAX) return `Quantity must be ${REQUISITION_QTY_MAX} or less.`;
  return null;
}

/** A requested buy price. Zero is not a price yet. */
export function requisitionPriceError(price: number): string | null {
  const invalid = priceError(price);
  if (invalid !== null) return invalid;
  if (price <= 0) return "Enter a price greater than zero.";
  return null;
}

export function requisitionNoteError(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const note = raw.trim();
  if (note.length > REQUISITION_NOTE_MAX) {
    return `Note must be ${REQUISITION_NOTE_MAX} characters or fewer.`;
  }
  return null;
}

export function requisitionRejectError(raw: string): string | null {
  const reason = raw.trim();
  if (reason.length < 1) return "A reason is required.";
  if (reason.length > REQUISITION_REASON_MAX) {
    return `Reason must be ${REQUISITION_REASON_MAX} characters or fewer.`;
  }
  return null;
}

/** Need-by is a UTC calendar day, the same shape as an invoice date. */
export function requisitionNeedByError(ms: number): string | null {
  if (!Number.isInteger(ms)) return "Enter the date as YYYY-MM-DD.";
  const iso = new Date(ms).toISOString().slice(0, 10);
  const parsed = priceDayFromInput(iso);
  if ("error" in parsed || parsed.ms !== ms) return "Enter the date as YYYY-MM-DD.";
  return null;
}

export function requisitionApproveError(status: RequisitionStatus): string | null {
  switch (status) {
    case "draft":
      return null;
    case "approved":
      return "This requisition is already approved.";
    case "rejected":
      return "A rejected requisition stays rejected.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function requisitionRejectStatusError(status: RequisitionStatus): string | null {
  switch (status) {
    case "draft":
      return null;
    case "approved":
      return "An approved requisition can't be rejected.";
    case "rejected":
      return "This requisition is already rejected.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function requisitionEditError(status: RequisitionStatus): string | null {
  switch (status) {
    case "draft":
      return null;
    case "approved":
      return "An approved requisition can't be edited.";
    case "rejected":
      return "A rejected requisition can't be edited.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function requisitionConvertError(
  status: RequisitionStatus,
  hasPurchaseOrder: boolean,
): string | null {
  if (hasPurchaseOrder) return "This requisition already has a purchase order.";
  switch (status) {
    case "approved":
      return null;
    case "draft":
      return "Approve the requisition before converting it.";
    case "rejected":
      return "A rejected requisition can't be converted.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
