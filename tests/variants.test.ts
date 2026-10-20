import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Variant matrices (PH1-09): `variants:sync` reconciling axes → cartesian
 * matrix (defaults filled from the product, derived SKUs, preserve-by-
 * combination, orphan deletes listed in ONE product-level audit), full-form
 * `variants:update` with the SKU namespace SHARED WITH PRODUCTS, row
 * `remove`, `list`, the PH1-07 attribute guards extended to option pins and
 * axes, product delete cleaning variant rows, and the catalog RBAC ladder
 * (matrix writes ride catalog.edit — variants are product-document matrix
 * entries, not standalone master records).
 *
 * convex-test binds identity to the INSTANCE (`asOwner.mutation(...)`), so
 * a bare `t.mutation(...)` is the anonymous probe.
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

async function warehouseTools(t: T) {
  const worker = await seedUser(t, "dave@example.com");
  await grant(t, worker, "warehouse");
  return t.withIdentity({ subject: `${worker}|session-1` });
}

/**
 * Fixture: one category, a set covering it with two Select axes (Color,
 * Size), a number def, an EMPTY-options Select (axis guard probe), and one
 * Select that belongs to NO set (applicability probe).
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
    const color = await ctx.db.insert("attributeDefinitions", {
      name: "Color",
      type: "select",
      options: ["Black", "Silver"],
      createdAt: 1,
      updatedAt: 1,
    });
    const size = await ctx.db.insert("attributeDefinitions", {
      name: "Size",
      type: "select",
      options: ["S", "M", "L"],
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
    const empty = await ctx.db.insert("attributeDefinitions", {
      name: "Empty",
      type: "select",
      options: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const foreign = await ctx.db.insert("attributeDefinitions", {
      name: "Foreign",
      type: "select",
      options: ["Solo"],
      createdAt: 1,
      updatedAt: 1,
    });
    const set = await ctx.db.insert("attributeSets", {
      name: "Physical specs",
      attributeIds: [color, size, weight, empty],
      categoryIds: [imaging],
      createdAt: 1,
      updatedAt: 1,
    });
    return { imaging, color, size, weight, empty, foreign, set };
  });
}

async function insertProduct(
  t: T,
  sku: string,
  categoryIds: Id<"categories">[],
  flags: { serialTracked?: boolean; allowBackorder?: boolean } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: `Item ${sku}`,
      slug: `item-${sku.toLowerCase()}`,
      sku,
      status: "active" as const,
      categoryIds,
      serialTracked: flags.serialTracked ?? false,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
      allowBackorder: flags.allowBackorder ?? false,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

/** Real-but-deleted ids — Convex validators reject hand-made strings. */
async function danglingProduct(t: T): Promise<Id<"products">> {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("products", {
      name: "Gone",
      slug: "gone",
      sku: "GONE-1",
      status: "draft" as const,
      categoryIds: [],
      serialTracked: false,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
      allowBackorder: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });
}

async function danglingVariant(t: T): Promise<Id<"variants">> {
  return await t.run(async (ctx) => {
    const productId = await ctx.db.insert("products", {
      name: "Host",
      slug: "host",
      sku: "HOST-1",
      status: "draft" as const,
      categoryIds: [],
      serialTracked: false,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
      allowBackorder: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const id = await ctx.db.insert("variants", {
      productId,
      optionValues: [],
      sku: "TMP-1",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });
}

describe("variants:sync (PH1-09)", () => {
  test("generates the cartesian matrix with product defaults, derived SKUs, and one product audit", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "SHIRT-1", [fx.imaging], {
      serialTracked: true,
      allowBackorder: true,
    });

    const outcome = await asOwner.mutation(api.catalog.variants.sync, {
      id: product,
      axisIds: [fx.color, fx.size],
    });
    expect(outcome).toEqual({ created: 6, removed: 0, total: 6 });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );
    expect(rows).toHaveLength(6);
    // Applicable order (Color then Size) pins and derives — defaults filled
    // from the product row.
    const skus = rows.map((row) => row.sku).sort();
    expect(skus).toEqual([
      "SHIRT-1-BLACK-L",
      "SHIRT-1-BLACK-M",
      "SHIRT-1-BLACK-S",
      "SHIRT-1-SILVER-L",
      "SHIRT-1-SILVER-M",
      "SHIRT-1-SILVER-S",
    ]);
    for (const row of rows) {
      expect(row.serialTracked).toBe(true);
      expect(row.allowBackorder).toBe(true);
      expect(row.lotTracked).toBe(false); // filled explicitly from product defaults
      expect(row.listPrice).toBeUndefined();
      expect(row.optionValues).toHaveLength(2);
    }
    const stored = await t.run((ctx) => ctx.db.get(product));
    expect(stored?.variantAxisIds).toEqual([fx.color, fx.size]);

    // ONE product-level audit entry — a matrix is a product operation.
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]!.entity).toBe("products");
    expect(audit[0]!.action).toBe("update");
    expect(audit[0]!.entityId).toBe(product);
    const after = audit[0]!.after as Record<string, unknown>;
    expect(after.variantAxisIds).toEqual([fx.color, fx.size]);
    expect(after.variantCount).toBe(6);
    expect(after.created).toBe(6);
    expect(after.removed).toEqual([]);
  });

  test("axes validated: non-select, not applicable, empty options", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "GIZMO-1", [fx.imaging]);

    await expect(
      asOwner.mutation(api.catalog.variants.sync, {
        id: product,
        axisIds: [fx.color, fx.weight],
      }),
    ).rejects.toThrow(
      '"Weight" isn\'t a Select attribute — only Select attributes can be variant axes.',
    );
    await expect(
      asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.foreign] }),
    ).rejects.toThrow("One of those attributes isn't assigned to this product.");
    await expect(
      asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.empty] }),
    ).rejects.toThrow('"Empty" has no options yet — add options before making it a variant axis.');
    // Nothing landed.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("regeneration preserves rows and their edits as options grow; wholesale axis switches are strict", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "SOFA-1", [fx.imaging]);

    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });
    // A per-variant edit that regeneration must NOT touch.
    const silver = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect();
      const row = rows.find((variant) =>
        variant.optionValues.some((entry) => entry.value === "Silver"),
      )!;
      await ctx.db.patch(row._id, { sku: "SILVER-CUSTOM", listPrice: 99.5 });
      return row._id;
    });

    // Growing the axis's OPTIONS adds combinations; matching ones (exact
    // coordinate keys, axis-order independent) keep their edits.
    await asOwner.mutation(api.catalog.attributes.update, {
      id: fx.color,
      name: "Color",
      type: "select",
      unit: "",
      options: ["Black", "Silver", "Red"],
    });
    const grown = await asOwner.mutation(api.catalog.variants.sync, {
      id: product,
      axisIds: [fx.color],
    });
    expect(grown).toEqual({ created: 1, removed: 0, total: 3 });
    const kept = await t.run((ctx) => ctx.db.get(silver));
    expect(kept?.sku).toBe("SILVER-CUSTOM");
    expect(kept?.listPrice).toBe(99.5);

    // Switching axes wholesale: coordinates are exact — a single-axis row
    // can't half-match a two-axis matrix, so it's replaced (strict full-
    // cartesian semantics) and the audit names every removed row.
    const switched = await asOwner.mutation(api.catalog.variants.sync, {
      id: product,
      axisIds: [fx.color, fx.size],
    });
    expect(switched).toEqual({ created: 9, removed: 3, total: 9 }); // 3 colors × 3 sizes
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const last = audit[audit.length - 1]!;
    const snapshot = last.after as { removed: { sku: string }[] };
    expect(snapshot.removed.map((entry) => entry.sku).sort()).toEqual([
      "SILVER-CUSTOM",
      "SOFA-1-BLACK",
      "SOFA-1-RED",
    ]);
  });

  test("cartesian cap fails BEFORE any write; empty axes clears the matrix", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const wide = await t.run(async (ctx) => {
      const a = await ctx.db.insert("attributeDefinitions", {
        name: "Grade",
        type: "select",
        options: Array.from({ length: 15 }, (_, index) => `G${index + 1}`),
        createdAt: 1,
        updatedAt: 1,
      });
      const b = await ctx.db.insert("attributeDefinitions", {
        name: "Finish",
        type: "select",
        options: Array.from({ length: 15 }, (_, index) => `F${index + 1}`),
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(fx.set, { attributeIds: [a, b, fx.color, fx.size, fx.weight] });
      return { a, b };
    });
    const product = await insertProduct(t, "DESK-1", [fx.imaging]);

    await expect(
      asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [wide.a, wide.b] }),
    ).rejects.toThrow("That would create 225 variants — the limit is 200.");
    const rows = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );
    expect(rows).toHaveLength(0);

    // Empty axes is a legitimate "clear the matrix".
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });
    const cleared = await asOwner.mutation(api.catalog.variants.sync, {
      id: product,
      axisIds: [],
    });
    expect(cleared).toEqual({ created: 0, removed: 2, total: 0 });
    const stored = await t.run((ctx) => ctx.db.get(product));
    expect(stored?.variantAxisIds).toEqual([]);
  });

  test("a derived-SKU normalization clash fails the whole reconcile", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    // "Red" and "RED!" both tokenize to RED.
    await t.run((ctx) => ctx.db.patch(fx.color, { name: "Tint", options: ["Red", "RED!"] }));
    const product = await insertProduct(t, "POLY-1", [fx.imaging]);

    await expect(
      asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] }),
    ).rejects.toThrow(
      'Generated SKU "POLY-1-RED" is already in use — rename the product SKU or the options, then regenerate.',
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );
    expect(rows).toHaveLength(0); // transactional — no partial matrix
  });

  test("a no-op sync records nothing (PH0-30)", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "LAMP-1", [fx.imaging]);
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });

    const again = await asOwner.mutation(api.catalog.variants.sync, {
      id: product,
      axisIds: [fx.color],
    });
    expect(again).toEqual({ created: 0, removed: 0, total: 2 });
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1); // only the first sync
  });

  test("RBAC: catalog.edit writes, view reads, missing product names itself", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const asWarehouse = await warehouseTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "RACK-1", [fx.imaging]);

    await expect(
      asWarehouse.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] }),
    ).rejects.toThrow("You don't have permission to edit catalog items.");
    await expect(
      t.mutation(api.catalog.variants.sync, { id: product, axisIds: [] }),
    ).rejects.toThrow("Not authenticated");
    await expect(
      asOwner.mutation(api.catalog.variants.sync, {
        id: await danglingProduct(t),
        axisIds: [],
      }),
    ).rejects.toThrow("This product no longer exists.");
  });
});

describe("variants:update (PH1-09)", () => {
  test("full-form edit persists and audits; no-op records nothing", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "MUG-1", [fx.imaging]);
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });
    const [first] = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );

    await asOwner.mutation(api.catalog.variants.update, {
      id: first!._id,
      sku: "MUG-BLK",
      barcode: "4006381333931",
      listPrice: 4.5,
      serialTracked: true,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
      allowBackorder: true,
    });
    const edited = await t.run((ctx) => ctx.db.get(first!._id));
    expect(edited).toMatchObject({
      sku: "MUG-BLK",
      barcode: "4006381333931",
      listPrice: 4.5,
      serialTracked: true,
      allowBackorder: true,
    });
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(2); // sync + this edit
    expect(audit[1]!.entity).toBe("variants");
    expect(audit[1]!.action).toBe("update");

    // Identical payload → nothing recorded, updatedAt frozen.
    await t.run((ctx) => ctx.db.patch(first!._id, { updatedAt: 7 }));
    const noop = await asOwner.mutation(api.catalog.variants.update, {
      id: first!._id,
      sku: "MUG-BLK",
      barcode: "4006381333931",
      listPrice: 4.5,
      serialTracked: true,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
      allowBackorder: true,
    });
    expect(noop).toBeNull(); // Convex serializes an empty result to null
    const frozen = await t.run((ctx) => ctx.db.get(first!._id));
    expect(frozen?.updatedAt).toBe(7);
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(2);
  });

  test("SKU namespace is shared with products; format errors verbatim", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "LID-1", [fx.imaging]);
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });
    const [red, blue] = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );
    const base = {
      barcode: "",
      listPrice: null,
      serialTracked: false,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
      allowBackorder: false,
    };

    // Its own parent's SKU is taken too — a scan must resolve to one thing.
    await expect(
      asOwner.mutation(api.catalog.variants.update, { ...base, id: red!._id, sku: "LID-1" }),
    ).rejects.toThrow('A product with SKU "LID-1" already exists.');
    await expect(
      asOwner.mutation(api.catalog.variants.update, { ...base, id: red!._id, sku: blue!.sku }),
    ).rejects.toThrow(`A variant with SKU "${blue!.sku}" already exists.`);
    await expect(
      asOwner.mutation(api.catalog.variants.update, { ...base, id: red!._id, sku: "ab" }),
    ).rejects.toThrow("SKU must be at least 3 characters.");
    await expect(
      asOwner.mutation(api.catalog.variants.update, {
        ...base,
        id: red!._id,
        sku: red!.sku,
        listPrice: -1,
      }),
    ).rejects.toThrow("Variant price must be zero or more.");
    await expect(
      asOwner.mutation(api.catalog.variants.update, {
        ...base,
        id: red!._id,
        sku: red!.sku,
        barcode: "x".repeat(65),
      }),
    ).rejects.toThrow("Barcode must be 64 characters or fewer.");
  });

  test("RBAC: catalog.edit; missing row names itself", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const asWarehouse = await warehouseTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "BOX-1", [fx.imaging]);
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });
    const [first] = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );
    const args = {
      id: first!._id,
      sku: first!.sku,
      barcode: "",
      listPrice: null,
      serialTracked: false,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
      allowBackorder: false,
    };
    await expect(asWarehouse.mutation(api.catalog.variants.update, args)).rejects.toThrow(
      "You don't have permission to edit catalog items.",
    );
    await expect(t.mutation(api.catalog.variants.update, args)).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      asOwner.mutation(api.catalog.variants.update, {
        ...args,
        id: await danglingVariant(t),
      }),
    ).rejects.toThrow("This variant no longer exists.");
  });
});

describe("variants:list / variants:remove (PH1-09)", () => {
  test("list returns the matrix and is view-gated", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const asWarehouse = await warehouseTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "TRAY-1", [fx.imaging]);

    await expect(t.query(api.catalog.variants.list, { productId: product })).rejects.toThrow(
      "Not authenticated",
    );
    await asWarehouse.query(api.catalog.variants.list, { productId: product }); // view is enough

    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.size] });
    const rows = await asWarehouse.query(api.catalog.variants.list, { productId: product });
    expect(rows.map((row) => row.sku)).toEqual(["TRAY-1-S", "TRAY-1-M", "TRAY-1-L"]);
    await expect(
      asWarehouse.query(api.catalog.variants.list, {
        productId: await danglingProduct(t),
      }),
    ).rejects.toThrow("This product no longer exists.");
  });

  test("remove deletes the row, audits it, and rides catalog.edit", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const asWarehouse = await warehouseTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "JAR-1", [fx.imaging]);
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });
    const [first] = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );

    await expect(
      asWarehouse.mutation(api.catalog.variants.remove, { id: first!._id }),
    ).rejects.toThrow("You don't have permission to edit catalog items.");
    await asOwner.mutation(api.catalog.variants.remove, { id: first!._id });
    expect(await t.run((ctx) => ctx.db.get(first!._id))).toBeNull();
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const last = audit[audit.length - 1]!;
    expect(last.entity).toBe("variants");
    expect(last.action).toBe("delete");
    await expect(
      asOwner.mutation(api.catalog.variants.remove, { id: await danglingVariant(t) }),
    ).rejects.toThrow("This variant no longer exists.");
  });
});

describe("attribute guards extend to variants (PH1-09)", () => {
  test("option removal, attribute removal, and type change are blocked while variants pin them", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "COAT-1", [fx.imaging]);
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] }); // pins Black + Silver

    // Removing an option strands the pinned combination.
    await expect(
      asOwner.mutation(api.catalog.attributes.update, {
        id: fx.color,
        name: "Color",
        type: "select",
        unit: "",
        options: ["Black"],
      }),
    ).rejects.toThrow(
      'Option "Silver" is used by 1 variant — update or remove those variants first.',
    );

    // Removing the definition outright (after the PH1-07 set + value
    // checks — drop it from its set first so the VARIANT guard is what
    // answers).
    await t.run((ctx) => ctx.db.patch(fx.set, { attributeIds: [fx.size, fx.weight, fx.empty] }));
    await expect(asOwner.mutation(api.catalog.attributes.remove, { id: fx.color })).rejects.toThrow(
      "This attribute is used in variants on 1 product — remove the variant setup there first.",
    );

    // A type change would strand axes and pins on a definition that no
    // longer expresses them.
    await expect(
      asOwner.mutation(api.catalog.attributes.update, {
        id: fx.color,
        name: "Color",
        type: "text",
        unit: "",
        options: [],
      }),
    ).rejects.toThrow(
      "This attribute is used in variants on 1 product — remove the variant setup there first.",
    );
  });

  test("product delete cleans its variant rows", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const fx = await seedCatalog(t);
    const product = await insertProduct(t, "SOCK-1", [fx.imaging]);
    await asOwner.mutation(api.catalog.variants.sync, { id: product, axisIds: [fx.color] });

    await asOwner.mutation(api.catalog.products.remove, { id: product });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("variants")
        .withIndex("by_product", (q) => q.eq("productId", product))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });
});
