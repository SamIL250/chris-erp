/**
 * Stock transfer rules (PH1-21). Pure — the mutation calls these before
 * it writes, so a draft cannot store a zero line or a transfer to itself.
 *
 * Status runs draft → inTransit → received. Cancel is draft-only.
 * Shipping takes the whole line off the source. Receiving may be partial;
 * the document stays in transit until every line is fully received.
 */

export const TRANSFER_STATUSES = ["draft", "inTransit", "received", "cancelled"] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_REFERENCE_TYPE = "stockTransfer";

export const TRANSFER_NOTE_MAX = 500;

export const TRANSFER_LINE_CAP = 100;

export function isTransferStatus(value: string): value is TransferStatus {
  return (TRANSFER_STATUSES as readonly string[]).includes(value);
}

export function transferQtyError(qty: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "Quantity must be greater than zero.";
  return null;
}

export function transferPairError(fromWarehouseId: string, toWarehouseId: string): string | null {
  if (fromWarehouseId === toWarehouseId) return "Choose two different warehouses.";
  return null;
}

export function transferNoteError(note: string | undefined): string | null {
  if (note === undefined) return null;
  if (note.trim().length > TRANSFER_NOTE_MAX) {
    return `The note must be ${TRANSFER_NOTE_MAX} characters or fewer.`;
  }
  return null;
}

export function normalizeTransferNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

/** How much of a line has not arrived yet. */
export function outstandingQty(qty: number, receivedQty: number): number {
  return qty - receivedQty;
}

/** Why a draft-only action cannot run, or null when the document is still a draft. */
export function draftBlock(status: TransferStatus): string | null {
  if (status === "draft") return null;
  switch (status) {
    case "inTransit":
      return "This transfer is already in transit.";
    case "received":
      return "This transfer is already received.";
    case "cancelled":
      return "This transfer was cancelled.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Why a receipt cannot be posted, or null when the document is in transit. */
export function receiveBlock(status: TransferStatus): string | null {
  if (status === "inTransit") return null;
  switch (status) {
    case "draft":
      return "Ship the transfer before receiving it.";
    case "received":
      return "This transfer is already received.";
    case "cancelled":
      return "This transfer was cancelled.";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
