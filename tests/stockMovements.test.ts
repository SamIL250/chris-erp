import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  latestUnitCost,
  movementQtyError,
  normalizeReference,
  onHandDelta,
  placeholderValue,
  referenceError,
  reservedDelta,
  stockBalance,
  unitCostError,
} from "../lib/stock";
import { setup } from "./setup";

/**
 * PH1-17 — append-only stock ledger. Sign rules live in lib/stock; the
 * mutation refuses a line that would break them, and nothing patches a
 * posted row.
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

async function seedProduct(t: T, sku = "LEDGER-1") {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: "Ledger item",
      slug: sku.toLowerCase(),
      sku,
      status: "active" as const,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedWarehouse(t: T, active = true) {
  return await t.run((ctx) =>
    ctx.db.insert("warehouses", {
      code: active ? "MAIN" : "OLD",
      name: active ? "Main" : "Old",
      isDefault: active,
      active,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("movement sign rules", () => {
  test("physical lines and holds carry the sign the sum will trust", () => {
    expect(movementQtyError("receipt", 5)).toBeNull();
    expect(movementQtyError("receipt", -1)).toMatch(/greater than zero/);
    expect(movementQtyError("issue", -2)).toBeNull();
    expect(movementQtyError("issue", 2)).toMatch(/less than zero/);
    expect(movementQtyError("transferIn", 1)).toBeNull();
    expect(movementQtyError("transferOut", -1)).toBeNull();
    expect(movementQtyError("reservation", 3)).toBeNull();
    expect(movementQtyError("reservation", -3)).toMatch(/greater than zero/);
    expect(movementQtyError("release", -3)).toBeNull();
    expect(movementQtyError("release", 3)).toMatch(/less than zero/);
    expect(movementQtyError("adjustment", 0)).toMatch(/can't be zero/);
    expect(movementQtyError("adjustment", -4)).toBeNull();
    expect(movementQtyError("receipt", Number.NaN)).toMatch(/finite/);

    const lines = [
      ["receipt", 10],
      ["reservation", 4],
      ["release", -1],
      ["issue", -3],
    ] as const;
    const onHand = lines.reduce((sum, [type, qty]) => sum + onHandDelta(type, qty), 0);
    const reserved = lines.reduce((sum, [type, qty]) => sum + reservedDelta(type, qty), 0);
    expect(onHand).toBe(7);
    expect(reserved).toBe(3);
    expect(onHand - reserved).toBe(4);
  });

  test("cost and reference are optional, and a half reference is refused", () => {
    expect(unitCostError(undefined)).toBeNull();
    expect(unitCostError(0)).toBeNull();
    expect(unitCostError(-1)).toMatch(/negative/);
    expect(referenceError(undefined, undefined)).toBeNull();
    expect(referenceError("  ", "")).toBeNull();
    expect(referenceError("salesOrder", undefined)).toMatch(/both/);
    expect(referenceError("sales-order", "x")).toMatch(/letters and numbers/);
    expect(normalizeReference(" salesOrder ", " abc ")).toEqual({
      referenceType: "salesOrder",
      referenceId: "abc",
    });
  });
});

describe("stockMovements.post", () => {
  test("appends a receipt and leaves it unchanged when a later line posts", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);

    const receiptId = await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 10,
      productId,
      warehouseId,
      unitCost: 4.5,
      referenceType: "goodsReceipt",
      referenceId: "gr-1",
    });
    await as.mutation(api.inventory.stock.post, {
      type: "issue",
      qty: -3,
      productId,
      warehouseId,
    });

    const rows = await as.query(api.inventory.stock.list, { productId });
    expect(rows.map((row) => row.qty)).toEqual([10, -3]);
    expect(rows[0]?._id).toBe(receiptId);
    expect(rows[0]?.unitCost).toBe(4.5);
    expect(rows[0]?.referenceType).toBe("goodsReceipt");
    expect(rows[1]?.unitCost).toBeUndefined();

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const posted = audits.filter((entry) => entry.entity === "stockMovements");
    expect(posted).toHaveLength(2);
    expect(posted[0]?.action).toBe("create");
    expect(posted[0]?.before).toBeUndefined();
  });

  test("refuses an inactive warehouse, a bad sign, and a one-sided reference", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t, false);

    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 1,
        productId,
        warehouseId,
      }),
    ).rejects.toThrow(/inactive/);

    const activeId = await seedWarehouse(t);
    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "issue",
        qty: 2,
        productId,
        warehouseId: activeId,
      }),
    ).rejects.toThrow(/less than zero/);
    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 1,
        productId,
        warehouseId: activeId,
        referenceType: "adjustment",
      }),
    ).rejects.toThrow(/both/);
  });

  test("a product with variants must name one of its own", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const otherId = await seedProduct(t, "LEDGER-2");
    const warehouseId = await seedWarehouse(t);
    const variantId = await t.run((ctx) =>
      ctx.db.insert("variants", {
        productId,
        optionValues: [],
        sku: "LEDGER-1-A",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const otherVariant = await t.run((ctx) =>
      ctx.db.insert("variants", {
        productId: otherId,
        optionValues: [],
        sku: "LEDGER-2-A",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 1,
        productId,
        warehouseId,
      }),
    ).rejects.toThrow(/name the variant/);
    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 1,
        productId,
        variantId: otherVariant,
        warehouseId,
      }),
    ).rejects.toThrow(/different product/);

    const id = await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 1,
      productId,
      variantId,
      warehouseId,
    });
    const rows = await as.query(api.inventory.stock.list, { productId, warehouseId });
    expect(rows.map((row) => row._id)).toEqual([id]);
  });

  test("a lot must belong to the product being moved", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const otherId = await seedProduct(t, "LEDGER-2");
    const warehouseId = await seedWarehouse(t);
    const lotId = await t.run((ctx) =>
      ctx.db.insert("lots", {
        productId: otherId,
        number: "BATCH-1",
        receivedDate: 1,
        status: "released",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 1,
        productId,
        warehouseId,
        lotId,
      }),
    ).rejects.toThrow(/different product/);
  });

  test("serials are one unit each and cannot repeat", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const serialId = await t.run((ctx) =>
      ctx.db.insert("serials", {
        productId,
        number: "SN-1",
        status: "available",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 2,
        productId,
        warehouseId,
        serialIds: [serialId],
      }),
    ).rejects.toThrow(/match the number of serials/);
    await expect(
      as.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 2,
        productId,
        warehouseId,
        serialIds: [serialId, serialId],
      }),
    ).rejects.toThrow(/more than once/);

    const id = await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 1,
      productId,
      warehouseId,
      serialIds: [serialId],
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.serialIds).toEqual([serialId]);
    const serial = await t.run((ctx) => ctx.db.get(serialId));
    expect(serial?.status).toBe("available");
  });

  test("sales can read the ledger and cannot post; anonymous is refused", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);

    expect(await sales.query(api.inventory.stock.list, { productId })).toEqual([]);
    await expect(
      sales.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 1,
        productId,
        warehouseId,
      }),
    ).rejects.toThrow("You don't have permission to create inventory items.");
    await expect(
      t.mutation(api.inventory.stock.post, {
        type: "receipt",
        qty: 1,
        productId,
        warehouseId,
      }),
    ).rejects.toThrow(/Not authenticated/);
  });

  test("the ledger module never patches or deletes a movement", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../convex/inventory/stock.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/ctx\.db\.(patch|delete)\(/);
    expect(source).toMatch(/export const post = auditedMutation/);
  });
});

describe("stock balances (PH1-18)", () => {
  test("available is on-hand minus the hold, and value uses the latest cost", () => {
    const lines = [
      { type: "receipt" as const, qty: 10, unitCost: 4 },
      { type: "reservation" as const, qty: 4, unitCost: 99 },
      { type: "release" as const, qty: -1 },
      { type: "issue" as const, qty: -3 },
      { type: "receipt" as const, qty: 2, unitCost: 6 },
    ];
    expect(stockBalance(lines)).toEqual({ onHand: 9, reserved: 3, available: 6 });
    expect(latestUnitCost(lines)).toBe(6);
    expect(placeholderValue(9, 6)).toBe(54);
    expect(placeholderValue(0, undefined)).toBeUndefined();
    expect(placeholderValue(1, 1.006)).toBe(1.01);
  });

  test("a warehouse balance ignores other warehouses and holds", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t);
    const main = await seedWarehouse(t);
    const east = await t.run((ctx) =>
      ctx.db.insert("warehouses", {
        code: "EAST",
        name: "East",
        isDefault: false,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 10,
      productId,
      warehouseId: main,
      unitCost: 4,
    });
    await as.mutation(api.inventory.stock.post, {
      type: "reservation",
      qty: 4,
      productId,
      warehouseId: main,
    });
    await as.mutation(api.inventory.stock.post, {
      type: "release",
      qty: -1,
      productId,
      warehouseId: main,
    });
    await as.mutation(api.inventory.stock.post, {
      type: "issue",
      qty: -3,
      productId,
      warehouseId: main,
    });
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 2,
      productId,
      warehouseId: east,
      unitCost: 9,
    });

    expect(
      await sales.query(api.inventory.stock.balance, { productId, warehouseId: main }),
    ).toEqual({ onHand: 7, reserved: 3, available: 4, unitCost: 4, value: 28 });
    expect(
      await sales.query(api.inventory.stock.balance, { productId, warehouseId: east }),
    ).toEqual({ onHand: 2, reserved: 0, available: 2, unitCost: 9, value: 18 });

    const list = await sales.query(api.inventory.stock.byWarehouse, { warehouseId: main });
    expect(list).toEqual([
      {
        productId,
        variantId: undefined,
        name: "Ledger item",
        sku: "LEDGER-1",
        onHand: 7,
        reserved: 3,
        available: 4,
        unitCost: 4,
        value: 28,
      },
    ]);
  });

  test("no lines yet is a zero balance, and a missing product is refused", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    expect(await sales.query(api.inventory.stock.balance, { productId, warehouseId })).toEqual({
      onHand: 0,
      reserved: 0,
      available: 0,
      unitCost: undefined,
      value: undefined,
    });
    expect(await sales.query(api.inventory.stock.byWarehouse, { warehouseId })).toEqual([]);
    const gone = await seedProduct(t, "LEDGER-GONE");
    await t.run((ctx) => ctx.db.delete(gone));
    await expect(
      sales.query(api.inventory.stock.balance, { productId: gone, warehouseId }),
    ).rejects.toThrow("Product not found.");
    await expect(t.query(api.inventory.stock.balance, { productId, warehouseId })).rejects.toThrow(
      /Not authenticated/,
    );
  });
});
