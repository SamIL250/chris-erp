/**
 * Image alt text (PH1-13) — the single rule + message source shared by the
 * editor's `buildProductArgs` gate and `requireImages` in the product
 * mutations (the `lib/uom` pattern: a blocked save shows the exact message
 * the server would have thrown). Alt text is attachment-scoped: it lives on
 * the product's `images[]` entry (`{ fileId, alt }`), not the file row, so
 * the same bytes could carry different descriptions wherever they attach.
 *
 * Empty means "decorative image" — stored as absent, never as "".
 */

export const MAX_IMAGE_ALT = 255;

/** Normalized alt for storage: trimmed; "" → undefined (absent). */
export function normalizeImageAlt(alt: string | undefined): string | undefined {
  const trimmed = (alt ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Verbatim message when an alt exceeds the limit, else null. */
export function imageAltError(alt: string | undefined): string | null {
  return (alt ?? "").trim().length > MAX_IMAGE_ALT
    ? `Image alt text must be ${MAX_IMAGE_ALT} characters or fewer.`
    : null;
}
