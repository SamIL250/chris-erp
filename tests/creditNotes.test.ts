import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  creditInvoiceStatusError,
  creditQtyError,
  creditReasonError,
  restockError,
  uncreditedQty,
  voidCreditError,
} from "../lib/creditNotes";
import { onHandDelta, reservedDelta, type StockMovementType } from "../lib/stock";
import { setup } from "./setup";

/**
 * PH2-17 — a credit note reduces a posted invoice. A return can put
 * the goods back. An adjustment cannot. Posting writes a credit-note
 * intent.
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
  return { onHand, reserved, available: onHand - reserved };
}

describe("credit note rules", () => {
  test("what can be credited, and an adjustment does not restock", () => {
    expect(uncreditedQty(2, 1)).toBe(1);
    expect(uncreditedQty(1, 1)).toBe(0);
    expect(creditQtyError(3, 2)).toMatch(/Only 2/);
    expect(creditQtyError(1, 0)).toMatch(/Nothing is left/);
    expect(creditInvoiceStatusError("draft")).toMatch(/can't be credited/);
    expect(creditInvoiceStatusError("posted")).toBeNull();
    expect(creditInvoiceStatusError("paid")).toBeNull();
    expect(restockError("adjustment", true)).toMatch(/does not put goods back/);
    expect(restockError("return", true)).toBeNull();
    expect(creditReasonError("  ")).toMatch(/Enter a reason/);
    expect(voidCreditError("posted")).toMatch(/can't be voided/);
  });
});

describe("credit notes (PH2-17)", () => {
  test("an adjustment leaves stock, and a return can put it back", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse", "warehouse-credit@example.com");
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
        docNumber: "QT-CR",
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
        qty: 2,
        resolvedUnitPrice: 10,
        discountPercent: 0,
        unitPrice: 10,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 20,
        tax: 0,
        gross: 20,
        sort: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const salesOrderId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-CR",
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
        qty: 2,
        unitPrice: 10,
        discountPercent: 0,
        taxCategory: "zero",
        rateBps: 0,
        inclusive: false,
        net: 20,
        tax: 0,
        gross: 20,
        sort: 0,
        createdAt: 1,
      });
      return { customerId, productId, main, salesOrderId, lineId };
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Opening",
      lines: [{ productId: world.productId, qty: 2, unitCost: 4 }],
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: world.salesOrderId,
      warehouseId: world.main,
    });
    await warehouse.mutation(api.sales.orders.fulfill, {
      salesOrderId: world.salesOrderId,
      lineId: world.lineId,
      qty: 2,
    });
    const invoiceId = await sales.mutation(api.sales.invoices.createFromOrder, {
      salesOrderId: world.salesOrderId,
      invoiceOn: "2026-11-09",
    });
    const invoiceLineId = (await sales.query(api.sales.invoices.get, { invoiceId }))?.lines[0]?._id;
    if (invoiceLineId === undefined) throw new Error("missing invoice line");
    await expect(
      sales.mutation(api.sales.creditNotes.create, {
        invoiceId,
        creditOn: "2026-11-09",
        kind: "adjustment",
        restock: false,
        reason: "Price",
        lines: [{ invoiceLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/can't be credited/);
    await sales.mutation(api.sales.invoices.post, { invoiceId });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({ onHand: 0 });

    await expect(
      warehouse.mutation(api.sales.creditNotes.create, {
        invoiceId,
        creditOn: "2026-11-09",
        kind: "adjustment",
        restock: false,
        reason: "Price",
        lines: [{ invoiceLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/permission to create sales/);
    await expect(
      sales.mutation(api.sales.creditNotes.create, {
        invoiceId,
        creditOn: "2026-11-09",
        kind: "adjustment",
        restock: true,
        reason: "Price",
        lines: [{ invoiceLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/does not put goods back/);

    const adjustmentId = await sales.mutation(api.sales.creditNotes.create, {
      invoiceId,
      creditOn: "2026-11-09",
      kind: "adjustment",
      restock: false,
      reason: "  Price correction  ",
      lines: [{ invoiceLineId, qty: 1 }],
    });
    expect(
      await sales.query(api.sales.creditNotes.get, { creditNoteId: adjustmentId }),
    ).toMatchObject({
      credit: {
        docNumber: "CR-0001",
        status: "draft",
        kind: "adjustment",
        restock: false,
        reason: "Price correction",
      },
      lines: [{ qty: 1, gross: 10 }],
      intent: null,
    });
    await sales.mutation(api.sales.creditNotes.post, { creditNoteId: adjustmentId });
    expect(
      await sales.query(api.sales.creditNotes.get, { creditNoteId: adjustmentId }),
    ).toMatchObject({
      credit: { status: "posted", warehouseCode: null },
      intent: { type: "creditNote", amount: 10, period: "2026-11", status: "pending" },
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({ onHand: 0 });
    expect(
      await sales.query(api.sales.customers.statement, { customerId: world.customerId }),
    ).toMatchObject({ invoiced: 20, credited: 10, balance: 10 });
    await expect(
      sales.mutation(api.sales.creditNotes.voidCredit, { creditNoteId: adjustmentId }),
    ).rejects.toThrow(/can't be voided/);

    const draftReturn = await sales.mutation(api.sales.creditNotes.create, {
      invoiceId,
      creditOn: "2026-11-09",
      kind: "return",
      restock: true,
      reason: "Changed mind",
      lines: [{ invoiceLineId, qty: 1 }],
    });
    await sales.mutation(api.sales.creditNotes.voidCredit, { creditNoteId: draftReturn });
    const returnId = await sales.mutation(api.sales.creditNotes.create, {
      invoiceId,
      creditOn: "2026-11-09",
      kind: "return",
      restock: true,
      reason: "Changed mind",
      lines: [{ invoiceLineId, qty: 1 }],
    });
    await sales.mutation(api.sales.creditNotes.post, { creditNoteId: returnId });
    expect(await sales.query(api.sales.creditNotes.get, { creditNoteId: returnId })).toMatchObject({
      credit: {
        docNumber: "CR-0003",
        status: "posted",
        kind: "return",
        restock: true,
        warehouseCode: "MAIN",
      },
      lines: [{ qty: 1, movementId: expect.any(String) }],
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 1,
      reserved: 0,
    });
    const receipt = await t.run((ctx) =>
      ctx.db
        .query("stockMovements")
        .withIndex("by_reference", (q) =>
          q.eq("referenceType", "creditNote").eq("referenceId", returnId),
        )
        .unique(),
    );
    expect(receipt).toMatchObject({ type: "receipt", qty: 1, unitCost: 4 });
    expect(
      await sales.query(api.sales.customers.statement, { customerId: world.customerId }),
    ).toMatchObject({ invoiced: 20, credited: 20, balance: 0 });
    await expect(
      sales.mutation(api.sales.creditNotes.create, {
        invoiceId,
        creditOn: "2026-11-09",
        kind: "return",
        restock: false,
        reason: "Again",
        lines: [{ invoiceLineId, qty: 1 }],
      }),
    ).rejects.toThrow(/Nothing is left/);
  });
});
