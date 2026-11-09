import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { purchaseReceiptLineError } from "../lib/purchaseReceipts";
import { movingAverageCost } from "../lib/stock";
import { setup } from "./setup";

/**
 * PH2-22 — a receipt against a sent purchase order. Accepted quantity
 * enters stock at the agreed price and stores a moving average.
 * Rejected quantity does not. The order follows the accepted total.
 */

type T = ReturnType<typeof setup>;

const NEED_BY = Date.parse("2026-11-16T00:00:00.000Z");

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

describe("purchase receipt rules", () => {
  test("accepted quantity is capped by what is still open", () => {
    expect(
      purchaseReceiptLineError({ ordered: 4, alreadyAccepted: 1, accepted: 2, rejected: 1 }),
    ).toBeNull();
    expect(
      purchaseReceiptLineError({ ordered: 4, alreadyAccepted: 0, accepted: 0, rejected: 0 }),
    ).toMatch(/accepted or a rejected/);
    expect(
      purchaseReceiptLineError({ ordered: 4, alreadyAccepted: 0, accepted: -1, rejected: 0 }),
    ).toMatch(/can't be negative/);
    expect(
      purchaseReceiptLineError({ ordered: 4, alreadyAccepted: 2, accepted: 3, rejected: 0 }),
    ).toMatch(/can't exceed what's still on the order/);
    expect(
      purchaseReceiptLineError({ ordered: 4, alreadyAccepted: 2, accepted: 1, rejected: 2 }),
    ).toMatch(/can't exceed what's still on the order/);
  });

  test("the moving average keeps stock already on hand and takes the receipt cost when the bin is empty", () => {
    expect(movingAverageCost({ onHand: 0, average: undefined, qty: 1, unitCost: 10 })).toBe(10);
    expect(movingAverageCost({ onHand: 2, average: 12.5, qty: 1, unitCost: 320 })).toBe(115);
    expect(movingAverageCost({ onHand: 2, average: 12.5, qty: 1, unitCost: 10 })).toBe(11.67);
  });
});

describe("purchase receipts", () => {
  test("a partial receipt posts accepted stock and a later receipt finishes the order", async () => {
    const t = setup();
    const warehouseUser = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    const owner = await asRole(t, "owner");
    const sales = await asRole(t, "sales");
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Rotor",
        slug: "rotor",
        sku: "ROTOR",
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
    const vendorId = await t.run(async (ctx) => {
      await ctx.db.insert("currencies", {
        code: "GBP",
        name: "Pound",
        decimalPlaces: 2,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("vendors", {
        code: "PARTS",
        name: "Parts Co",
        active: true,
        paymentTermsDays: 30,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await t.run((ctx) =>
      ctx.db.insert("productVendors", {
        productId,
        vendorId,
        preferred: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    const openingId = await warehouseUser.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      referenceNote: "Opening",
      lines: [{ productId, qty: 2, unitCost: 12.5 }],
    });

    const requisitionId = await warehouseUser.mutation(api.procurement.requisitions.create, {
      needBy: NEED_BY,
      lines: [{ productId, qty: 4, unitPrice: 10 }],
    });
    await owner.mutation(api.procurement.requisitions.approve, { requisitionId });
    const purchaseOrderId = await owner.mutation(api.procurement.requisitions.convert, {
      requisitionId,
      vendorId,
    });
    const draft = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    const lineId = draft?.lines[0]?._id;
    if (lineId === undefined) throw new Error("missing line");

    await expect(
      warehouseUser.mutation(api.procurement.purchaseReceipts.receive, {
        purchaseOrderId,
        warehouseId,
        lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 1, qtyRejected: 0 }],
      }),
    ).rejects.toThrow(/Send the purchase order before receiving it/);

    await owner.mutation(api.procurement.purchaseOrders.send, { purchaseOrderId });

    await expect(
      sales.mutation(api.procurement.purchaseReceipts.receive, {
        purchaseOrderId,
        warehouseId,
        lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 1, qtyRejected: 0 }],
      }),
    ).rejects.toThrow(/permission to create inventory/);
    await expect(
      accountant.mutation(api.procurement.purchaseReceipts.receive, {
        purchaseOrderId,
        warehouseId,
        lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 1, qtyRejected: 0 }],
      }),
    ).rejects.toThrow(/permission to create inventory/);

    const rejectedId = await warehouseUser.mutation(api.procurement.purchaseReceipts.receive, {
      purchaseOrderId,
      warehouseId,
      lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 0, qtyRejected: 1 }],
    });
    const rejected = await sales.query(api.inventory.goodsReceipts.get, { receiptId: rejectedId });
    expect(rejected.purchaseOrderNumber).toBe("PO-0001");
    expect(rejected.lines[0]).toMatchObject({
      qty: 0,
      qtyAccepted: 0,
      qtyRejected: 1,
      movementId: null,
      averageCost: null,
    });
    const stillSent = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(stillSent?.status).toBe("sent");
    expect(stillSent?.lines[0]?.acceptedQty).toBe(0);
    expect(stillSent?.lines[0]?.rejectedQty).toBe(1);
    expect(
      await warehouseUser.query(api.inventory.stock.balance, { productId, warehouseId }),
    ).toMatchObject({ onHand: 2, unitCost: 12.5, value: 25 });
    expect(await t.run((ctx) => ctx.db.query("journalIntents").collect())).toMatchObject([
      {
        type: "goodsReceipt",
        sourceId: openingId,
        currency: "USD",
        amount: 25,
      },
    ]);

    const partialId = await warehouseUser.mutation(api.procurement.purchaseReceipts.receive, {
      purchaseOrderId,
      warehouseId,
      lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 1, qtyRejected: 0 }],
    });
    const partial = await sales.query(api.inventory.goodsReceipts.get, { receiptId: partialId });
    expect(partial.lines[0]).toMatchObject({
      qty: 1,
      qtyAccepted: 1,
      unitCost: 10,
      averageCost: 11.67,
    });
    const movements = await warehouseUser.query(api.inventory.stock.list, {
      productId,
      warehouseId,
    });
    const posted = movements.find((row) => row.referenceId === partialId);
    expect(posted).toMatchObject({ type: "receipt", qty: 1, unitCost: 10 });
    const intents = await t.run((ctx) => ctx.db.query("journalIntents").collect());
    expect(intents.map((row) => [row.type, row.sourceId, row.currency, row.amount])).toEqual([
      ["goodsReceipt", openingId, "USD", 25],
      ["goodsReceipt", partialId, "GBP", 10],
    ]);
    expect(
      await warehouseUser.query(api.inventory.stock.balance, { productId, warehouseId }),
    ).toMatchObject({ onHand: 3, unitCost: 10, value: 30 });
    const midway = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(midway?.status).toBe("partiallyReceived");
    expect(midway?.lines[0]?.acceptedQty).toBe(1);
    expect(midway?.receipts.map((row) => row._id)).toEqual([rejectedId, partialId]);

    const link = await t.run((ctx) =>
      ctx.db
        .query("productVendors")
        .withIndex("by_product_vendor", (q) =>
          q.eq("productId", productId).eq("vendorId", vendorId),
        )
        .unique(),
    );
    expect(link?.lastPurchasePrice).toBe(10);

    await expect(
      warehouseUser.mutation(api.procurement.purchaseReceipts.receive, {
        purchaseOrderId,
        warehouseId,
        lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 4, qtyRejected: 0 }],
      }),
    ).rejects.toThrow(/can't exceed what's still on the order/);

    await warehouseUser.mutation(api.procurement.purchaseReceipts.receive, {
      purchaseOrderId,
      warehouseId,
      lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 3, qtyRejected: 0 }],
    });
    const done = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(done?.status).toBe("received");
    expect(done?.lines[0]?.acceptedQty).toBe(4);
    expect(
      await warehouseUser.query(api.inventory.stock.balance, { productId, warehouseId }),
    ).toMatchObject({ onHand: 6, unitCost: 10, value: 60 });

    await expect(
      warehouseUser.mutation(api.procurement.purchaseReceipts.receive, {
        purchaseOrderId,
        warehouseId,
        lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 1, qtyRejected: 0 }],
      }),
    ).rejects.toThrow(/already received/);

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const entry = audits.find((audit) => audit.entityId === partialId);
    expect(entry).toMatchObject({
      entity: "goodsReceipts",
      action: "receive",
      after: { purchaseOrderStatus: "partiallyReceived" },
    });
  });
});
