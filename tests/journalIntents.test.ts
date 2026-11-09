import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  intentLineAmount,
  intentTotal,
  journalIntentStatusLabel,
  journalIntentTypeLabel,
} from "../lib/journalIntents";
import { setup } from "./setup";

/**
 * PH2-26 — a goods receipt, a debit note, and a stock adjustment each
 * write one pending intent. A missing cost is zero. The backlog is
 * readable with finance.view and is not posted here.
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

describe("journal intent amounts", () => {
  test("a missing cost is zero and a removal keeps its sign", () => {
    expect(intentLineAmount(2, undefined)).toBe(0);
    expect(intentLineAmount(2, 6)).toBe(12);
    expect(intentLineAmount(-1, 4)).toBe(-4);
    expect(intentTotal([12, 0, -4])).toBe(8);
    expect(journalIntentTypeLabel("goodsReceipt")).toBe("Goods receipt");
    expect(journalIntentTypeLabel("debitNote")).toBe("Debit note");
    expect(journalIntentTypeLabel("stockAdjustment")).toBe("Stock adjustment");
    expect(journalIntentStatusLabel("pending")).toBe("Pending");
  });
});

describe("journal intent backlog", () => {
  test("receipts, debit notes, and adjustments stay pending in the company currency", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Gel",
        slug: "gel",
        sku: "GEL",
        status: "active" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const warehouseId = await t.run((ctx) =>
      ctx.db.insert("warehouses", {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Chris",
        baseCurrency: "GBP",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    const costlessId = await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      referenceNote: "No cost",
      lines: [{ productId, qty: 1 }],
    });
    const pricedId = await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      referenceNote: "Priced",
      lines: [{ productId, qty: 2, unitCost: 4 }],
    });
    const costless = await warehouse.query(api.inventory.goodsReceipts.get, {
      receiptId: costlessId,
    });
    const lineId = costless.lines[0]?.lineId;
    if (lineId === undefined) throw new Error("receipt line missing");
    const returnId = await warehouse.mutation(api.procurement.purchaseReturns.create, {
      goodsReceiptId: costlessId,
      reason: "No cost to reverse",
      lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
    });
    const adjustmentId = await warehouse.mutation(api.inventory.stock.adjust, {
      productId,
      warehouseId,
      qty: -1,
      reason: "damage",
      unitCost: 4,
    });

    const intents = await t.run((ctx) => ctx.db.query("journalIntents").collect());
    expect(intents.map((row) => [row.type, row.sourceId, row.currency, row.amount])).toEqual([
      ["goodsReceipt", costlessId, "GBP", 0],
      ["goodsReceipt", pricedId, "GBP", 8],
      ["debitNote", returnId, "GBP", 0],
      ["stockAdjustment", adjustmentId, "GBP", -4],
    ]);
    expect(intents.every((row) => row.status === "pending")).toBe(true);
    expect(intents[3]?.lines[0]).toMatchObject({
      description: "Gel · Damage",
      qty: -1,
      unitCost: 4,
      amount: -4,
    });

    await expect(warehouse.query(api.finance.journalIntents.list, {})).rejects.toThrow(
      /permission to view finance/,
    );
    const listed = await sales.query(api.finance.journalIntents.list, {});
    expect(listed.map((row) => [row.type, row.number, row.amount, row.currency])).toEqual([
      ["stockAdjustment", "Gel · Damage", -4, "GBP"],
      ["debitNote", "DBN-0001", 0, "GBP"],
      ["goodsReceipt", "GRN-0002", 8, "GBP"],
      ["goodsReceipt", "GRN-0001", 0, "GBP"],
    ]);
    expect(listed[0]?.href).toBeNull();
    expect(listed[1]?.href).toBe(`/procurement/returns/${returnId}`);
    expect(listed[3]?.href).toBe(`/inventory/receipts/${costlessId}`);
    expect(listed.every((row) => row.status === "pending")).toBe(true);
  });
});
