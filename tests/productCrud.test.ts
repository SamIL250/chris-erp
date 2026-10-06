import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Product CRUD (PH1-07): the editor's backend — SKU format (verbatim) and
 * uniqueness, slug derivation, sanitized rich text, full-form update with
 * no-op detection (PH0-30), the PH1-05 join staying in step with
 * `categoryIds`, typed attribute-value rows against the SAME applicability
 * resolver the editor renders from, delete cleaning join + value rows
 * (the PH1-06 guard's inverse), and the catalog RBAC ladder.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function grant(t: T, userId: Id<"users">, roleKey: string) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_key", (q) => q.eq("key", roleKey))
      .unique();
    const roleId =
      existing !== null
        ? existing._id
        : await ctx.db.insert("roles", { key: roleKey, name: roleKey, createdAt: Date.now() });
    await ctx.db.insert("userRoles", { userId, roleId, createdAt: Date.now() });
  });
}

async function ownerTools(t: T) {
  const owner = await seedUser(t, "owner@example.com");
  await grant(t, owner, "owner");
  return t.withIdentity({ subject: `${owner}|session-1` });
}

/**
 * Fixture: two categories, four definitions (one per shape the values
 * columns cover), and three sets — "Physical specs" covers Imaging,
 * "Bench specs" covers Centrifuges and SHARES two definitions (dedupe
 * probe), "Extra" covers nothing (product-level only).
 */
async function seedCatalog(t: T) {
  return await t.run(async (ctx) => {
    const imaging = await ctx.db.insert("categories", {
      name: "Imaging",
      slug: "imaging",
      visible: true,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const centrifuges = await ctx.db.insert("categories", {
      name: "Centrifuges",
      slug: "centrifuges",
      visible: true,
      position: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const weight = await ctx.db.insert("attributeDefinitions", {
      name: "Weight",
      type: "number",
      unit: "kg",
      options: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const color = await ctx.db.insert("attributeDefinitions", {
      name: "Color",
      type: "select",
      options: ["Black", "Silver"],
      createdAt: 1,
      updatedAt: 1,
    });
    const dimensions = await ctx.db.insert("attributeDefinitions", {
      name: "Dimensions",
      type: "text",
      options: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const tags = await ctx.db.insert("attributeDefinitions", {
      name: "Tags",
      type: "multi_select",
      options: ["fast", "portable"],
      createdAt: 1,
      updatedAt: 1,
    });
    const physical = await ctx.db.insert("attributeSets", {
      name: "Physical specs",
      attributeIds: [weight, color, dimensions],
      categoryIds: [imaging],
      createdAt: 1,
      updatedAt: 1,
    });
    const bench = await ctx.db.insert("attributeSets", {
      name: "Bench specs",
      attributeIds: [dimensions, weight],
      categoryIds: [centrifuges],
      createdAt: 1,
      updatedAt: 1,
    });
    const extra = await ctx.db.insert("attributeSets", {
      name: "Extra",
      attributeIds: [tags],
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    // Well-formed ids whose rows no longer exist — reference checks must
    // catch these (arg validators accept them; `db.get` returns null).
    const deadCategory = await ctx.db.insert("categories", {
      name: "Gone",
      slug: "gone",
      visible: true,
      position: 2,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.delete(deadCategory);
    const deadSet = await ctx.db.insert("attributeSets", {
      name: "Gone set",
      attributeIds: [],
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.delete(deadSet);
    const storageId = await ctx.storage.store(new Blob(["gone"]));
    const uploader = await ctx.db.insert("users", {
      email: "fixture-uploader@example.com",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const deadFile = await ctx.db.insert("files", {
      storageId,
      name: "gone.png",
      mimeType: "image/png",
      size: 4,
      kind: "productImage",
      uploadedBy: uploader,
      createdAt: 1,
    });
    await ctx.db.delete(deadFile);
    return {
      imaging,
      centrifuges,
      weight,
      color,
      dimensions,
      tags,
      physical,
      bench,
      extra,
      deadCategory,
      deadSet,
      deadFile,
    };
  });
}

/** The payload shape create/update share; every flag/array stated (writer-always-sends contract). */
function fullArgs(over: Record<string, unknown> = {}) {
  return {
    name: "Portable Ultrasound X5",
    sku: "US-1001",
    status: "active" as const,
    serialTracked: false,
    lotTracked: false,
    expiryRequired: false,
    warrantyEligible: false,
    allowBackorder: false,
    images: [] as Id<"files">[],
    categoryIds: [] as Id<"categories">[],
    attributeSetIds: [] as Id<"attributeSets">[],
    ...over,
  };
}

async function productRows(t: T) {
  return await t.run((ctx) => ctx.db.query("products").collect());
}

async function auditRows(t: T, entity = "products") {
  const rows = await t.run((ctx) => ctx.db.query("auditLog").collect());
  return rows.filter((row) => row.entity === entity);
}

/* -------------------------------------------------------------- create */

describe("products:create (PH1-07)", () => {
  test("round-trips the full payload and sanitizes rich text at write", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    const uploadedBy = await seedUser(t, "uploader@example.com");
    const fileId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["cover"]));
      return await ctx.db.insert("files", {
        storageId,
        name: "cover.png",
        mimeType: "image/png",
        size: 5,
        kind: "productImage",
        uploadedBy,
        createdAt: 1,
      });
    });

    const { id } = await as.mutation(api.catalog.products.create, {
      ...fullArgs({
        slug: "  Hand-Held!! Scanner  ",
        barcode: " 4006381333931 ",
        brand: "  MediScan  ",
        shortDescription: "  Five-inch handheld scanner.  ",
        longDescription: "<p>Full <strong>copy</strong>.<script>alert(1)</script></p>",
        taxCategory: "reduced",
        serialTracked: true,
        warrantyEligible: true,
        warrantyMonths: 24,
        shelfLifeDays: 730,
        unitOfMeasure: " each ",
        images: [fileId],
        categoryIds: [fixture.imaging],
        attributeSetIds: [fixture.extra],
        seoTitle: "X5 scanner",
        seoDescription: "Buy the X5.",
      }),
    });

    const row = (await productRows(t)).find((product) => product._id === id);
    expect(row).toMatchObject({
      name: "Portable Ultrasound X5",
      slug: "hand-held-scanner", // explicit normalizes (slugify), never derived
      sku: "US-1001",
      barcode: "4006381333931",
      brand: "MediScan",
      shortDescription: "Five-inch handheld scanner.",
      // Sanitizer ran server-side: the script tag (with content) is gone.
      longDescription: "<p>Full <strong>copy</strong>.</p>",
      status: "active",
      taxCategory: "reduced",
      serialTracked: true,
      warrantyMonths: 24,
      shelfLifeDays: 730,
      unitOfMeasure: "each",
      images: [fileId],
      categoryIds: [fixture.imaging],
      attributeSetIds: [fixture.extra],
      seoTitle: "X5 scanner",
      seoDescription: "Buy the X5.",
    });

    // Join rows exist from the same transaction (PH1-05 contract).
    const joins = await t.run((ctx) => ctx.db.query("productCategories").collect());
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ productId: id, categoryId: fixture.imaging });

    const audit = await auditRows(t);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "products",
      actorLabel: "owner@example.com",
      entityId: id,
      after: { sku: "US-1001", status: "active", categoryIds: [fixture.imaging], valueCount: 0 },
    });
  });

  test("SKU: verbatim format errors and org-wide uniqueness; slugs derive with suffixes", async () => {
    const t = setup();
    const as = await ownerTools(t);

    // Format rules surface the lib/sku messages byte-for-byte; no derivation.
    await expect(as.mutation(api.catalog.products.create, fullArgs({ sku: "ab" }))).rejects.toThrow(
      "SKU must be at least 3 characters.",
    );
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ sku: "US 1001" })),
    ).rejects.toThrow("SKU can't contain spaces.");
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ sku: "-edge-" })),
    ).rejects.toThrow("SKU must start and end with a letter or number.");
    // Lowercase normalizes (trim+uppercase) then validates — same as the form.
    const normalized = await as.mutation(
      api.catalog.products.create,
      fullArgs({ sku: " us-1001 ", name: "Normalizer Item" }),
    );
    const row = (await productRows(t)).find((product) => product._id === normalized.id);
    expect(row?.sku).toBe("US-1001");

    // Uniqueness is org-wide and case-normalized.
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ sku: "us-1001" })),
    ).rejects.toThrow('A product with SKU "US-1001" already exists.');

    // Omitted slug derives from the name; a second identical name suffixes.
    const a = await as.mutation(api.catalog.products.create, fullArgs({ sku: "US-1002" }));
    const b = await as.mutation(
      api.catalog.products.create,
      fullArgs({ sku: "US-1003", name: "Portable Ultrasound X5" }),
    );
    const rows = await productRows(t);
    expect(rows.find((product) => product._id === a.id)?.slug).toBe("portable-ultrasound-x5");
    expect(rows.find((product) => product._id === b.id)?.slug).toBe("portable-ultrasound-x5-2");

    // Explicit slugs must be free (global), never silently suffixed.
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({ sku: "US-1004", slug: "portable-ultrasound-x5" }),
      ),
    ).rejects.toThrow('A product with slug "portable-ultrasound-x5" already exists.');
  });

  test("validates names, counts, and reference existence", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);

    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ name: "   " })),
    ).rejects.toThrow("Product name must be between 1 and 100 characters.");
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ warrantyMonths: 5000 })),
    ).rejects.toThrow("Warranty months must be a whole number between 0 and 1200.");
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ shelfLifeDays: -1 })),
    ).rejects.toThrow("Shelf life days must be a whole number between 0 and 36500.");
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ seoTitle: "x".repeat(101) })),
    ).rejects.toThrow("SEO title must be 100 characters or fewer.");
    // Well-formed ids whose rows are gone → handler-level reference errors.
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ categoryIds: [fixture.deadCategory] })),
    ).rejects.toThrow("One of those categories no longer exists.");
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ attributeSetIds: [fixture.deadSet] })),
    ).rejects.toThrow("One of those attribute sets no longer exists.");
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ images: [fixture.deadFile] })),
    ).rejects.toThrow("One of those images no longer exists.");

    // A valid duplicate category list dedupes instead of erroring.
    const ok = await as.mutation(
      api.catalog.products.create,
      fullArgs({ categoryIds: [fixture.imaging, fixture.imaging] }),
    );
    const row = (await productRows(t)).find((product) => product._id === ok.id);
    expect(row?.categoryIds).toEqual([fixture.imaging]);
  });
});

/* --------------------------------------------------------- values rows */

describe("products:attributeValues (PH1-07)", () => {
  test("places typed rows for applicable attributes (category ∪ own sets)", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);

    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({
        categoryIds: [fixture.imaging],
        attributeSetIds: [fixture.extra],
        attributeValues: [
          { attributeId: fixture.weight, value: 4.2 },
          { attributeId: fixture.color, value: "Black" },
          { attributeId: fixture.dimensions, value: "60 × 40 × 25 cm" },
          { attributeId: fixture.tags, value: "fast" }, // multi_select: one row per option
          { attributeId: fixture.tags, value: "portable" },
        ],
      }),
    );

    const rows = await t.run((ctx) => ctx.db.query("attributeValues").collect());
    expect(rows).toHaveLength(5);
    const byAttribute = new Map(rows.map((row) => [row.attributeId, row]));
    expect(byAttribute.get(fixture.weight)).toMatchObject({ valueNumber: 4.2 });
    expect(byAttribute.get(fixture.color)).toMatchObject({ valueText: "Black" });
    expect(byAttribute.get(fixture.dimensions)).toMatchObject({ valueText: "60 × 40 × 25 cm" });
    expect(rows.filter((row) => row.attributeId === fixture.tags)).toHaveLength(2);
    expect(rows.every((row) => row.productId === id)).toBe(true);
    // Absent typed columns stay absent (PH1-05 contract).
    expect(byAttribute.get(fixture.weight)?.valueText).toBeUndefined();
  });

  test("rejects unassigned attributes, unknown options, wrong types, double values", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    const base = fullArgs({
      categoryIds: [fixture.imaging],
      attributeSetIds: [fixture.extra],
    });

    // Bench specs' definitions are only applicable via the centrifuges
    // category — a product sitting in Imaging + Extra can't hold them…
    // (weight/color/dimensions ARE applicable through Physical specs, so
    // probe unassigned-ness with a definition no applicable set contributes.)
    const unassigned = await t.run((ctx) =>
      ctx.db.insert("attributeDefinitions", {
        name: "Voltage",
        type: "text",
        options: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      as.mutation(api.catalog.products.create, {
        ...base,
        attributeValues: [{ attributeId: unassigned, value: "110V" }],
      }),
    ).rejects.toThrow("One of those attributes isn't assigned to this product.");

    await expect(
      as.mutation(api.catalog.products.create, {
        ...base,
        attributeValues: [{ attributeId: fixture.color, value: "Pink" }],
      }),
    ).rejects.toThrow('Color doesn\'t include "Pink".');
    await expect(
      as.mutation(api.catalog.products.create, {
        ...base,
        attributeValues: [{ attributeId: fixture.weight, value: "heavy" }],
      }),
    ).rejects.toThrow("Weight expects a number value.");
    await expect(
      as.mutation(api.catalog.products.create, {
        ...base,
        attributeValues: [
          { attributeId: fixture.color, value: "Black" },
          { attributeId: fixture.color, value: "Silver" },
        ],
      }),
    ).rejects.toThrow("Color accepts only one value.");
    await expect(
      as.mutation(api.catalog.products.create, {
        ...base,
        attributeValues: [{ attributeId: fixture.dimensions, value: "" }],
      }),
    ).rejects.toThrow("Dimensions can't be empty.");

    // None of the rejections wrote a product.
    expect(await productRows(t)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("attributeValues").collect())).toHaveLength(0);
  });

  test("update: a present list replaces (diffed); an absent arg leaves values untouched", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({
        categoryIds: [fixture.imaging],
        attributeValues: [
          { attributeId: fixture.weight, value: 4.2 },
          { attributeId: fixture.color, value: "Black" },
        ],
      }),
    );
    const created = (await productRows(t)).find((product) => product._id === id)!;
    const initial = await t.run((ctx) => ctx.db.query("attributeValues").collect());
    const weightRow = initial.find((row) => row.attributeId === fixture.weight);
    expect(weightRow).toMatchObject({ valueNumber: 4.2 });

    // Full replace: weight value edited, color dropped, dimensions added.
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({
        categoryIds: [fixture.imaging],
        attributeValues: [
          { attributeId: fixture.weight, value: 5.0 },
          { attributeId: fixture.dimensions, value: "60 cm" },
        ],
      }),
      id,
    });
    const after = await t.run((ctx) => ctx.db.query("attributeValues").collect());
    expect(after).toHaveLength(2);
    // The edited weight is a NEW row (keyed by value — rows aren't patched);
    // color's row is gone, dimensions' is fresh.
    expect(after.find((row) => row.attributeId === fixture.weight)).toMatchObject({
      valueNumber: 5,
    });
    expect(after.some((row) => row.attributeId === fixture.color)).toBe(false);
    expect(after.find((row) => row.attributeId === fixture.dimensions)).toMatchObject({
      valueText: "60 cm",
    });

    // Absent arg = values untouched (status-only saves can't wipe them).
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ categoryIds: [fixture.imaging], status: "draft", name: created.name }),
      id,
    });
    expect(await t.run((ctx) => ctx.db.query("attributeValues").collect())).toHaveLength(2);
    const row = (await productRows(t)).find((product) => product._id === id);
    expect(row?.status).toBe("draft");
  });
});

/* -------------------------------------------------------------- update */

describe("products:update (PH1-07)", () => {
  test("full-form edit audits before/after; an identical save records nothing", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    const createArgs = fullArgs({
      brand: "MediScan",
      categoryIds: [fixture.imaging],
      attributeValues: [{ attributeId: fixture.weight, value: 4.2 }],
    });
    const { id } = await as.mutation(api.catalog.products.create, createArgs);

    // Same payload again → no-op (PH0-30): no patch, no audit row.
    await as.mutation(api.catalog.products.update, { ...createArgs, id });
    expect(await auditRows(t)).toHaveLength(1);

    // Rename → audited with the old and new identity snapshot.
    await as.mutation(api.catalog.products.update, {
      ...createArgs,
      id,
      name: "X5 (2026)",
      brand: "MediScan GmbH",
    });
    const audit = await auditRows(t);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      action: "update",
      before: { name: "Portable Ultrasound X5", brand: "MediScan", valueCount: 1 },
      after: { name: "X5 (2026)", brand: "MediScan GmbH", valueCount: 1 },
    });
  });

  test("categoryIds writes sync the PH1-05 join in the same transaction", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({ categoryIds: [fixture.imaging] }),
    );
    const joinsFor = async () =>
      (await t.run((ctx) => ctx.db.query("productCategories").collect())).filter(
        (row) => row.productId === id,
      );

    expect(await joinsFor()).toHaveLength(1);

    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ categoryIds: [fixture.imaging, fixture.centrifuges] }),
      id,
    });
    expect((await joinsFor()).map((row) => row.categoryId).sort()).toEqual(
      [fixture.imaging, fixture.centrifuges].sort(),
    );

    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ categoryIds: [fixture.centrifuges] }),
      id,
    });
    expect((await joinsFor()).map((row) => row.categoryId)).toEqual([fixture.centrifuges]);
  });

  test("slug keeps when omitted, re-derives when blank; SKU changes re-check uniqueness", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const first = await as.mutation(api.catalog.products.create, fullArgs({ slug: "kept-slug" }));
    const second = await as.mutation(
      api.catalog.products.create,
      fullArgs({ sku: "US-2002", name: "Other Thing" }),
    );

    // Omitted slug + new name → stored slug survives (no silent rewrite).
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ name: "Renamed Without Slug" }),
      id: first.id,
    });
    // Blank slug → re-derive from the (new) name (own SKU stays put).
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ name: "Renamed Thing", slug: "", sku: "US-2002" }),
      id: second.id,
    });
    const rows = await productRows(t);
    expect(rows.find((row) => row._id === first.id)?.slug).toBe("kept-slug");
    expect(rows.find((row) => row._id === second.id)?.slug).toBe("renamed-thing");

    // SKU is never derived — changing it re-runs format + uniqueness.
    await expect(
      as.mutation(api.catalog.products.update, {
        ...fullArgs({ name: "Renamed Thing", sku: "US-1001" }), // first product's SKU
        id: second.id,
      }),
    ).rejects.toThrow('A product with SKU "US-1001" already exists.');
  });

  test("legacy rows without PH1-06 flags save without audit noise", async () => {
    const t = setup();
    const as = await ownerTools(t);
    // A document written before PH1-06/07: no flags, no images, no sets.
    const legacyId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Legacy Item",
        slug: "legacy-item",
        sku: "LEG-001",
        status: "draft",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    // Semantically identical save (flags sent false ≡ absent) → no-op.
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ name: "Legacy Item", slug: "legacy-item", sku: "LEG-001", status: "draft" }),
      id: legacyId,
    });
    expect(await auditRows(t)).toHaveLength(0);

    // A real change goes through and materializes the flags.
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({
        name: "Legacy Item II",
        slug: "legacy-item",
        sku: "LEG-001",
        status: "draft",
        serialTracked: true,
      }),
      id: legacyId,
    });
    const row = (await productRows(t)).find((product) => product._id === legacyId);
    expect(row).toMatchObject({ name: "Legacy Item II", serialTracked: true, lotTracked: false });
    expect(await auditRows(t)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- remove */

describe("products:remove (PH1-07)", () => {
  test("deletes the product and cleans join + value rows, with an audit", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({
        categoryIds: [fixture.imaging],
        attributeValues: [{ attributeId: fixture.weight, value: 4.2 }],
      }),
    );

    await as.mutation(api.catalog.products.remove, { id });

    expect(await productRows(t)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("productCategories").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("attributeValues").collect())).toHaveLength(0);
    const audit = await auditRows(t);
    expect(audit).toHaveLength(2); // create + delete
    expect(audit[1]).toMatchObject({
      action: "delete",
      before: { sku: "US-1001", categoryIds: [fixture.imaging], valueCount: 1 },
    });

    await expect(as.mutation(api.catalog.products.remove, { id })).rejects.toThrow(
      "This product no longer exists.",
    );
  });
});

/* ----------------------------------------------------------------- get */

describe("products:get (PH1-07)", () => {
  test("returns product + applicable attributes (category ∪ own sets, deduped) + values", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({
        categoryIds: [fixture.imaging, fixture.centrifuges],
        attributeSetIds: [fixture.extra],
        attributeValues: [
          { attributeId: fixture.weight, value: 4.2 },
          { attributeId: fixture.tags, value: "fast" },
        ],
      }),
    );

    const result = await as.query(api.catalog.products.get, { id });
    expect(result).not.toBeNull();
    expect(result!.product._id).toBe(id);
    // Set-name order across both categories' sets, first occurrence wins:
    // Bench specs (dimensions, weight) → Extra (tags) → Physical specs
    // (weight dup, color, dimensions dup).
    expect(result!.attributes.map((row) => row.name)).toEqual([
      "Dimensions",
      "Weight",
      "Tags",
      "Color",
    ]);
    expect(result!.values).toHaveLength(2);

    // Missing or malformed ids are "not found", not errors.
    expect(await as.query(api.catalog.products.get, { id: "definitely-not-an-id" })).toBeNull();
    await expect(t.query(api.catalog.products.get, { id })).rejects.toThrow("Not authenticated"); // anon
  });
});

/* ---------------------------------------------------------------- RBAC */

describe("products RBAC (PH1-07)", () => {
  test("catalog matrix: view widely, create/edit for sales, delete owner/admin only", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const warehouse = await seedUser(t, "warehouse@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, warehouse, "warehouse");
    await grant(t, accountant, "accountant");

    await expect(t.query(api.catalog.products.get, { id: "x" })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(t.mutation(api.catalog.products.create, fullArgs())).rejects.toThrow(
      "Not authenticated",
    );

    const probe = await ownerTools(t);
    const { id } = await probe.mutation(api.catalog.products.create, fullArgs({ sku: "RBAC-1" }));

    // Warehouse + Accountant: view only.
    for (const member of [warehouse, accountant]) {
      const viewer = t.withIdentity({ subject: `${member}|session-1` });
      expect((await viewer.query(api.catalog.products.get, { id }))?.product._id).toBe(id);
      await expect(viewer.mutation(api.catalog.products.create, fullArgs())).rejects.toThrow(
        "You don't have permission to create catalog items.",
      );
      await expect(
        viewer.mutation(api.catalog.products.update, { ...fullArgs({ name: "Nope" }), id }),
      ).rejects.toThrow("You don't have permission to edit catalog items.");
    }

    // Sales: view/create/edit — but NOT delete.
    const asSales = t.withIdentity({ subject: `${sales}|session-1` });
    const created = await asSales.mutation(
      api.catalog.products.create,
      fullArgs({ sku: "RBAC-2" }),
    );
    await asSales.mutation(api.catalog.products.update, {
      ...fullArgs({ sku: "RBAC-2", name: "Sales renamed this" }),
      id: created.id,
    });
    await expect(asSales.mutation(api.catalog.products.remove, { id: created.id })).rejects.toThrow(
      "You don't have permission to delete catalog items.",
    );

    // Owner: delete works.
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await asOwner.mutation(api.catalog.products.remove, { id: created.id });
    expect((await productRows(t)).map((row) => row._id)).toEqual([id]);
  });
});

/* --------------------------------------------------- attributes guards */

describe("attributes value guards (PH1-07)", () => {
  test("type changes and deletes are blocked while product values exist", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const fixture = await seedCatalog(t);
    await as.mutation(
      api.catalog.products.create,
      fullArgs({
        categoryIds: [fixture.imaging],
        attributeValues: [{ attributeId: fixture.color, value: "Black" }],
      }),
    );

    // Changing the type would strand the stored rows in their old column.
    await expect(
      as.mutation(api.catalog.attributes.update, {
        id: fixture.color,
        name: "Color",
        type: "text",
      }),
    ).rejects.toThrow(
      "This attribute is used by 1 product — clear those values before changing its type.",
    );
    // Same-type edits still work.
    await as.mutation(api.catalog.attributes.update, {
      id: fixture.color,
      name: "Finish",
      type: "select",
      options: ["Black", "Silver"],
    });
    // Unassign it from every set (sets may drop attributes freely)…
    await as.mutation(api.catalog.attributeSets.update, {
      id: fixture.physical,
      name: "Physical specs",
      attributeIds: [fixture.weight, fixture.dimensions],
      categoryIds: [fixture.imaging],
    });
    // …but deleting it would orphan the value rows.
    await expect(as.mutation(api.catalog.attributes.remove, { id: fixture.color })).rejects.toThrow(
      "This attribute is used by 1 product — remove those values on the product first.",
    );
  });
});
