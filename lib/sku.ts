/**
 * SKU format rules (PH1-06) — pure and shared, like `slugify`: the product
 * editor (PH1-07) validates live with it, the Convex product mutations
 * enforce it server-side with the same function, so what you see is what
 * gets stored. This module is the FORMAT half of the rules; the other half
 * is UNIQUENESS — org-wide via `by_sku` `.unique()` at write time, in the
 * mutation (same split as category slugs: explicit beats surprising, no
 * auto-derivation ever rewrites a SKU you typed).
 *
 * Normalization is deliberately minimal — trim + uppercase only. Anything
 * else (spaces, punctuation outside the charset) is an ERROR with a precise
 * message, never a silent rewrite: an identifier must not change meaning
 * between screens.
 */

export const SKU_MIN_LENGTH = 3;
export const SKU_MAX_LENGTH = 32;

/** Letters/digits plus the four separators allowed between them. */
const SKU_CHARSET = /^[A-Z0-9._/-]+$/;
const SKU_EDGE_ALNUM = /^[A-Z0-9]/;
const SKU_EDGE_ALNUM_END = /[A-Z0-9]$/;

/** The only transforms applied to a typed SKU. */
export function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * `null` when valid, otherwise the exact user-facing message (each rule
 * returns its own — callers show it verbatim, like the category editor
 * does with slug errors).
 */
export function skuFormatError(sku: string): string | null {
  if (sku.length < SKU_MIN_LENGTH) {
    return `SKU must be at least ${SKU_MIN_LENGTH} characters.`;
  }
  if (sku.length > SKU_MAX_LENGTH) {
    return `SKU must be at most ${SKU_MAX_LENGTH} characters.`;
  }
  if (/\s/.test(sku)) {
    return "SKU can't contain spaces.";
  }
  if (!SKU_CHARSET.test(sku)) {
    return "SKU may only contain letters, numbers, and - . / _";
  }
  if (!SKU_EDGE_ALNUM.test(sku) || !SKU_EDGE_ALNUM_END.test(sku)) {
    return "SKU must start and end with a letter or number.";
  }
  return null;
}

/** Normalize + validate in one step — the mutation's entry point. */
export function validateSku(
  raw: string,
): { sku: string; error: null } | { sku: string; error: string } {
  const sku = normalizeSku(raw);
  return { sku, error: skuFormatError(sku) };
}
