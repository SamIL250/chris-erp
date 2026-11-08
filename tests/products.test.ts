import { describe, expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Product master fields (PH1-06): the completed field manifest round-trips,
 * the optional shape keeps pre-PH1-06 documents readable, `by_barcode`
 * serves scanner lookups (blank rows live under the index's null key, so
 * eq() never matches them), and `taxCategory`
 * sticks to the PH0-24 taxGroups keys. There is no product CRUD yet
 * (PH1-07) — these are the schema-level contracts its mutations build on.
 */
describe("products schema (PH1-06)", () => {
  const minimal = (n: number) => ({
    name: `Bare ${n}`,
    slug: `bare-${n}`,
    sku: `BARE-${n}`,
    status: "draft" as const,
    categoryIds: [] as Id<"categories">[],
    createdAt: 1,
    updatedAt: 1,
  });

  test("full field manifest round-trips", async () => {
    const t = setup();
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "author@example.com",
        status: "active" as const,
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(new Blob(["cover-bytes"]));
      const fileId = await ctx.db.insert("files", {
        storageId,
        name: "cover.png",
        mimeType: "image/png",
        size: 11,
        kind: "productImage",
        uploadedBy: userId,
        createdAt: 1,
      });
      const setId = await ctx.db.insert("attributeSets", {
        name: "Extra specs",
        attributeIds: [],
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      });
      const catId = await ctx.db.insert("categories", {
        name: "Imaging",
        slug: "imaging",
        visible: true,
        position: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const productId = await ctx.db.insert("products", {
        name: "Portable Ultrasound X5",
        slug: "portable-ultrasound-x5",
        sku: "US-1001",
        barcode: "4006381333931",
        brand: "MediScan",
        shortDescription: "Five-inch handheld scanner.",
        longDescription: "<p>Full <strong>rich</strong> copy.</p>",
        status: "active" as const,
        taxCategory: "reduced" as const,
        serialTracked: true,
        lotTracked: false,
        expiryRequired: false,
        warrantyEligible: true,
        warrantyMonths: 24,
        shelfLifeDays: 730,
        allowBackorder: false,
        unitOfMeasure: "each",
        images: [{ fileId }],
        categoryIds: [catId],
        attributeSetIds: [setId],
        createdAt: 1,
        updatedAt: 1,
      });
      return { productId, fileId, setId, catId };
    });

    const row = await t.run((ctx) => ctx.db.get(ids.productId));
    expect(row).toMatchObject({
      barcode: "4006381333931",
      brand: "MediScan",
      shortDescription: "Five-inch handheld scanner.",
      longDescription: "<p>Full <strong>rich</strong> copy.</p>",
      status: "active",
      taxCategory: "reduced",
      serialTracked: true,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: true,
      warrantyMonths: 24,
      shelfLifeDays: 730,
      allowBackorder: false,
      unitOfMeasure: "each",
      images: [{ fileId: ids.fileId }],
      attributeSetIds: [ids.setId],
      categoryIds: [ids.catId],
    });
  });

  test("minimal product: every PH1-06 field stays absent (old rows keep reading)", async () => {
    const t = setup();
    const id = await t.run((ctx) => ctx.db.insert("products", minimal(1)));
    const row = await t.run((ctx) => ctx.db.get(id));
    // Direct access on purpose — toMatchObject treats absent and undefined
    // as equal, which would hide a required-vs-optional regression.
    expect(row?.barcode).toBeUndefined();
    expect(row?.brand).toBeUndefined();
    expect(row?.shortDescription).toBeUndefined();
    expect(row?.longDescription).toBeUndefined();
    expect(row?.taxCategory).toBeUndefined();
    expect(row?.serialTracked).toBeUndefined(); // readers use `=== true`
    expect(row?.warrantyMonths).toBeUndefined();
    expect(row?.unitOfMeasure).toBeUndefined();
    expect(row?.images).toBeUndefined();
    expect(row?.attributeSetIds).toBeUndefined();
  });

  test("taxCategory accepts the taxGroups keys (+ exempt), rejects the rest", async () => {
    const t = setup();
    for (const [index, taxCategory] of ["standard", "reduced", "zero", "exempt"].entries()) {
      await expect(
        t.run((ctx) =>
          ctx.db.insert("products", {
            ...minimal(10 + index),
            taxCategory: taxCategory as "standard",
          }),
        ),
      ).resolves.toBeDefined();
    }
    await expect(
      t.run((ctx) =>
        ctx.db.insert("products", { ...minimal(99), taxCategory: "super-reduced" as "standard" }),
      ),
    ).rejects.toThrow();
  });

  test("by_barcode: scanner lookup; a blank barcode never matches a real value", async () => {
    const t = setup();
    const { scanned, plain } = await t.run(async (ctx) => {
      const scanned = await ctx.db.insert("products", {
        ...minimal(1),
        sku: "SCANNED-1",
        barcode: "4006381333931",
      });
      const plain = await ctx.db.insert("products", { ...minimal(2), sku: "PLAIN-1" });
      return { scanned, plain };
    });

    const found = await t.run((ctx) =>
      ctx.db
        .query("products")
        .withIndex("by_barcode", (q) => q.eq("barcode", "4006381333931"))
        .unique(),
    );
    expect(found?._id).toBe(scanned);

    const miss = await t.run((ctx) =>
      ctx.db
        .query("products")
        .withIndex("by_barcode", (q) => q.eq("barcode", "0000000000000"))
        .unique(),
    );
    expect(miss).toBeNull();

    // Engine semantics (verified here, PH1-06): a missing optional field
    // IS indexed — under a null key that sorts before every real value —
    // so eq() lookups skip blank rows while a full index scan still
    // returns them, ordered blanks first.
    const fullScan = await t.run((ctx) =>
      ctx.db.query("products").withIndex("by_barcode").collect(),
    );
    expect(fullScan.map((row) => row._id)).toEqual([plain, scanned]);
    expect(plain).not.toBe(scanned);
  });
});
