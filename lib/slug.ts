/**
 * URL slug generation (PH1-01) — pure and shared: the Convex mutations use it
 * to auto-derive category slugs server-side, the category editor (PH1-02)
 * uses the same function for live suggestions, so what you see is what gets
 * stored. Non-Latin names may legitimately produce an empty string — callers
 * must handle that (the mutation then requires an explicit slug).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD") // decompose accents: é → e + combining mark
    .replace(/[̀-ͯ]/g, "") // drop the combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // runs of anything else become one hyphen
    .replace(/^-+|-+$/g, ""); // no leading/trailing hyphens
}
