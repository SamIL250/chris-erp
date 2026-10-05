/**
 * Locale/timezone formatting (PH0-33): pure helpers that take the stored
 * `{locale, timezone}` preferences (from `formatting:get`, nulls = browser
 * defaults) so renderers stay deterministic. Adopt these in tables/documents
 * from Phase 1 on.
 */

export interface FormattingPreferences {
  locale: string | null;
  timezone: string | null;
}

/** Date only, e.g. "Oct 5, 2026" / "05.10.2026". */
export function formatDate(
  value: number | Date,
  prefs: FormattingPreferences,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(prefs.locale ?? undefined, {
    ...options,
    ...(prefs.timezone ? { timeZone: prefs.timezone } : {}),
  }).format(value);
}

/** Date + time in the company timezone (documents, audit entries). */
export function formatDateTime(value: number | Date, prefs: FormattingPreferences): string {
  return formatDate(value, prefs, { dateStyle: "medium", timeStyle: "short" });
}

/** Locale-aware number: grouping, decimal mark (1,234.56 vs 1.234,56). */
export function formatNumber(
  value: number,
  prefs: FormattingPreferences,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(prefs.locale ?? undefined, options).format(value);
}

/** Rate-style percent: 0.195 → "19.5%". */
export function formatPercent(value: number, prefs: FormattingPreferences): string {
  return formatNumber(value, prefs, { style: "percent", maximumFractionDigits: 2 });
}
