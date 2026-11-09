import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  deskTileLabel,
  isDraftInvoice,
  isOpenOrder,
  isReturnPending,
  isToShip,
  toBillQty,
  toPickQty,
} from "../lib/orderDesk";
import { setup } from "./setup";

/**
 * PH2-19 — the order desk counts five queues from the documents
 * that already exist.
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

describe("order desk rules", () => {
  test("open, pick, ship, bill, and a pending return", () => {
    expect(deskTileLabel("open")).toBe("Open orders");
    expect(isOpenOrder("draft")).toBe(true);
    expect(isOpenOrder("invoiced")).toBe(true);
    expect(isOpenOrder("closed")).toBe(false);
    expect(isOpenOrder("cancelled")).toBe(false);
    expect(toPickQty(2, 1)).toBe(1);
    expect(toPickQty(1, 1)).toBe(0);
    expect(isToShip("packed")).toBe(true);
    expect(isToShip("shipped")).toBe(false);
    expect(toBillQty("fulfilling", 2, 1)).toBe(1);
    expect(toBillQty("invoiced", 1, 0)).toBe(0);
    expect(toBillQty("draft", 0, 0)).toBe(0);
    expect(isDraftInvoice("draft")).toBe(true);
    expect(isDraftInvoice("posted")).toBe(false);
    expect(isReturnPending("requested")).toBe(true);
    expect(isReturnPending("received")).toBe(true);
    expect(isReturnPending("exchanged")).toBe(false);
    expect(isReturnPending("cancelled")).toBe(false);
  });
});

describe("order desk", () => {
  test("each queue lists only the documents that still need that step", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const stranger = t.withIdentity({ subject: "nobody|session-1" });
    await expect(stranger.query(api.sales.desk.get, {})).rejects.toThrow(
      /permission to view sales/,
    );

    await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        code: "ACME",
        name: "Acme",
        status: "active" as const,
        paymentTermsDays: 0,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      });
      const productId = await ctx.db.insert("products", {
        name: "Bench",
        slug: "bench",
        sku: "BENCH",
        status: "active" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      });
      const warehouseId = await ctx.db.insert("warehouses", {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const quoteId = await ctx.db.insert("quotes", {
        docNumber: "QT-DESK",
        customerId,
        status: "accepted",
        currency: "GBP",
        decimalPlaces: 2,
        quoteDate: 1,
        validUntil: 2,
        paymentTermsDays: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const quoteLineId = await ctx.db.insert("quoteLines", {
        quoteId,
        productId,
        description: "Bench",
        sku: "BENCH",
        qty: 1,
        resolvedUnitPrice: 10,
        discountPercent: 0,
        unitPrice: 10,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 10,
        tax: 0,
        gross: 10,
        sort: 0,
        createdAt: 1,
        updatedAt: 1,
      });

      const draftId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-DRAFT",
        customerId,
        quoteId,
        status: "draft",
        channel: "manual",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("salesOrderLines", {
        salesOrderId: draftId,
        quoteLineId,
        productId,
        description: "Bench",
        sku: "BENCH",
        qty: 1,
        unitPrice: 10,
        discountPercent: 0,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 10,
        tax: 0,
        gross: 10,
        reservedQty: 0,
        fulfilledQty: 0,
        sort: 0,
        createdAt: 1,
      });

      const pickId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-PICK",
        customerId,
        quoteId,
        status: "confirmed",
        channel: "manual",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        warehouseId,
        createdAt: 2,
        updatedAt: 2,
      });
      const pickLineId = await ctx.db.insert("salesOrderLines", {
        salesOrderId: pickId,
        quoteLineId,
        productId,
        description: "Bench",
        sku: "BENCH",
        qty: 2,
        unitPrice: 10,
        discountPercent: 0,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 20,
        tax: 0,
        gross: 20,
        reservedQty: 2,
        fulfilledQty: 0,
        sort: 0,
        createdAt: 2,
      });
      const packedId = await ctx.db.insert("deliveries", {
        docNumber: "DN-PACK",
        salesOrderId: pickId,
        warehouseId,
        status: "packed",
        createdAt: 3,
        updatedAt: 3,
      });
      await ctx.db.insert("deliveryLines", {
        deliveryId: packedId,
        salesOrderLineId: pickLineId,
        productId,
        description: "Bench",
        sku: "BENCH",
        qty: 1,
        sort: 0,
      });

      const billId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-BILL",
        customerId,
        quoteId,
        status: "fulfilling",
        channel: "manual",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        warehouseId,
        createdAt: 4,
        updatedAt: 4,
      });
      const billLineId = await ctx.db.insert("salesOrderLines", {
        salesOrderId: billId,
        quoteLineId,
        productId,
        description: "Bench",
        sku: "BENCH",
        qty: 2,
        unitPrice: 10,
        discountPercent: 0,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 20,
        tax: 0,
        gross: 20,
        reservedQty: 0,
        fulfilledQty: 2,
        sort: 0,
        createdAt: 4,
      });
      const invoiceId = await ctx.db.insert("salesInvoices", {
        docNumber: "INV-DRAFT",
        customerId,
        salesOrderId: billId,
        status: "draft",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        invoiceDate: 5,
        dueDate: 5,
        createdAt: 5,
        updatedAt: 5,
      });
      await ctx.db.insert("salesInvoiceLines", {
        invoiceId,
        salesOrderLineId: billLineId,
        productId,
        description: "Bench",
        sku: "BENCH",
        qty: 1,
        unitPrice: 10,
        discountPercent: 0,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 10,
        tax: 0,
        gross: 10,
        sort: 0,
        createdAt: 5,
      });

      await ctx.db.insert("salesOrders", {
        docNumber: "SO-DONE",
        customerId,
        quoteId,
        status: "closed",
        channel: "manual",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        createdAt: 6,
        updatedAt: 6,
      });

      const returnOrderId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-RMA",
        customerId,
        quoteId,
        status: "invoiced",
        channel: "manual",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        createdAt: 7,
        updatedAt: 7,
      });
      await ctx.db.insert("salesReturns", {
        docNumber: "RMA-WAIT",
        customerId,
        salesOrderId: returnOrderId,
        status: "requested",
        reason: "Damaged",
        currency: "GBP",
        decimalPlaces: 2,
        createdAt: 8,
        updatedAt: 8,
      });
      await ctx.db.insert("salesReturns", {
        docNumber: "RMA-DONE",
        customerId,
        salesOrderId: returnOrderId,
        status: "exchanged",
        reason: "Swap",
        currency: "GBP",
        decimalPlaces: 2,
        createdAt: 9,
        updatedAt: 9,
      });
    });

    const desk = await sales.query(api.sales.desk.get, {});
    expect(desk.open.rows.map((row) => row.number)).toEqual([
      "SO-BILL",
      "SO-DRAFT",
      "SO-PICK",
      "SO-RMA",
    ]);
    expect(desk.pick).toMatchObject({
      count: 1,
      units: 1,
      rows: [{ number: "SO-PICK", detail: "1 to pick" }],
    });
    expect(desk.ship.rows.map((row) => row.number)).toEqual(["DN-PACK"]);
    expect(desk.bill).toMatchObject({ count: 2, units: 2 });
    expect(desk.bill.rows.map((row) => row.number).sort()).toEqual(["INV-DRAFT", "SO-BILL"]);
    expect(desk.returns.rows.map((row) => row.number)).toEqual(["RMA-WAIT"]);
    expect(desk.open.rows.map((row) => row.number)).not.toContain("SO-DONE");
  });
});
