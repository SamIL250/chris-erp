/**
 * Vendor master rules (PH2-03). Shared by the procurement screens and
 * `procurement/vendors` so a rejected code, term, or license date reads
 * the same in both places.
 *
 * A vendor is a company we buy from. Contacts and addresses are
 * separate rows. License number, jurisdiction, and expiry are stored.
 * An expired license is still a valid record — Phase 5 is what blocks
 * a shipment or a receipt when the license has lapsed.
 */

export const VENDOR_CODE_MAX = 16;
export const VENDOR_NAME_MAX = 120;
export const TAX_NUMBER_MAX = 40;
export const LICENSE_NUMBER_MAX = 40;
export const LICENSE_JURISDICTION_MAX = 80;
const DAY_MS = 86_400_000;

export function normalizeVendorCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function vendorCodeError(raw: string): string | null {
  const code = normalizeVendorCode(raw);
  if (code.length < 1) return "Vendor code is required.";
  if (code.length > VENDOR_CODE_MAX) {
    return `Vendor code must be ${VENDOR_CODE_MAX} characters or fewer.`;
  }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return "Vendor code can only use letters, numbers, and dashes.";
  }
  return null;
}

export function normalizeVendorName(raw: string): string {
  return raw.trim();
}

export function vendorNameError(raw: string): string | null {
  const name = normalizeVendorName(raw);
  if (name.length < 1) return "Vendor name is required.";
  if (name.length > VENDOR_NAME_MAX) {
    return `Vendor name must be ${VENDOR_NAME_MAX} characters or fewer.`;
  }
  return null;
}

/** Blank is absent. A present tax number is the registration we store. */
export function taxNumberError(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length > TAX_NUMBER_MAX) {
    return `Tax number must be ${TAX_NUMBER_MAX} characters or fewer.`;
  }
  return null;
}

export function licenseNumberError(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length > LICENSE_NUMBER_MAX) {
    return `License number must be ${LICENSE_NUMBER_MAX} characters or fewer.`;
  }
  return null;
}

export function licenseJurisdictionError(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length > LICENSE_JURISDICTION_MAX) {
    return `Jurisdiction must be ${LICENSE_JURISDICTION_MAX} characters or fewer.`;
  }
  return null;
}

/**
 * `null` means no expiry is recorded. A past date is allowed: Phase 5
 * decides what an expired license blocks. The value is UTC midnight
 * of a real calendar day.
 */
export function licenseExpiryError(expiresOn: number | null): string | null {
  if (expiresOn === null) return null;
  if (!Number.isInteger(expiresOn) || expiresOn % DAY_MS !== 0) {
    return "Enter the license expiry as YYYY-MM-DD.";
  }
  const iso = new Date(expiresOn).toISOString().slice(0, 10);
  if (Date.parse(`${iso}T00:00:00.000Z`) !== expiresOn) {
    return "Enter the license expiry as YYYY-MM-DD.";
  }
  return null;
}

/** Blank clears the date. Anything else must be a real YYYY-MM-DD. */
export function licenseExpiryFromInput(raw: string): { error: string } | { ms: number | null } {
  const value = raw.trim();
  if (value.length === 0) return { ms: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: "Enter the license expiry as YYYY-MM-DD." };
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (licenseExpiryError(ms) !== null || new Date(ms).toISOString().slice(0, 10) !== value) {
    return { error: "Enter the license expiry as YYYY-MM-DD." };
  }
  return { ms };
}

export function licenseExpiryInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
