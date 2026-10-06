import sanitizeHtml from "sanitize-html";

/**
 * Rich-text storage rules (PH1-07): Tiptap (the product editor's WYSIWYG,
 * chosen 2026-10-05) writes HTML, which is sanitized HERE — at write time,
 * inside the Convex mutation — so the storefront (PH4-04) and the static
 * pages (PH4-06) can render `longDescription` as-is with no per-render
 * sanitizer to forget. Server-side enforcement is what makes that safe;
 * the client never gets to skip it.
 *
 * The allowlist is deliberately narrow: document structure + inline
 * emphasis + links (http/https/mailto only — `javascript:` dies in
 * sanitize-html's scheme filter) + images (http/https; the PH1-13 media
 * flow will mint https Convex storage URLs). No style/class attributes,
 * no event handlers, no iframes; `<script>`/`<style>` fall out with their
 * contents (sanitize-html's nonTextTags).
 */
const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "a",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "code",
    "pre",
    "img",
  ],
  allowedAttributes: {
    a: ["href"],
    img: ["src", "alt", "title"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
};

/** Sanitize a rich-text HTML fragment for storage. Idempotent. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS);
}
