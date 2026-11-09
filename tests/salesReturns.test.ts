import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  cancelReturnError,
  creditReturnError,
  returnableQty,
  returnInvoiceStatusError,
  returnOrderStatusError,
  returnQtyError,
  returnReasonError,
} from "../lib/salesReturns";
import { onHandDelta, reservedDelta, type StockMovementType } from "../lib/stock";
import { setup } from "./setup";

/**
 * PH2-18 — a return is requested, received, then credited or exchanged.
 * Restock puts the goods back. Quarantine holds them. A write-off
 * takes them back off. The credit note is the journal intent.
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

async function asRole(t: T, roleKey: string, email = `${roleKey}@example.com`) {
  const userId = await seedUser(t, email);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

async function ledgerAt(t: T, productId: Id<"products">, warehouseId: Id<"warehouses">) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("stockMovements")
      .withIndex("by_product_warehouse", (q) =>
        q.eq("productId", productId).eq("warehouseId", warehouseId),
      )
      .collect(),
  );
  let onHand = 0;
  let reserved = 0;
  for (const row of rows) {
    onHand += onHandDelta(row.type as StockMovementType, row.qty);
    reserved += reservedDelta(row.type as StockMovementType, row.qty);
  }
  return { onHand, reserved, available: onHand - reserved, rows };
}

describe("sales return rules", () => {
  test("what can be requested, received, credited, or cancelled", () => {
    expect(returnableQty(2, 1)).toBe(1);
    expect(returnableQty(1, 1)).toBe(0);
    expect(returnQtyError(3, 2)).toMatch(/Only 2/);
    expect(returnQtyError(1, 0)).toMatch(/Nothing is left/);
    expect(returnReasonError("  ")).toMatch(/Enter a reason/);
    expect(returnInvoiceStatusError("draft")).toMatch(/can't be returned/);
    expect(returnInvoiceStatusError("posted")).toBeNull();
    expect(returnOrderStatusError("confirmed")).toMatch(/nothing to take back/);
    expect(returnOrderStatusError("fulfilling")).toBeNull();
    expect(returnOrderStatusError("invoiced")).toBeNull();
    expect(creditReturnError("requested", true)).toMatch(/can't be credited/);
    expect(creditReturnError("received", false)).toMatch(/no invoice/);
    expect(creditReturnError("received", true)).toBeNull();
    expect(cancelReturnError("received")).toMatch(/can't be cancelled/);
    expect(cancelReturnError("requested")).toBeNull();
  });
});

describe("sales return", () => {
  test("receive decides the stock, then the return is credited or exchanged", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse", "warehouse-return@example.com");
    const world = await t.run(async (ctx) => {
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
      const main = await ctx.db.insert("warehouses", {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const quoteId = await ctx.db.insert("quotes", {
        docNumber: "QT-RMA",
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
        qty: 3,
        resolvedUnitPrice: 10,
        discountPercent: 0,
        unitPrice: 10,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 30,
        tax: 0,
        gross: 30,
        sort: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const salesOrderId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-RMA",
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
      const lineId = await ctx.db.insert("salesOrderLines", {
        salesOrderId,
        quoteLineId,
        productId,
        description: "Bench",
        sku: "BENCH",
        qty: 3,
        unitPrice: 10,
        discountPercent: 0,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 30,
        tax: 0,
        gross: 30,
        sort: 0,
        createdAt: 1,
      });
      return { customerId, productId, main, salesOrderId, lineId };
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Opening",
      lines: [{ productId: world.productId, qty: 3, unitCost: 4 }],
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: world.salesOrderId,
      warehouseId: world.main,
    });
    await warehouse.mutation(api.sales.orders.fulfill, {
      salesOrderId: world.salesOrderId,
      lineId: world.lineId,
      qty: 3,
    });

    const requested = await sales.mutation(api.sales.salesReturns.createFromOrder, {
      salesOrderId: world.salesOrderId,
      reason: "Changed mind",
      lines: [{ salesOrderLineId: world.lineId, qty: 1 }],
    });
    await expect(
      sales.mutation(api.sales.salesReturns.credit, {
        salesReturnId: requested,
        creditOn: "2026-11-09",
      }),
    ).rejects.toThrow(/can't be credited/);
    await sales.mutation(api.sales.salesReturns.cancel, { salesReturnId: requested });

    const invoiceId = await sales.mutation(api.sales.invoices.createFromOrder, {
      salesOrderId: world.salesOrderId,
      invoiceOn: "2026-11-09",
    });
    const invoiceLineId = (await sales.query(api.sales.invoices.get, { invoiceId }))?.lines[0]?._id;
    if (invoiceLineId === undefined) throw new Error("missing invoice line");
    await expect(
      sales.mutation(api.sales.salesReturns.createFromInvoice, {
        invoiceId,
        reason: "Damaged",
        lines: [{ invoiceLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/can't be returned/);
    await sales.mutation(api.sales.invoices.post, { invoiceId });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({ onHand: 0 });

    await expect(
      warehouse.mutation(api.sales.salesReturns.createFromInvoice, {
        invoiceId,
        reason: "Damaged",
        lines: [{ invoiceLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/permission to create sales/);

    const restockId = await sales.mutation(api.sales.salesReturns.createFromInvoice, {
      invoiceId,
      reason: "  Damaged  ",
      lines: [{ invoiceLineId, qty: 1 }],
    });
    const restock = await sales.query(api.sales.salesReturns.get, { salesReturnId: restockId });
    const restockLineId = restock?.lines[0]?._id;
    if (restockLineId === undefined) throw new Error("missing return line");
    expect(restock?.salesReturn).toMatchObject({
      docNumber: "RMA-0002",
      status: "requested",
      reason: "Damaged",
    });
    await sales.mutation(api.sales.salesReturns.receive, {
      salesReturnId: restockId,
      lines: [{ salesReturnLineId: restockLineId, disposition: "restock" }],
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 1,
      reserved: 0,
    });
    await sales.mutation(api.sales.salesReturns.credit, {
      salesReturnId: restockId,
      creditOn: "2026-11-09",
    });
    const credited = await sales.query(api.sales.salesReturns.get, { salesReturnId: restockId });
    expect(credited?.salesReturn).toMatchObject({ status: "credited", creditNumber: "CR-0001" });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({ onHand: 1 });
    expect(
      await sales.query(api.sales.customers.statement, { customerId: world.customerId }),
    ).toMatchObject({ invoiced: 30, credited: 10, balance: 20 });

    const writeOffId = await sales.mutation(api.sales.salesReturns.createFromInvoice, {
      invoiceId,
      reason: "Broken",
      lines: [{ invoiceLineId, qty: 1 }],
    });
    const writeOff = await sales.query(api.sales.salesReturns.get, { salesReturnId: writeOffId });
    const writeOffLineId = writeOff?.lines[0]?._id;
    if (writeOffLineId === undefined) throw new Error("missing write-off line");
    await sales.mutation(api.sales.salesReturns.receive, {
      salesReturnId: writeOffId,
      lines: [{ salesReturnLineId: writeOffLineId, disposition: "writeOff" }],
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({ onHand: 1 });
    await expect(
      sales.mutation(api.sales.salesReturns.cancel, { salesReturnId: writeOffId }),
    ).rejects.toThrow(/can't be cancelled/);
    await sales.mutation(api.sales.salesReturns.credit, {
      salesReturnId: writeOffId,
      creditOn: "2026-11-09",
    });

    const quarantineId = await sales.mutation(api.sales.salesReturns.createFromInvoice, {
      invoiceId,
      reason: "Check it",
      lines: [{ invoiceLineId, qty: 1 }],
    });
    const quarantine = await sales.query(api.sales.salesReturns.get, {
      salesReturnId: quarantineId,
    });
    const quarantineLineId = quarantine?.lines[0]?._id;
    if (quarantineLineId === undefined) throw new Error("missing quarantine line");
    await sales.mutation(api.sales.salesReturns.receive, {
      salesReturnId: quarantineId,
      lines: [{ salesReturnLineId: quarantineLineId, disposition: "quarantine" }],
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 2,
      reserved: 1,
      available: 1,
    });
    await sales.mutation(api.sales.salesReturns.exchange, { salesReturnId: quarantineId });
    const exchanged = await sales.query(api.sales.salesReturns.get, {
      salesReturnId: quarantineId,
    });
    expect(exchanged?.salesReturn).toMatchObject({
      status: "exchanged",
      exchangeNumber: "SO-0001",
    });
    const exchangeId = exchanged?.salesReturn.exchangeOrderId;
    if (exchangeId === null || exchangeId === undefined) throw new Error("missing exchange");
    expect(await sales.query(api.sales.orders.get, { salesOrderId: exchangeId })).toMatchObject({
      order: { status: "draft", notes: "Exchange for RMA-0004" },
      lines: [{ qty: 1, unitPrice: 10, reservedQty: 0 }],
    });
    expect(
      await sales.query(api.sales.customers.statement, { customerId: world.customerId }),
    ).toMatchObject({ invoiced: 30, credited: 20, balance: 10 });
    await expect(
      sales.mutation(api.sales.salesReturns.createFromInvoice, {
        invoiceId,
        reason: "Again",
        lines: [{ invoiceLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/Nothing is left/);

    const ledger = await ledgerAt(t, world.productId, world.main);
    const forReturn = (id: Id<"salesReturns">) =>
      ledger.rows.filter((row) => row.referenceType === "salesReturn" && row.referenceId === id);
    expect(forReturn(restockId).map((row) => row.type)).toEqual(["receipt"]);
    expect(forReturn(writeOffId).map((row) => [row.type, row.qty, row.reason])).toEqual([
      ["receipt", 1, undefined],
      ["adjustment", -1, "writeOff"],
    ]);
    expect(forReturn(quarantineId).map((row) => [row.type, row.qty])).toEqual([
      ["receipt", 1],
      ["reservation", 1],
    ]);
  });
});
