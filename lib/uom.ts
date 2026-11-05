/**
 * Units of measure + pack-size conversions (PH1-11): pure, dependency-free
 * rules shared by the product editor's build-time gate and the Convex
 * mutations (same pattern as lib/sku / lib/pricing — one source of truth,
 * byte-identical messages on both sides).
 *
 * Model: a product's BASE UoM (`products.unitOfMeasure`, "each" by
 * convention) plus per-product conversion EDGES — `1 unit = factor × parent`
 * — forming chains toward the base ("1 case = 6 box", "1 box = 12 each").
 * Pack sizes are per-product by nature (a box of gloves ≠ a box of
 * monitors), so nothing here is a global catalog. Purchase/sales document
 * lines (PH2) prefill their UoM from `products.purchaseUoM` /
 * `products.salesUoM` and resolve quantities through these edges.
 *
 * Codes are normalized (trim + lowercase) then validated: 1–16 chars,
 * lowercase letters/digits with "." or "-" separators. Unlike SKUs, UoM
 * codes are case-insensitive vocabulary, not user identifiers — silent
 * normalization can't lose meaning.
 */

export const MAX_UOM_CODE = 16;
export const MAX_CONVERSIONS = 12;
/** Typo guard on a single factor, not a policy. */
export const MAX_CONVERSION_FACTOR = 1_000_000_000;

/** One edge: `1 unit = factor × parent` (parent = base or another row's unit). */
export type Conversion = { unit: string; parent: string; factor: number };

/** Trim + lowercase — idempotent, so validators may re-apply it safely. */
export function normalizeUoMCode(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Format of a (usually normalized) code — null when acceptable. */
export function uomCodeError(code: string, label: string): string | null {
  if (code.length === 0) return `${label} can't be empty.`;
  if (code.length > MAX_UOM_CODE) return `${label} must be ${MAX_UOM_CODE} characters or fewer.`;
  if (!/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(code)) {
    return `${label} must be letters/digits with "." or "-" separators (e.g. "each", "box").`;
  }
  return null;
}

export type ConversionsResult = { rows: Conversion[]; error: null } | { rows: null; error: string };

/**
 * Normalize + validate a product's conversion set against its base UoM.
 * First violation wins and its message IS the contract (the editor and the
 * mutation both surface it verbatim):
 *  - at most MAX_CONVERSIONS rows; rows need a valid base first
 *  - codes normalize then format-check; factors finite, > 0 and
 *    ≤ MAX_CONVERSION_FACTOR (NaN/Infinity ride the "> 0" message)
 *  - one row per unit; a unit converts to something else — never itself,
 *    and never the base (the base IS the target)
 *  - every chain terminates at the base: no cycles, and a parent must be
 *    the base or another row's unit (no dangling references)
 */
export function validateConversions(base: string, rows: Conversion[]): ConversionsResult {
  if (rows.length > MAX_CONVERSIONS) {
    return { rows: null, error: `Add at most ${MAX_CONVERSIONS} conversions per product.` };
  }
  if (rows.length === 0) return { rows: [], error: null };

  const normalizedBase = normalizeUoMCode(base);
  if (normalizedBase === "") {
    return { rows: null, error: "Set the base unit of measure before adding conversions." };
  }
  const baseError = uomCodeError(normalizedBase, "Unit of measure");
  if (baseError !== null) return { rows: null, error: baseError };

  const out: Conversion[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const unit = normalizeUoMCode(row.unit);
    const parent = normalizeUoMCode(row.parent);
    const unitError = uomCodeError(unit, "Conversion unit");
    if (unitError !== null) return { rows: null, error: unitError };
    const parentError = uomCodeError(parent, "Conversion parent");
    if (parentError !== null) return { rows: null, error: parentError };
    if (!Number.isFinite(row.factor) || row.factor <= 0) {
      return { rows: null, error: `Conversion factor for "${unit}" must be greater than 0.` };
    }
    if (row.factor > MAX_CONVERSION_FACTOR) {
      return {
        rows: null,
        error: `Conversion factor for "${unit}" must be ${MAX_CONVERSION_FACTOR} or fewer.`,
      };
    }
    if (unit === parent) {
      return { rows: null, error: `Conversion unit "${unit}" can't convert to itself.` };
    }
    if (unit === normalizedBase) {
      return { rows: null, error: `Conversion unit "${unit}" is already the base unit.` };
    }
    if (seen.has(unit)) return { rows: null, error: `Duplicate conversion for "${unit}".` };
    seen.add(unit);
    out.push({ unit, parent, factor: row.factor });
  }

  // Chains: walk each unit's parent links to the base. A revisit is a
  // cycle; a parent that is neither base nor a row's unit dangles.
  const byUnit = new Map(out.map((row) => [row.unit, row]));
  for (const row of out) {
    const path = [row.unit];
    let current = row;
    for (;;) {
      if (current.parent === normalizedBase) break;
      const next = byUnit.get(current.parent);
      if (next === undefined) {
        return {
          rows: null,
          error: `Conversion for "${current.unit}" references "${current.parent}", which is neither the base unit nor another conversion.`,
        };
      }
      if (path.includes(next.unit)) {
        return { rows: null, error: `Conversion chain loops back to "${next.unit}".` };
      }
      path.push(next.unit);
      current = next;
    }
  }
  return { rows: out, error: null };
}

/**
 * unit → factor-to-base map (the base itself maps to 1). For VALID sets —
 * call validateConversions first; the defensive break only stops a bad set
 * from looping forever.
 */
export function conversionFactors(base: string, rows: Conversion[]): Map<string, number> {
  const normalizedBase = normalizeUoMCode(base);
  const factors = new Map<string, number>([[normalizedBase, 1]]);
  const byUnit = new Map(rows.map((row) => [row.unit, row]));
  for (const row of rows) {
    let factor = row.factor;
    let current = row;
    const path = new Set([row.unit]);
    while (current.parent !== normalizedBase) {
      const next = byUnit.get(current.parent);
      if (next === undefined || path.has(next.unit)) break;
      path.add(next.unit);
      factor *= next.factor;
      current = next;
    }
    factors.set(row.unit, factor);
  }
  return factors;
}

/**
 * Convert a quantity between two units of one product through the base.
 * Returns null when either unit isn't in the set (callers surface their
 * own message). The raw float comes back — rounding belongs to the stock
 * and finance layers, not here.
 */
export function convertQuantity(
  quantity: number,
  from: string,
  to: string,
  base: string,
  rows: Conversion[],
): number | null {
  const factors = conversionFactors(base, rows);
  const source = factors.get(normalizeUoMCode(from));
  const target = factors.get(normalizeUoMCode(to));
  if (source === undefined || target === undefined || target === 0) return null;
  return (quantity * source) / target;
}

/**
 * A document-level UoM (purchase/sales default): unset is fine; set means
 * the base or one of the product's conversion units, so PH2 document lines
 * can always convert to base stock. Returns the normalized code (null when
 * unset) and the first violation's message.
 */
export function validateDocUoM(
  label: string,
  raw: string | undefined,
  base: string,
  rows: Conversion[],
): { code: string | null; error: string | null } {
  if (raw === undefined || raw.trim() === "") return { code: null, error: null };
  const code = normalizeUoMCode(raw);
  const formatError = uomCodeError(code, label);
  if (formatError !== null) return { code: null, error: formatError };
  const normalizedBase = normalizeUoMCode(base);
  if (normalizedBase === "") {
    return { code: null, error: `${label} "${code}" needs the base unit of measure set first.` };
  }
  const supported = new Set<string>([normalizedBase, ...rows.map((row) => row.unit)]);
  if (!supported.has(code)) {
    return {
      code: null,
      error: `${label} "${code}" must be the base unit or one of this product's conversions.`,
    };
  }
  return { code, error: null };
}
