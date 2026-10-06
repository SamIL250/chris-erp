import { describe, expect, test } from "vitest";
import { sanitizeRichText } from "../lib/richText";

/**
 * Rich-text write-time sanitization (PH1-07) — the allowlist the product
 * description (and later PH4-06 static pages) store under.
 */
describe("lib/richText (PH1-07)", () => {
  test("keeps document structure and inline formatting", () => {
    const html =
      "<h2>Title</h2><p>Hello <strong>bold</strong> and <em>italic</em>.</p><ul><li>one</li></ul>";
    expect(sanitizeRichText(html)).toBe(html);
    const link = '<p><a href="https://example.com">site</a></p>';
    expect(sanitizeRichText(link)).toBe(link);
  });

  test("drops scripts and styles with their contents", () => {
    expect(sanitizeRichText("<p>hi</p><script>alert(1)</script>")).toBe("<p>hi</p>");
    expect(sanitizeRichText("<style>.x{color:red}</style>")).toBe("");
  });

  test("strips event handlers and dangerous schemes, keeps the content", () => {
    expect(sanitizeRichText('<img src="x" onerror="alert(1)">')).toBe('<img src="x" />');
    expect(sanitizeRichText('<a href="javascript:alert(1)">click</a>')).toBe("<a>click</a>");
    expect(sanitizeRichText('<div onclick="steal()">text</div>')).toBe("text");
  });

  test("rejects iframes and style attributes", () => {
    expect(sanitizeRichText('<iframe src="https://evil"></iframe>')).toBe("");
    expect(sanitizeRichText('<p style="color:red">x</p>')).toBe("<p>x</p>");
  });

  test("is idempotent (write → read → write is stable)", () => {
    const once = sanitizeRichText("<p>a<b>b</b><script>x</script></p>");
    expect(sanitizeRichText(once)).toBe(once);
  });
});
