import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  debitNoteAmount,
  purchaseReturnQtyError,
  purchaseReturnReasonError,
  returnStockError,
} from "../lib/purchaseReturns";
import { setup } from "./setup";

/**
 * PH2-24 — return quantity that a receipt put on hand. The line posts
 * a stock issue, and the document number is the debit note reference.
 * The receipt and the vendor's received total stay as they were.
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

async function seedVendor(t: T) {
  return await t.run((ctx) =>
    ctx.db.insert("vendors", {
      code: "PARTS",
      name: "Parts Co",
      active: true,
      paymentTermsDays: 0,
      currency: "GBP",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("purchase return rules", () => {
  test("a return stays inside what the receipt still holds", () => {
    expect(purchaseReturnQtyError({ received: 2, alreadyReturned: 1, qty: 1 })).toBeNull();
    expect(purchaseReturnQtyError({ received: 2, alreadyReturned: 0, qty: 0 })).toMatch(
      /quantity to return/,
    );
    expect(purchaseReturnQtyError({ received: 2, alreadyReturned: 0, qty: -1 })).toMatch(
      /can't be negative/,
    );
    expect(purchaseReturnQtyError({ received: 2, alreadyReturned: 2, qty: 1 })).toMatch(
      /left to return/,
    );
    expect(purchaseReturnQtyError({ received: 2, alreadyReturned: 1, qty: 2 })).toMatch(
      /still holds/,
    );
    expect(purchaseReturnReasonError("  ")).toMatch(/reason/);
    expect(purchaseReturnReasonError("Damaged")).toBeNull();
    expect(purchaseReturnReasonError("x".repeat(201))).toMatch(/200/);
  });

  test("reserved stock cannot leave, and a costless return has no amount", () => {
    expect(returnStockError({ qty: 1, available: 1, reserved: 0 })).toBeNull();
    expect(returnStockError({ qty: 1, available: 0, reserved: 1 })).toMatch(/reserved/);
    expect(returnStockError({ qty: 1, available: 0, reserved: 0 })).toMatch(/on hand/);
    expect(returnStockError({ qty: 2, available: 1, reserved: 0 })).toMatch(/on hand to return/);
    expect(returnStockError({ qty: 2, available: 1, reserved: 3 })).toMatch(/reserved/);
    expect(debitNoteAmount([{ qty: 2, unitCost: 6 }])).toBe(12);
    expect(debitNoteAmount([{ qty: 1, unitCost: null }])).toBeNull();
  });
});

describe("purchase returns", () => {
  test("returning receipt quantity issues stock and keeps the debit note number", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const accountant = await asRole(t, "accountant");
    const productId = await seedProduct(t, "GEL");
    const warehouseId = await seedWarehouse(t);
    const vendorId = await seedVendor(t);

    const receiptId = await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      vendorId,
      referenceNote: "Opening gel",
      lines: [{ productId, qty: 2, unitCost: 6 }],
    });
    const receipt = await warehouse.query(api.inventory.goodsReceipts.get, { receiptId });
    const lineId = receipt.lines[0]?.lineId;
    if (lineId === undefined) throw new Error("receipt line missing");

    const otherId = await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      referenceNote: "Other bin",
      lines: [{ productId, qty: 1, unitCost: 6 }],
    });
    const other = await warehouse.query(api.inventory.goodsReceipts.get, { receiptId: otherId });
    const otherLineId = other.lines[0]?.lineId;
    if (otherLineId === undefined) throw new Error("other receipt line missing");

    await expect(
      sales.mutation(api.procurement.purchaseReturns.create, {
        goodsReceiptId: receiptId,
        reason: "Damaged",
        lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
      }),
    ).rejects.toThrow(/permission to create inventory/);
    await expect(
      accountant.mutation(api.procurement.purchaseReturns.create, {
        goodsReceiptId: receiptId,
        reason: "Damaged",
        lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
      }),
    ).rejects.toThrow(/permission to create inventory/);
    await expect(
      warehouse.mutation(api.procurement.purchaseReturns.create, {
        goodsReceiptId: receiptId,
        reason: "  ",
        lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      warehouse.mutation(api.procurement.purchaseReturns.create, {
        goodsReceiptId: receiptId,
        reason: "Damaged",
        lines: [
          { goodsReceiptLineId: lineId, qty: 1 },
          { goodsReceiptLineId: lineId, qty: 1 },
        ],
      }),
    ).rejects.toThrow(/already on this return/);
    await expect(
      warehouse.mutation(api.procurement.purchaseReturns.create, {
        goodsReceiptId: receiptId,
        reason: "Damaged",
        lines: [{ goodsReceiptLineId: otherLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/not on this receipt/);

    const returnId = await warehouse.mutation(api.procurement.purchaseReturns.create, {
      goodsReceiptId: receiptId,
      reason: "  Damaged seal  ",
      lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
    });
    const detail = await sales.query(api.procurement.purchaseReturns.get, {
      purchaseReturnId: returnId,
    });
    expect(detail).toMatchObject({
      docNumber: "DBN-0001",
      goodsReceiptId: receiptId,
      receiptNumber: "GRN-0001",
      vendorName: "Parts Co",
      reason: "Damaged seal",
      amount: 6,
      lines: [{ goodsReceiptLineId: lineId, sku: "GEL", qty: 1, unitCost: 6 }],
    });
    expect(
      await warehouse.query(api.inventory.stock.balance, { productId, warehouseId }),
    ).toMatchObject({ onHand: 2, available: 2, unitCost: 6, value: 12 });
    const movements = await warehouse.query(api.inventory.stock.list, { productId, warehouseId });
    expect(movements.filter((row) => row.type === "issue")).toMatchObject([
      {
        qty: -1,
        unitCost: 6,
        referenceType: "purchaseReturn",
        referenceId: returnId,
      },
    ]);
    const intents = await t.run((ctx) => ctx.db.query("journalIntents").collect());
    expect(intents.map((row) => [row.type, row.sourceId, row.currency, row.amount])).toEqual([
      ["goodsReceipt", receiptId, "GBP", 12],
      ["goodsReceipt", otherId, "USD", 6],
      ["debitNote", returnId, "GBP", 6],
    ]);
    expect(intents[2]).toMatchObject({
      sourceType: "purchaseReturn",
      status: "pending",
      lines: [{ description: "GEL", qty: 1, unitCost: 6, amount: 6 }],
    });
    expect(intents[2]?.period).toMatch(/^\d{4}-\d{2}$/);
    expect(await warehouse.query(api.procurement.vendors.statement, { vendorId })).toMatchObject({
      received: 12,
      receiptCount: 1,
    });
    const progress = await sales.query(api.procurement.purchaseReturns.forReceipt, {
      goodsReceiptId: receiptId,
    });
    expect(progress.returns.map((row) => row.docNumber)).toEqual(["DBN-0001"]);
    expect(progress.lines.find((row) => row.goodsReceiptLineId === lineId)).toMatchObject({
      receivedQty: 2,
      returnedQty: 1,
      returnableQty: 1,
    });

    await warehouse.mutation(api.inventory.stock.reserve, {
      productId,
      warehouseId,
      qty: 2,
      referenceType: "salesOrder",
      referenceId: "held",
    });
    await expect(
      warehouse.mutation(api.procurement.purchaseReturns.create, {
        goodsReceiptId: receiptId,
        reason: "Damaged",
        lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
      }),
    ).rejects.toThrow(/reserved/);
    await warehouse.mutation(api.inventory.stock.release, {
      productId,
      warehouseId,
      qty: 2,
      referenceType: "salesOrder",
      referenceId: "held",
    });

    const secondId = await warehouse.mutation(api.procurement.purchaseReturns.create, {
      goodsReceiptId: receiptId,
      reason: "The rest",
      lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
    });
    const second = await sales.query(api.procurement.purchaseReturns.get, {
      purchaseReturnId: secondId,
    });
    expect(second?.docNumber).toBe("DBN-0002");
    const afterSecond = await t.run((ctx) => ctx.db.query("journalIntents").collect());
    expect(afterSecond.filter((row) => row.type === "debitNote").map((row) => row.amount)).toEqual([
      6, 6,
    ]);
    expect(
      await warehouse.query(api.inventory.stock.balance, { productId, warehouseId }),
    ).toMatchObject({ onHand: 1, available: 1, value: 6 });
    await expect(
      warehouse.mutation(api.procurement.purchaseReturns.create, {
        goodsReceiptId: receiptId,
        reason: "Again",
        lines: [{ goodsReceiptLineId: lineId, qty: 1 }],
      }),
    ).rejects.toThrow(/left to return/);
  });
});
