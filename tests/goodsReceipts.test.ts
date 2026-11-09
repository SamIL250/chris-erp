import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { receiptNoteError } from "../lib/receipts";
import { setup } from "./setup";

/**
 * PH1-22 — manual goods receipt. The document and its ledger receipts
 * post together. A reference note is required. No purchase order.
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

describe("goods receipts (PH1-22)", () => {
  test("a reference note is required and capped", () => {
    expect(receiptNoteError(undefined)).toMatch(/reference note/);
    expect(receiptNoteError("  ")).toMatch(/reference note/);
    expect(receiptNoteError("DN 441")).toBeNull();
    expect(receiptNoteError("x".repeat(501))).toMatch(/500/);
  });

  test("posting a receipt puts the goods on hand and keeps the note", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t, "IN-1");
    const warehouseId = await seedWarehouse(t);

    const receiptId = await as.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      referenceNote: "  opening balance  ",
      lines: [{ productId, qty: 4, unitCost: 5 }],
    });

    const receipt = await sales.query(api.inventory.goodsReceipts.get, { receiptId });
    expect(receipt).toMatchObject({
      number: "GRN-0001",
      warehouseId,
      referenceNote: "opening balance",
      lines: [{ productId, qty: 4, unitCost: 5 }],
    });
    expect(await t.run((ctx) => ctx.db.query("journalIntents").collect())).toMatchObject([
      {
        type: "goodsReceipt",
        sourceType: "goodsReceipt",
        sourceId: receiptId,
        status: "pending",
        currency: "USD",
        amount: 20,
        lines: [{ productId, description: "IN-1", qty: 4, unitCost: 5, amount: 20 }],
      },
    ]);
    expect(await as.query(api.inventory.stock.balance, { productId, warehouseId })).toMatchObject({
      onHand: 4,
      available: 4,
      unitCost: 5,
      value: 20,
    });

    const movements = await as.query(api.inventory.stock.list, { productId, warehouseId });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: "receipt",
      qty: 4,
      unitCost: 5,
      referenceType: "goodsReceipt",
      referenceId: receiptId,
    });
    expect(receipt.lines[0]?.movementId).toBe(movements[0]?._id);

    const listed = await sales.query(api.inventory.goodsReceipts.list, { warehouseId });
    expect(listed.map((row) => row.number)).toEqual(["GRN-0001"]);

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const entry = audits.find((audit) => audit.entityId === receiptId);
    expect(entry).toMatchObject({ entity: "goodsReceipts", action: "create" });
    expect(entry?.before).toBeUndefined();
    expect(entry?.after).toMatchObject({ referenceNote: "opening balance", number: "GRN-0001" });
  });

  test("a bad line rolls the intake back, and a duplicate product is refused", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t, "IN-1");
    const otherId = await seedProduct(t, "IN-2");
    const warehouseId = await seedWarehouse(t);
    const serialId = await t.run((ctx) =>
      ctx.db.insert("serials", {
        productId: otherId,
        number: "SN-9",
        status: "available",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      as.mutation(api.inventory.goodsReceipts.create, {
        warehouseId,
        referenceNote: "mixed",
        lines: [
          { productId, qty: 2 },
          { productId: otherId, qty: 2, serialIds: [serialId, serialId] },
        ],
      }),
    ).rejects.toThrow(/more than once/);

    expect(await t.run((ctx) => ctx.db.query("goodsReceipts").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("stockMovements").collect())).toEqual([]);

    await expect(
      as.mutation(api.inventory.goodsReceipts.create, {
        warehouseId,
        referenceNote: "twice",
        lines: [
          { productId, qty: 1 },
          { productId, qty: 1 },
        ],
      }),
    ).rejects.toThrow(/already on this receipt/);
    await expect(
      as.mutation(api.inventory.goodsReceipts.create, {
        warehouseId,
        referenceNote: "   ",
        lines: [{ productId, qty: 1 }],
      }),
    ).rejects.toThrow(/reference note/);

    const inactive = await seedWarehouse(t, false);
    await expect(
      as.mutation(api.inventory.goodsReceipts.create, {
        warehouseId: inactive,
        referenceNote: "old shed",
        lines: [{ productId, qty: 1 }],
      }),
    ).rejects.toThrow(/inactive/);
    expect(await t.run((ctx) => ctx.db.query("goodsReceipts").collect())).toEqual([]);
  });

  test("sales can read a receipt and cannot post one", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t, "IN-1");
    const warehouseId = await seedWarehouse(t);
    const args = {
      warehouseId,
      referenceNote: "walk-in",
      lines: [{ productId, qty: 1 }],
    };

    expect(await sales.query(api.inventory.goodsReceipts.list, {})).toEqual([]);
    await expect(sales.mutation(api.inventory.goodsReceipts.create, args)).rejects.toThrow(
      "You don't have permission to create inventory items.",
    );
    await expect(t.mutation(api.inventory.goodsReceipts.create, args)).rejects.toThrow(
      /Not authenticated/,
    );
  });
});
