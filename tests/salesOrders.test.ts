import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  isBackordered,
  orderChannelLabel,
  orderStatusError,
  readyToInvoice,
  reserveTake,
  shipmentQtyError,
} from "../lib/salesOrders";
import { onHandDelta, reservedDelta, type StockMovementType } from "../lib/stock";
import { setup } from "./setup";

/**
 * PH2-12 — confirm reserves free stock, a short line is backorder,
 * a shipment can be part of the line, and cancel gives back the hold.
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

async function draftOrder(
  t: T,
  args: {
    customerId: Id<"customers">;
    productId: Id<"products">;
    qty: number;
    lines?: { productId: Id<"products">; qty: number }[];
    docNumber?: string;
  },
) {
  return await t.run(async (ctx) => {
    const quoteId = await ctx.db.insert("quotes", {
      docNumber: `QT-${args.docNumber ?? "1"}`,
      customerId: args.customerId,
      status: "accepted",
      currency: "GBP",
      decimalPlaces: 2,
      quoteDate: 1,
      validUntil: 2,
      paymentTermsDays: 14,
      createdAt: 1,
      updatedAt: 1,
    });
    const specs = args.lines ?? [{ productId: args.productId, qty: args.qty }];
    const quoteLineIds: Id<"quoteLines">[] = [];
    for (const [index, spec] of specs.entries()) {
      quoteLineIds.push(
        await ctx.db.insert("quoteLines", {
          quoteId,
          productId: spec.productId,
          description: "Bench",
          sku: "BENCH",
          qty: spec.qty,
          resolvedUnitPrice: 10,
          discountPercent: 0,
          unitPrice: 10,
          taxCategory: "zero",
          rateBps: 0,
          inclusive: false,
          net: spec.qty * 10,
          tax: 0,
          gross: spec.qty * 10,
          sort: index,
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    }
    const salesOrderId = await ctx.db.insert("salesOrders", {
      docNumber: args.docNumber ?? "SO-1",
      customerId: args.customerId,
      quoteId,
      status: "draft",
      channel: "manual",
      currency: "GBP",
      decimalPlaces: 2,
      paymentTermsDays: 14,
      createdAt: 1,
      updatedAt: 1,
    });
    const lineIds: Id<"salesOrderLines">[] = [];
    for (const [index, spec] of specs.entries()) {
      const quoteLineId = quoteLineIds[index];
      if (quoteLineId === undefined) throw new Error("missing quote line");
      lineIds.push(
        await ctx.db.insert("salesOrderLines", {
          salesOrderId,
          quoteLineId,
          productId: spec.productId,
          description: "Bench",
          sku: "BENCH",
          qty: spec.qty,
          unitPrice: 10,
          discountPercent: 0,
          taxCategory: "zero",
          rateBps: 0,
          inclusive: false,
          net: spec.qty * 10,
          tax: 0,
          gross: spec.qty * 10,
          sort: index,
          createdAt: 1,
        }),
      );
    }
    return { salesOrderId, lineIds };
  });
}

describe("sales order rules", () => {
  test("status, a short reservation, and a partial shipment", () => {
    expect(orderStatusError("draft", "confirmed")).toBeNull();
    expect(orderStatusError("draft", "invoiced")).toMatch(/can't be marked/);
    expect(orderStatusError("confirmed", "cancelled")).toBeNull();
    expect(orderStatusError("invoiced", "cancelled")).toMatch(/can't be marked/);
    expect(orderStatusError("fulfilling", "invoiced")).toBeNull();
    expect(orderStatusError("closed", "cancelled")).toMatch(/can't be marked/);
    expect(reserveTake(6, 2)).toBe(2);
    expect(reserveTake(2, 0)).toBe(0);
    expect(isBackordered({ qty: 6, reservedQty: 2, fulfilledQty: 0 })).toBe(true);
    expect(isBackordered({ qty: 4, reservedQty: 1, fulfilledQty: 3 })).toBe(false);
    expect(shipmentQtyError(0, 2)).toMatch(/greater than zero/);
    expect(shipmentQtyError(3, 2)).toMatch(/Only 2/);
    expect(shipmentQtyError(2, 0)).toMatch(/Nothing is reserved/);
    expect(shipmentQtyError(1, 2)).toBeNull();
    expect(readyToInvoice([])).toBe(false);
    expect(readyToInvoice([{ qty: 2, fulfilledQty: 1 }])).toBe(false);
    expect(readyToInvoice([{ qty: 2, fulfilledQty: 2 }])).toBe(true);
    expect(orderChannelLabel("manual")).toBe("Manual");
    expect(orderChannelLabel("storefront")).toBe("Storefront");
  });
});

describe("sales orders (PH2-12)", () => {
  test("confirm reserves what is free, a shipment can be partial, then the order closes", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse", "warehouse-ship@example.com");
    const other = await asRole(t, "sales", "other-sales@example.com");
    const world = await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        code: "ACME",
        name: "Acme",
        status: "active" as const,
        paymentTermsDays: 14,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      });
      const closedId = await ctx.db.insert("customers", {
        code: "CLOSED",
        name: "Closed",
        status: "closed" as const,
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
      const inactive = await ctx.db.insert("warehouses", {
        code: "OLD",
        name: "Old",
        isDefault: false,
        active: false,
        createdAt: 1,
        updatedAt: 1,
      });
      return { customerId, closedId, productId, main, inactive };
    });

    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Opening",
      lines: [{ productId: world.productId, qty: 4, unitCost: 4 }],
    });

    const full = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.productId,
      qty: 4,
      docNumber: "SO-FULL",
    });
    const lineId = full.lineIds[0];
    if (lineId === undefined) throw new Error("missing line");

    await expect(
      warehouse.mutation(api.sales.orders.confirm, {
        salesOrderId: full.salesOrderId,
        warehouseId: world.main,
      }),
    ).rejects.toThrow(/permission to create sales/);
    await expect(
      sales.mutation(api.sales.orders.confirm, {
        salesOrderId: full.salesOrderId,
        warehouseId: world.inactive,
      }),
    ).rejects.toThrow(/inactive/);
    expect(
      (await sales.query(api.sales.orders.get, { salesOrderId: full.salesOrderId }))?.order.status,
    ).toBe("draft");

    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: full.salesOrderId,
      warehouseId: world.main,
    });
    expect(
      await sales.query(api.sales.orders.get, { salesOrderId: full.salesOrderId }),
    ).toMatchObject({
      order: { status: "confirmed", warehouseCode: "MAIN" },
      lines: [{ reservedQty: 4, fulfilledQty: 0, backorder: false }],
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 4,
      reserved: 4,
      available: 0,
    });
    await expect(
      sales.mutation(api.sales.orders.confirm, {
        salesOrderId: full.salesOrderId,
        warehouseId: world.main,
      }),
    ).rejects.toThrow(/can't be marked/);
    await expect(
      sales.mutation(api.sales.orders.invoice, { salesOrderId: full.salesOrderId }),
    ).rejects.toThrow(/can't be marked/);

    await expect(
      other.mutation(api.sales.orders.fulfill, {
        salesOrderId: full.salesOrderId,
        lineId,
        qty: 5,
      }),
    ).rejects.toThrow(/Only 4/);
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 4,
      reserved: 4,
    });

    await warehouse.mutation(api.sales.orders.fulfill, {
      salesOrderId: full.salesOrderId,
      lineId,
      qty: 1,
    });
    expect(
      await sales.query(api.sales.orders.get, { salesOrderId: full.salesOrderId }),
    ).toMatchObject({
      order: { status: "fulfilling" },
      lines: [{ reservedQty: 3, fulfilledQty: 1, backorder: false }],
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 3,
      reserved: 3,
      available: 0,
    });
    await expect(
      sales.mutation(api.sales.orders.invoice, { salesOrderId: full.salesOrderId }),
    ).rejects.toThrow(/Ship every line/);

    await warehouse.mutation(api.sales.orders.fulfill, {
      salesOrderId: full.salesOrderId,
      lineId,
      qty: 3,
    });
    const issued = await t.run((ctx) =>
      ctx.db
        .query("stockMovements")
        .withIndex("by_reference", (q) =>
          q.eq("referenceType", "salesOrder").eq("referenceId", full.salesOrderId),
        )
        .collect(),
    );
    expect(issued.filter((row) => row.type === "issue").map((row) => row.unitCost)).toEqual([4, 4]);
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 0,
      reserved: 0,
      available: 0,
    });

    await sales.mutation(api.sales.orders.invoice, { salesOrderId: full.salesOrderId });
    await expect(
      sales.mutation(api.sales.orders.cancel, { salesOrderId: full.salesOrderId }),
    ).rejects.toThrow(/can't be marked/);
    await sales.mutation(api.sales.orders.close, { salesOrderId: full.salesOrderId });
    expect(
      (await sales.query(api.sales.orders.get, { salesOrderId: full.salesOrderId }))?.order.status,
    ).toBe("closed");

    const closedOrder = await draftOrder(t, {
      customerId: world.closedId,
      productId: world.productId,
      qty: 1,
      docNumber: "SO-CLOSED",
    });
    await expect(
      sales.mutation(api.sales.orders.confirm, {
        salesOrderId: closedOrder.salesOrderId,
        warehouseId: world.main,
      }),
    ).rejects.toThrow(/closed/);
  });

  test("a short line stays on backorder until stock arrives, and cancel releases only the hold", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse", "warehouse-bo@example.com");
    const accountant = await asRole(t, "accountant");
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
      const otherId = await ctx.db.insert("products", {
        name: "Gel",
        slug: "gel",
        sku: "GEL",
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
      return { customerId, productId, otherId, main };
    });

    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Opening",
      lines: [{ productId: world.productId, qty: 5, unitCost: 2 }],
    });

    const shared = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.productId,
      qty: 3,
      docNumber: "SO-SHARE",
      lines: [
        { productId: world.productId, qty: 3 },
        { productId: world.productId, qty: 3 },
      ],
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: shared.salesOrderId,
      warehouseId: world.main,
    });
    expect(
      (await sales.query(api.sales.orders.get, { salesOrderId: shared.salesOrderId }))?.lines.map(
        (line) => ({ reservedQty: line.reservedQty, backorder: line.backorder }),
      ),
    ).toEqual([
      { reservedQty: 3, backorder: false },
      { reservedQty: 2, backorder: true },
    ]);
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 5,
      reserved: 5,
      available: 0,
    });

    const short = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.otherId,
      qty: 4,
      docNumber: "SO-SHORT",
    });
    const shortLine = short.lineIds[0];
    if (shortLine === undefined) throw new Error("missing line");
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: short.salesOrderId,
      warehouseId: world.main,
    });
    expect(
      await sales.query(api.sales.orders.get, { salesOrderId: short.salesOrderId }),
    ).toMatchObject({ lines: [{ reservedQty: 0, fulfilledQty: 0, backorder: true }] });
    await expect(
      warehouse.mutation(api.sales.orders.reserve, { salesOrderId: short.salesOrderId }),
    ).rejects.toThrow(/Nothing available/);
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Restock",
      lines: [{ productId: world.otherId, qty: 4, unitCost: 1 }],
    });
    await expect(
      accountant.mutation(api.sales.orders.reserve, { salesOrderId: short.salesOrderId }),
    ).rejects.toThrow(/permission to edit sales/);
    await warehouse.mutation(api.sales.orders.reserve, { salesOrderId: short.salesOrderId });
    expect(
      await sales.query(api.sales.orders.get, { salesOrderId: short.salesOrderId }),
    ).toMatchObject({
      order: { status: "confirmed" },
      lines: [{ reservedQty: 4, backorder: false }],
    });

    await warehouse.mutation(api.sales.orders.fulfill, {
      salesOrderId: short.salesOrderId,
      lineId: shortLine,
      qty: 1,
    });
    await sales.mutation(api.sales.orders.cancel, { salesOrderId: short.salesOrderId });
    expect(
      await sales.query(api.sales.orders.get, { salesOrderId: short.salesOrderId }),
    ).toMatchObject({
      order: { status: "cancelled" },
      lines: [{ reservedQty: 0, fulfilledQty: 1, backorder: false }],
    });
    expect(await ledgerAt(t, world.otherId, world.main)).toMatchObject({
      onHand: 3,
      reserved: 0,
      available: 3,
    });
    await expect(
      sales.mutation(api.sales.orders.cancel, { salesOrderId: short.salesOrderId }),
    ).rejects.toThrow(/can't be marked/);

    const untouched = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.otherId,
      qty: 1,
      docNumber: "SO-DRAFT",
    });
    await sales.mutation(api.sales.orders.cancel, { salesOrderId: untouched.salesOrderId });
    expect(
      (await sales.query(api.sales.orders.get, { salesOrderId: untouched.salesOrderId }))?.order
        .status,
    ).toBe("cancelled");
  });

  test("the desk shows today's price and what is free at the warehouse", async () => {
    const t = setup();
    const sales = await asRole(t, "sales", "desk@example.com");
    const warehouse = await asRole(t, "warehouse", "desk-wh@example.com");
    const world = await t.run(async (ctx) => {
      await ctx.db.insert("currencies", {
        code: "GBP",
        name: "Pound",
        decimalPlaces: 2,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizations", {
        name: "Chris",
        baseCurrency: "GBP",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const customerId = await ctx.db.insert("customers", {
        code: "ACME",
        name: "Acme",
        status: "onHold" as const,
        paymentTermsDays: 14,
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
        listPrice: 80,
        costPrice: 50,
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
      return { customerId, productId, main };
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Opening",
      lines: [{ productId: world.productId, qty: 7, unitCost: 4 }],
    });
    const draft = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.productId,
      qty: 2,
      docNumber: "SO-DESK",
    });
    const before = await sales.query(api.sales.orders.get, { salesOrderId: draft.salesOrderId });
    expect(before?.order).toMatchObject({
      channel: "manual",
      paymentTermsDays: 14,
      customerStatus: "onHold",
    });
    expect(before?.lines[0]).toMatchObject({
      unitPrice: 10,
      liveUnitPrice: 80,
      available: null,
      onHand: null,
      marginPercent: -400,
    });
    const preview = await sales.query(api.sales.orders.get, {
      salesOrderId: draft.salesOrderId,
      warehouseId: world.main,
    });
    expect(preview?.order.warehouseCode).toBe("MAIN");
    expect(preview?.lines[0]).toMatchObject({ available: 7, onHand: 7 });

    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: draft.salesOrderId,
      warehouseId: world.main,
    });
    const confirmed = await sales.query(api.sales.orders.get, {
      salesOrderId: draft.salesOrderId,
    });
    expect(confirmed?.lines[0]).toMatchObject({
      reservedQty: 2,
      available: 5,
      onHand: 7,
      liveUnitPrice: 80,
    });
  });
});
