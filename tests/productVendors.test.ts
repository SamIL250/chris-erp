import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { vendorSkuError } from "../lib/productVendors";
import { setup } from "./setup";

/**
 * PH2-04 — a product names its vendors. One is preferred. The
 * supplier SKU is optional. A goods receipt writes the last purchase
 * price; the link form does not.
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

async function seedProduct(t: T, sku: string) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: sku,
      slug: sku.toLowerCase(),
      sku,
      status: "active" as const,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedVendor(t: T, code: string, active = true) {
  return await t.run((ctx) =>
    ctx.db.insert("vendors", {
      code,
      name: code,
      active,
      paymentTermsDays: 30,
      currency: "GBP",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedWarehouse(t: T) {
  return await t.run((ctx) =>
    ctx.db.insert("warehouses", {
      code: "MAIN",
      name: "Main",
      isDefault: true,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("product vendors (PH2-04)", () => {
  test("a vendor SKU is optional and stays in the supplier's casing", () => {
    expect(vendorSkuError(null)).toBeNull();
    expect(vendorSkuError("  ")).toBeNull();
    expect(vendorSkuError("ab-1")).toBeNull();
    expect(vendorSkuError("x".repeat(41))).toMatch(/40/);
    expect(vendorSkuError("nope!")).toMatch(/letters/);
    expect(vendorSkuError("-ab")).toMatch(/start and end/);
  });

  test("sales links a vendor, a receipt writes the price, and warehouse cannot edit the link", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    const productId = await seedProduct(t, "BENCH");
    const otherId = await seedProduct(t, "OTHER");
    const vendorId = await seedVendor(t, "MEDSUP");
    const secondId = await seedVendor(t, "PARTS");
    const inactiveId = await seedVendor(t, "OLD", false);
    const warehouseId = await seedWarehouse(t);

    await expect(
      warehouse.mutation(api.catalog.productVendors.link, {
        productId,
        vendorId,
        vendorSku: null,
        preferred: true,
      }),
    ).rejects.toThrow(/permission to edit catalog/);
    await expect(
      accountant.mutation(api.catalog.productVendors.link, {
        productId,
        vendorId,
        vendorSku: null,
        preferred: true,
      }),
    ).rejects.toThrow(/permission to edit catalog/);
    await expect(
      sales.mutation(api.catalog.productVendors.link, {
        productId,
        vendorId: inactiveId,
        vendorSku: null,
        preferred: true,
      }),
    ).rejects.toThrow(/inactive/);

    const first = await sales.mutation(api.catalog.productVendors.link, {
      productId,
      vendorId,
      vendorSku: "  ms-1  ",
      preferred: false,
    });
    await expect(
      sales.mutation(api.catalog.productVendors.link, {
        productId,
        vendorId,
        vendorSku: null,
        preferred: true,
      }),
    ).rejects.toThrow(/already linked/);

    const second = await sales.mutation(api.catalog.productVendors.link, {
      productId,
      vendorId: secondId,
      vendorSku: null,
      preferred: true,
    });

    let listed = await sales.query(api.catalog.productVendors.listForProduct, { productId });
    expect(listed.map((row) => [row.vendorCode, row.preferred, row.vendorSku])).toEqual([
      ["PARTS", true, null],
      ["MEDSUP", false, "ms-1"],
    ]);

    await sales.mutation(api.catalog.productVendors.update, {
      linkId: first,
      vendorSku: null,
      preferred: false,
    });
    await sales.mutation(api.catalog.productVendors.remove, { linkId: second });
    listed = await sales.query(api.catalog.productVendors.listForProduct, { productId });
    expect(listed).toMatchObject([{ vendorCode: "MEDSUP", preferred: true, vendorSku: null }]);

    const receiptId = await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      vendorId,
      referenceNote: "DN 12",
      lines: [
        { productId, qty: 2, unitCost: 12.5 },
        { productId: otherId, qty: 1, unitCost: 4 },
      ],
    });
    const receipt = await sales.query(api.inventory.goodsReceipts.get, { receiptId });
    expect(receipt.vendor).toMatchObject({ code: "MEDSUP", name: "MEDSUP" });

    listed = await warehouse.query(api.catalog.productVendors.listForProduct, { productId });
    expect(listed[0]).toMatchObject({ lastPurchasePrice: 12.5, preferred: true });
    expect(listed[0]?.lastPurchaseAt).toEqual(expect.any(Number));
    const untouched = await sales.query(api.catalog.productVendors.listForProduct, {
      productId: otherId,
    });
    expect(untouched).toEqual([]);

    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      vendorId,
      referenceNote: "no cost",
      lines: [{ productId, qty: 1 }],
    });
    listed = await sales.query(api.catalog.productVendors.listForProduct, { productId });
    expect(listed[0]?.lastPurchasePrice).toBe(12.5);

    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      vendorId,
      referenceNote: "cheaper",
      lines: [{ productId, qty: 1, unitCost: 0 }],
    });
    listed = await sales.query(api.catalog.productVendors.listForProduct, { productId });
    expect(listed[0]?.lastPurchasePrice).toBe(0);

    const onVendor = await sales.query(api.catalog.productVendors.listForVendor, { vendorId });
    expect(onVendor.map((row) => row.productSku)).toEqual(["BENCH"]);

    const missing = await t.run((ctx) =>
      ctx.db.insert("vendors", {
        code: "GONE",
        name: "Gone",
        active: true,
        paymentTermsDays: 0,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run((ctx) => ctx.db.delete(missing));
    await expect(
      warehouse.mutation(api.inventory.goodsReceipts.create, {
        warehouseId,
        vendorId: missing,
        referenceNote: "missing vendor",
        lines: [{ productId, qty: 1, unitCost: 3 }],
      }),
    ).rejects.toThrow(/Vendor not found/);

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audits.some((row) => row.entity === "productVendors" && row.action === "purchase")).toBe(
      true,
    );

    await asRole(t, "owner").then((owner) =>
      owner.mutation(api.catalog.products.remove, { id: productId }),
    );
    expect(await t.run((ctx) => ctx.db.query("productVendors").collect())).toEqual([]);
  });
});
