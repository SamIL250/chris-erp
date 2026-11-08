import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isPickerListed, isStorefrontListed } from "../lib/schemas/products";
import { setup } from "./setup";

/**
 * PH1-15 — duplicate a product into a draft, and keep archived products
 * out of the picker (and the default catalog list).
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      status: "active" as const,
      createdAt: 1,
      updatedAt: 1,
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
        : await ctx.db.insert("roles", { key: roleKey, name: roleKey, createdAt: 1 });
    await ctx.db.insert("userRoles", { userId, roleId, createdAt: 1 });
  });
}

async function asRole(t: T, roleKey: string) {
  const userId = await seedUser(t, `${roleKey}@example.com`);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

describe("visibility (PH1-15)", () => {
  test("archived is off pickers and the storefront; drafts stay staff-only", () => {
    expect(isPickerListed("active")).toBe(true);
    expect(isPickerListed("draft")).toBe(true);
    expect(isPickerListed("archived")).toBe(false);
    expect(isStorefrontListed("active")).toBe(true);
    expect(isStorefrontListed("draft")).toBe(false);
    expect(isStorefrontListed("archived")).toBe(false);
  });
});

describe("products:picker (PH1-15)", () => {
  test("offers active and draft, never archived", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const active = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Live",
        slug: "live",
        sku: "PK-1",
        status: "active",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const draft = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "WIP",
        slug: "wip",
        sku: "PK-2",
        status: "draft",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Retired",
        slug: "retired",
        sku: "PK-3",
        status: "archived",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(t.query(api.catalog.products.picker, {})).rejects.toThrow("Not authenticated");
    const rows = await as.query(api.catalog.products.picker, {});
    expect(rows.map((row) => row._id).sort()).toEqual([active, draft].sort());
    expect(rows.every((row) => row.status !== "archived")).toBe(true);

    const found = await as.query(api.catalog.products.picker, { search: "wi" });
    expect(found.map((row) => row._id)).toEqual([draft]);
  });
});

describe("products:duplicate (PH1-15)", () => {
  test("copies catalog identity into a draft and leaves the source alone", async () => {
    const t = setup();
    const as = await asRole(t, "owner");
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "uploader@example.com",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(new Blob(["img"]));
      const fileId = await ctx.db.insert("files", {
        storageId,
        name: "cover.png",
        mimeType: "image/png",
        size: 3,
        kind: "productImage",
        uploadedBy: userId,
        createdAt: 1,
      });
      const categoryId = await ctx.db.insert("categories", {
        name: "Imaging",
        slug: "imaging",
        visible: true,
        position: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const attributeId = await ctx.db.insert("attributeDefinitions", {
        name: "Color",
        type: "select",
        options: ["Black"],
        createdAt: 1,
        updatedAt: 1,
      });
      const productId = await ctx.db.insert("products", {
        name: "Portable Ultrasound",
        slug: "portable-ultrasound",
        sku: "US-1001",
        barcode: "4006381333931",
        brand: "MediScan",
        listPrice: 1000,
        status: "active",
        serialTracked: true,
        categoryIds: [categoryId],
        images: [{ fileId, alt: "On a bench" }],
        variantAxisIds: [attributeId],
        unitOfMeasure: "each",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("productCategories", { productId, categoryId });
      await ctx.db.insert("attributeValues", {
        productId,
        attributeId,
        valueText: "Black",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("variants", {
        productId,
        optionValues: [{ attributeId, value: "Black" }],
        sku: "US-1001-BLK",
        barcode: "111",
        listPrice: 1100,
        serialTracked: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return { productId, categoryId, attributeId, fileId };
    });

    const { id } = await as.mutation(api.catalog.products.duplicate, { id: ids.productId });
    expect(id).not.toBe(ids.productId);

    const copy = await t.run(async (ctx) => {
      const product = await ctx.db.get(id);
      const values = await ctx.db
        .query("attributeValues")
        .withIndex("by_product", (q) => q.eq("productId", id))
        .collect();
      const variants = await ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", id))
        .collect();
      const joins = await ctx.db
        .query("productCategories")
        .withIndex("by_product", (q) => q.eq("productId", id))
        .collect();
      const source = await ctx.db.get(ids.productId);
      return { product, values, variants, joins, source };
    });

    expect(copy.source?.status).toBe("active");
    expect(copy.source?.sku).toBe("US-1001");
    expect(copy.product).toMatchObject({
      name: "Portable Ultrasound (copy)",
      slug: "portable-ultrasound-copy",
      sku: "US-1001-COPY",
      status: "draft",
      brand: "MediScan",
      listPrice: 1000,
      serialTracked: true,
      unitOfMeasure: "each",
      images: [{ fileId: ids.fileId, alt: "On a bench" }],
      categoryIds: [ids.categoryId],
      variantAxisIds: [ids.attributeId],
    });
    expect(copy.product?.barcode).toBeUndefined();
    expect(copy.values.map((row) => row.valueText)).toEqual(["Black"]);
    expect(copy.variants).toHaveLength(1);
    expect(copy.variants[0]).toMatchObject({
      sku: "US-1001-BLK-COPY",
      listPrice: 1100,
      serialTracked: true,
      optionValues: [{ attributeId: ids.attributeId, value: "Black" }],
    });
    expect(copy.variants[0]?.barcode).toBeUndefined();
    expect(copy.joins.map((row) => row.categoryId)).toEqual([ids.categoryId]);

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const entry = audits.find((row) => row.entityId === id);
    expect(entry?.action).toBe("create");
    expect(entry?.after).toMatchObject({
      sourceId: ids.productId,
      sku: "US-1001-COPY",
      variantCount: 1,
    });

    const again = await as.mutation(api.catalog.products.duplicate, { id: ids.productId });
    const second = await t.run((ctx) => ctx.db.get(again.id));
    expect(second?.sku).toBe("US-1001-COPY2");
    expect(second?.slug).toBe("portable-ultrasound-copy-2");
  });

  test("a 32-character SKU still yields a valid copy suffix", async () => {
    const t = setup();
    const as = await asRole(t, "sales");
    const sku = "A".repeat(32);
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Long",
        slug: "long",
        sku,
        status: "archived",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const { id } = await as.mutation(api.catalog.products.duplicate, { id: productId });
    const copy = await t.run((ctx) => ctx.db.get(id));
    expect(copy?.sku).toBe(`${"A".repeat(27)}-COPY`);
    expect(copy?.status).toBe("draft");
    expect(copy?.name).toBe("Long (copy)");
  });

  test("missing product, and warehouse cannot create a copy", async () => {
    const t = setup();
    const owner = await asRole(t, "owner");
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "One",
        slug: "one",
        sku: "ONE-1",
        status: "active",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      owner.mutation(api.catalog.products.duplicate, { id: productId }),
    ).resolves.toMatchObject({ id: expect.any(String) });

    const warehouse = await asRole(t, "warehouse");
    await expect(
      warehouse.mutation(api.catalog.products.duplicate, { id: productId }),
    ).rejects.toThrow("You don't have permission to create catalog items.");
    await expect(t.mutation(api.catalog.products.duplicate, { id: productId })).rejects.toThrow(
      "Not authenticated",
    );
  });
});
