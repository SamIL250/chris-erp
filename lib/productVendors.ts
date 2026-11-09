/**
 * Product↔vendor link rules (PH2-04). The supplier's own code is
 * optional. Last purchase price is not typed here — a goods receipt
 * writes it.
 */

export const VENDOR_SKU_MAX = 40;

const VENDOR_SKU_CHARSET = /^[A-Za-z0-9 ./_-]+$/;

/** Trim. Blank is no SKU. */
export function normalizeVendorSku(raw: string | null | undefined): string | undefined {
  const value = (raw ?? "").trim();
  return value.length === 0 ? undefined : value;
}

/**
 * `null` when the SKU is empty or valid. The stored value keeps the
 * casing the supplier uses.
 */
export function vendorSkuError(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value.length === 0) return null;
  if (value.length > VENDOR_SKU_MAX) {
    return `Vendor SKU must be ${VENDOR_SKU_MAX} characters or fewer.`;
  }
  if (!VENDOR_SKU_CHARSET.test(value)) {
    return "Vendor SKU can only use letters, numbers, spaces, and - . / _";
  }
  if (!/^[A-Za-z0-9]/.test(value) || !/[A-Za-z0-9]$/.test(value)) {
    return "Vendor SKU must start and end with a letter or number.";
  }
  return null;
}
