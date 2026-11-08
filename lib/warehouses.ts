/**
 * Warehouse field rules (PH1-16). Shared by the admin form and
 * `inventory/warehouses` so a rejected code reads the same in both places.
 *
 * Codes are an identity (like a SKU): trim, uppercase, letters, digits, and
 * dashes. Names keep the typed case. A blank address stores as absent.
 */

export const WAREHOUSE_CODE_MAX = 16;
export const WAREHOUSE_NAME_MAX = 100;
export const WAREHOUSE_ADDRESS_MAX = 500;

export function normalizeWarehouseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** `null` when the code is usable. */
export function warehouseCodeError(raw: string): string | null {
  const code = normalizeWarehouseCode(raw);
  if (code.length < 1) return "Warehouse code is required.";
  if (code.length > WAREHOUSE_CODE_MAX) {
    return `Warehouse code must be ${WAREHOUSE_CODE_MAX} characters or fewer.`;
  }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return "Warehouse code can only use letters, numbers, and dashes.";
  }
  return null;
}

export function normalizeWarehouseName(raw: string): string {
  return raw.trim();
}

/** `null` when the name is usable. */
export function warehouseNameError(raw: string): string | null {
  const name = normalizeWarehouseName(raw);
  if (name.length < 1) return "Warehouse name is required.";
  if (name.length > WAREHOUSE_NAME_MAX) {
    return `Warehouse name must be ${WAREHOUSE_NAME_MAX} characters or fewer.`;
  }
  return null;
}

/**
 * Blank (or whitespace-only) addresses are absent. A too-long address is
 * an error; otherwise the trimmed text.
 */
export function normalizeWarehouseAddress(
  raw: string | undefined,
): { address?: string } | { error: string } {
  const address = (raw ?? "").trim();
  if (address.length === 0) return {};
  if (address.length > WAREHOUSE_ADDRESS_MAX) {
    return { error: `Address must be ${WAREHOUSE_ADDRESS_MAX} characters or fewer.` };
  }
  return { address };
}
