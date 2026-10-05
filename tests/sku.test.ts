import { describe, expect, test } from "vitest";
import { SKU_MAX_LENGTH, normalizeSku, skuFormatError, validateSku } from "../lib/sku";

/**
 * SKU format rules (PH1-06) — the shared half of the product-identity
 * contract: normalize + validate are pure so the PH1-07 editor and the
 * Convex mutations use the SAME rules; uniqueness (`by_sku`) is the
 * write-time half and lands with those mutations.
 */
describe("lib/sku (PH1-06)", () => {
  test("normalize applies trim + uppercase only", () => {
    expect(normalizeSku("  abc-1  ")).toBe("ABC-1");
    expect(normalizeSku("x5")).toBe("X5");
    // Internal space is preserved — validation rejects it; identifiers are
    // never silently rewritten (unlike URL slugs).
    expect(normalizeSku("a b")).toBe("A B");
  });

  test("valid SKUs pass, including every allowed separator", () => {
    for (const sku of [
      "ABC",
      "A12",
      "US-1001",
      "BOX.2",
      "KIT/7",
      "AB_C",
      "1234567890", // digits-only is fine
      "A".repeat(SKU_MAX_LENGTH), // exactly the max
    ]) {
      expect(skuFormatError(sku)).toBeNull();
    }
  });

  test("length bounds with exact messages", () => {
    expect(skuFormatError("")).toBe("SKU must be at least 3 characters.");
    expect(skuFormatError("AB")).toBe("SKU must be at least 3 characters.");
    expect(skuFormatError("A".repeat(SKU_MAX_LENGTH + 1))).toBe(
      `SKU must be at most ${SKU_MAX_LENGTH} characters.`,
    );
  });

  test("spaces and out-of-charset characters are precise errors", () => {
    expect(skuFormatError("AB 1")).toBe("SKU can't contain spaces.");
    expect(skuFormatError("AB@1")).toBe("SKU may only contain letters, numbers, and - . / _");
    // No accent folding (deliberate: slugify NFKDs, SKUs don't).
    expect(skuFormatError("MÜNCHEN1")).toBe("SKU may only contain letters, numbers, and - . / _");
  });

  test("must start and end alphanumeric", () => {
    expect(skuFormatError("-ABC")).toBe("SKU must start and end with a letter or number.");
    expect(skuFormatError("ABC-")).toBe("SKU must start and end with a letter or number.");
    expect(skuFormatError("A-B")).toBeNull(); // separators only between
  });

  test("validateSku normalizes then validates in one call", () => {
    expect(validateSku("  us-1001 ")).toEqual({ sku: "US-1001", error: null });
    expect(validateSku(" x ")).toEqual({ sku: "X", error: "SKU must be at least 3 characters." });
    expect(validateSku("bad sku!").error).toBe("SKU can't contain spaces.");
  });
});
