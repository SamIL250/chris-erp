/** Labels and number formatting for the inventory screens (PH1-23). */

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Receipt",
  issue: "Issue",
  transferIn: "Transfer in",
  transferOut: "Transfer out",
  adjustment: "Adjustment",
  reservation: "Reservation",
  release: "Release",
};

const REASON_LABELS: Record<string, string> = {
  damage: "Damage",
  countCorrection: "Count correction",
  writeOff: "Write-off",
  found: "Found",
};

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  inTransit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

export function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type;
}

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

export function transferStatusLabel(status: string): string {
  return TRANSFER_STATUS_LABELS[status] ?? status;
}

/** Up to 3 decimal places, trailing zeros dropped. */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty)) return "—";
  const rounded = Math.round(qty * 1000) / 1000;
  return String(rounded);
}

/** Placeholder stock value, two decimal places. Absent when there is no cost. */
export function formatValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatWhen(timestamp: number | undefined): string {
  if (timestamp === undefined) return "—";
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
