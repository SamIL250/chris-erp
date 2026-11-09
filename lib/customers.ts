/**
 * Customer master rules (PH2-01). Shared by the sales screens and
 * `sales/customers` so a rejected code, term, or credit limit reads
 * the same in both places.
 *
 * A customer is a company. Contacts and addresses are separate rows.
 * Notes are a timeline: each one is appended, never rewritten.
 * Account status is stored here; sales orders will refuse a hold or
 * a closed account when those documents exist (PH2-12).
 */

import { MAX_PRICE } from "./pricing";

export const CUSTOMER_STATUSES = ["active", "onHold", "closed"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_CODE_MAX = 16;
export const CUSTOMER_NAME_MAX = 120;
export const PAYMENT_TERMS_MAX_DAYS = 365;
export const CONTACT_NAME_MAX = 80;
export const CONTACT_EMAIL_MAX = 200;
export const CONTACT_PHONE_MAX = 40;
export const CONTACT_TITLE_MAX = 80;
export const ADDRESS_LINE_MAX = 120;
export const ADDRESS_CITY_MAX = 80;
export const ADDRESS_REGION_MAX = 80;
export const ADDRESS_POSTAL_MAX = 20;
export const ADDRESS_COUNTRY_MAX = 60;
export const NOTE_MAX = 2000;
export const CUSTOMER_GROUP_NAME_MAX = 80;

/** The tiers a new company starts with (PH2-02). More groups can be added. */
export const STARTER_CUSTOMER_GROUPS = ["Retail", "Wholesale", "Institutional"] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isCustomerStatus(value: string): value is CustomerStatus {
  return (CUSTOMER_STATUSES as readonly string[]).includes(value);
}

export function paymentTermsLabel(days: number): string {
  return days === 0 ? "Due on receipt" : `Net ${days}`;
}

export function customerGroupNameKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeCustomerGroupName(raw: string): string {
  return raw.trim();
}

export function customerGroupNameError(raw: string): string | null {
  const name = normalizeCustomerGroupName(raw);
  if (name.length < 1) return "Customer group name is required.";
  if (name.length > CUSTOMER_GROUP_NAME_MAX) {
    return `Customer group name must be ${CUSTOMER_GROUP_NAME_MAX} characters or fewer.`;
  }
  return null;
}

export function customerStatusLabel(status: CustomerStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "onHold":
      return "On hold";
    case "closed":
      return "Closed";
    default: {
      const never: never = status;
      return never;
    }
  }
}

export function normalizeCustomerCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function customerCodeError(raw: string): string | null {
  const code = normalizeCustomerCode(raw);
  if (code.length < 1) return "Customer code is required.";
  if (code.length > CUSTOMER_CODE_MAX) {
    return `Customer code must be ${CUSTOMER_CODE_MAX} characters or fewer.`;
  }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return "Customer code can only use letters, numbers, and dashes.";
  }
  return null;
}

export function normalizeCustomerName(raw: string): string {
  return raw.trim();
}

export function customerNameError(raw: string): string | null {
  const name = normalizeCustomerName(raw);
  if (name.length < 1) return "Customer name is required.";
  if (name.length > CUSTOMER_NAME_MAX) {
    return `Customer name must be ${CUSTOMER_NAME_MAX} characters or fewer.`;
  }
  return null;
}

/** Whole days until payment is due. Zero means due on receipt. */
export function paymentTermsError(days: number): string | null {
  if (!Number.isInteger(days)) return "Payment terms must be a whole number of days.";
  if (days < 0) return "Payment terms can't be negative.";
  if (days > PAYMENT_TERMS_MAX_DAYS) {
    return `Payment terms can't be more than ${PAYMENT_TERMS_MAX_DAYS} days.`;
  }
  return null;
}

/**
 * `null` means no credit limit is set. Zero is a real limit: nothing
 * may be sold on account.
 */
export function creditLimitError(limit: number | null): string | null {
  if (limit === null) return null;
  if (!Number.isFinite(limit)) return "Credit limit must be a number.";
  if (limit < 0) return "Credit limit can't be negative.";
  if (limit > MAX_PRICE) return "Credit limit is too large.";
  return null;
}

export function contactNameError(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1) return "Contact name is required.";
  if (name.length > CONTACT_NAME_MAX) {
    return `Contact name must be ${CONTACT_NAME_MAX} characters or fewer.`;
  }
  return null;
}

/** Blank is absent. A present email must look like an address. */
export function contactEmailError(raw: string | undefined): string | null {
  const email = (raw ?? "").trim();
  if (email.length === 0) return null;
  if (email.length > CONTACT_EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

export function contactPhoneError(raw: string | undefined): string | null {
  const phone = (raw ?? "").trim();
  if (phone.length > CONTACT_PHONE_MAX) {
    return `Phone must be ${CONTACT_PHONE_MAX} characters or fewer.`;
  }
  return null;
}

export function contactTitleError(raw: string | undefined): string | null {
  const title = (raw ?? "").trim();
  if (title.length > CONTACT_TITLE_MAX) {
    return `Job title must be ${CONTACT_TITLE_MAX} characters or fewer.`;
  }
  return null;
}

export function addressFieldError(
  label: string,
  raw: string | undefined,
  max: number,
  required: boolean,
): string | null {
  const value = (raw ?? "").trim();
  if (value.length === 0) return required ? `${label} is required.` : null;
  if (value.length > max) return `${label} must be ${max} characters or fewer.`;
  return null;
}

export function noteError(raw: string): string | null {
  const body = raw.trim();
  if (body.length < 1) return "Write a note.";
  if (body.length > NOTE_MAX) return `A note must be ${NOTE_MAX} characters or fewer.`;
  return null;
}
