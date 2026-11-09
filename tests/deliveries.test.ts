import { inflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { deliveryPdf, pickListPdf } from "../lib/deliveryPdf";
import {
  cancelDeliveryError,
  carrierError,
  cogsAmount,
  intentPeriod,
  packQtyError,
  packStatusError,
  packableQty,
  shipDeliveryError,
  trackingError,
} from "../lib/deliveries";
import { onHandDelta, reservedDelta, type StockMovementType } from "../lib/stock";
import { setup } from "./setup";

/**
 * PH2-14 — a packing slip claims a reservation, and shipping it is the
 * goods issue plus a cost-of-goods intent. Quantity that already left
 * is not issued again.
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
    const quoteLineId = await ctx.db.insert("quoteLines", {
      quoteId,
      productId: args.productId,
      description: "Bench",
      sku: "BENCH",
      qty: args.qty,
      resolvedUnitPrice: 10,
      discountPercent: 0,
      unitPrice: 10,
      taxCategory: "zero",
      rateBps: 0,
      inclusive: false,
      net: args.qty * 10,
      tax: 0,
      gross: args.qty * 10,
      sort: 0,
      createdAt: 1,
      updatedAt: 1,
    });
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
    const lineId = await ctx.db.insert("salesOrderLines", {
      salesOrderId,
      quoteLineId,
      productId: args.productId,
      description: "Bench",
      sku: "BENCH",
      qty: args.qty,
      unitPrice: 10,
      discountPercent: 0,
      taxCategory: "zero",
      rateBps: 0,
      inclusive: false,
      net: args.qty * 10,
      tax: 0,
      gross: args.qty * 10,
      sort: 0,
      createdAt: 1,
    });
    return { salesOrderId, lineId };
  });
}

describe("delivery rules", () => {
  test("pack limits, ship details, and the cost of goods", () => {
    expect(packStatusError("draft")).toMatch(/can't be packed/);
    expect(packStatusError("confirmed")).toBeNull();
    expect(packableQty(4, 1)).toBe(3);
    expect(packableQty(1, 1)).toBe(0);
    expect(packQtyError(0, 2)).toMatch(/greater than zero/);
    expect(packQtyError(3, 2)).toMatch(/Only 2/);
    expect(packQtyError(1, 0)).toMatch(/Nothing is left/);
    expect(shipDeliveryError("shipped")).toMatch(/can't be shipped/);
    expect(shipDeliveryError("packed")).toBeNull();
    expect(cancelDeliveryError("shipped")).toMatch(/can't be cancelled/);
    expect(carrierError("  ")).toMatch(/Enter a carrier/);
    expect(trackingError("")).toMatch(/Enter a tracking number/);
    expect(intentPeriod(Date.parse("2026-11-08T00:00:00.000Z"))).toBe("2026-11");
    expect(cogsAmount(2, 4)).toBe(8);
    expect(cogsAmount(2, undefined)).toBe(0);
  });

  test("the packing slip and the pick list name what to pick", async () => {
    const slip = await pdfText(
      await deliveryPdf({
        companyName: "Chris",
        docNumber: "DN-0001",
        status: "shipped",
        orderNumber: "SO-0002",
        customerName: "Acme Clinic",
        customerCode: "ACME",
        warehouseCode: "MAIN",
        warehouseName: "Main warehouse",
        shipTo: "12 High Street, Leeds",
        shippedOn: "2026-11-08",
        carrier: "City Freight",
        trackingNumber: "TRK-1006",
        lines: [{ description: "Lab Bench Stand", sku: "DEMO-1006", qty: 1 }],
      }),
    );
    expect(slip).toContain("DN-0001");
    expect(slip).toContain("SO-0002");
    expect(slip).toContain("12 High Street, Leeds");
    expect(slip).toContain("City Freight");
    expect(slip).toContain("TRK-1006");
    expect(slip).toContain("DEMO-1006");
    expect(slip).not.toContain("12.50");

    const picks = await pdfText(
      await pickListPdf({
        companyName: "Chris",
        printedOn: "2026-11-09",
        groups: [
          {
            code: "MAIN",
            name: "Main warehouse",
            orders: [
              {
                docNumber: "SO-0002",
                customerName: "Acme Clinic",
                lines: [{ description: "Lab Bench Stand", sku: "DEMO-1006", qty: 1 }],
              },
            ],
          },
        ],
      }),
    );
    expect(picks).toContain("Pick list");
    expect(picks).toContain("MAIN · Main warehouse");
    expect(picks).toContain("SO-0002");
    expect(picks).toContain("DEMO-1006");
    expect(picks).toContain("Qty");

    const empty = await pdfText(
      await pickListPdf({ companyName: "Chris", printedOn: "2026-11-09", groups: [] }),
    );
    expect(empty).toContain("Nothing is waiting to pick.");
  });
});

async function pdfText(bytes: Uint8Array): Promise<string> {
  const raw = Buffer.from(bytes).toString("latin1");
  expect(raw.startsWith("%PDF-")).toBe(true);
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    const body = match[1] ?? "";
    try {
      return inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      return body;
    }
  });
  return streams
    .join("\n")
    .replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

describe("deliveries (PH2-14)", () => {
  test("shipping a packed slip issues stock once and writes the cost of goods", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse", "warehouse-pack@example.com");
    const accountant = await asRole(t, "accountant", "accountant-pack@example.com");
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
      const east = await ctx.db.insert("warehouses", {
        code: "EAST",
        name: "East",
        isDefault: false,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      return { customerId, productId, otherId, main, east };
    });

    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Opening",
      lines: [{ productId: world.productId, qty: 4, unitCost: 4 }],
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.east,
      referenceNote: "East opening",
      lines: [{ productId: world.otherId, qty: 2, unitCost: 1 }],
    });

    const order = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.productId,
      qty: 4,
      docNumber: "SO-PACK",
    });
    const eastOrder = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.otherId,
      qty: 2,
      docNumber: "SO-EAST",
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: order.salesOrderId,
      warehouseId: world.main,
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: eastOrder.salesOrderId,
      warehouseId: world.east,
    });

    await expect(
      accountant.mutation(api.sales.deliveries.pack, {
        salesOrderId: order.salesOrderId,
        lines: [{ lineId: order.lineId, qty: 2 }],
      }),
    ).rejects.toThrow(/permission to edit sales/);
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 4,
      reserved: 4,
    });

    const packed = await warehouse.mutation(api.sales.deliveries.pack, {
      salesOrderId: order.salesOrderId,
      lines: [{ lineId: order.lineId, qty: 2 }],
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 4,
      reserved: 4,
      available: 0,
    });
    expect(await sales.query(api.sales.deliveries.get, { deliveryId: packed })).toMatchObject({
      delivery: { status: "packed", docNumber: "DN-0001", warehouseCode: "MAIN" },
      intent: null,
    });
    const picks = await sales.query(api.sales.deliveries.pickList, {});
    expect(picks.map((group) => group.code)).toEqual(["EAST", "MAIN"]);
    expect(picks.find((group) => group.code === "MAIN")?.orders[0]?.lines[0]?.packable).toBe(2);

    await expect(
      warehouse.mutation(api.sales.orders.fulfill, {
        salesOrderId: order.salesOrderId,
        lineId: order.lineId,
        qty: 3,
      }),
    ).rejects.toThrow(/packing slip/);
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 4,
      reserved: 4,
    });

    await expect(
      warehouse.mutation(api.sales.deliveries.ship, {
        deliveryId: packed,
        shippedOn: "2026-11-08",
        carrier: "  ",
        trackingNumber: "TRK1",
      }),
    ).rejects.toThrow(/Enter a carrier/);

    await warehouse.mutation(api.sales.deliveries.ship, {
      deliveryId: packed,
      shippedOn: "2026-11-08",
      carrier: "City Freight",
      trackingNumber: "TRK-1",
    });
    const shipped = await sales.query(api.sales.deliveries.get, { deliveryId: packed });
    expect(shipped).toMatchObject({
      delivery: { status: "shipped", carrier: "City Freight", trackingNumber: "TRK-1" },
      lines: [{ qty: 2, unitCost: 4 }],
      intent: { amount: 8, period: "2026-11", status: "pending", currency: "GBP" },
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 2,
      reserved: 2,
      available: 0,
    });
    const issues = await t.run((ctx) =>
      ctx.db
        .query("stockMovements")
        .withIndex("by_reference", (q) =>
          q.eq("referenceType", "salesOrder").eq("referenceId", order.salesOrderId),
        )
        .collect(),
    );
    expect(issues.filter((row) => row.type === "issue")).toEqual([
      expect.objectContaining({ qty: -2, unitCost: 4 }),
    ]);
    expect(
      await sales.query(api.sales.orders.get, { salesOrderId: order.salesOrderId }),
    ).toMatchObject({
      order: { status: "fulfilling" },
      lines: [{ reservedQty: 2, fulfilledQty: 2 }],
    });
    const statement = await sales.query(api.sales.customers.statement, {
      customerId: world.customerId,
    });
    expect(statement?.balance).toBe(0);
    expect(statement?.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "delivery", number: "DN-0001", amount: 20 }),
      ]),
    );

    await expect(
      warehouse.mutation(api.sales.deliveries.ship, {
        deliveryId: packed,
        shippedOn: "2026-11-08",
        carrier: "City Freight",
        trackingNumber: "TRK-1",
      }),
    ).rejects.toThrow(/can't be shipped/);
    const issuesAfter = await t.run((ctx) =>
      ctx.db
        .query("stockMovements")
        .withIndex("by_reference", (q) =>
          q.eq("referenceType", "salesOrder").eq("referenceId", order.salesOrderId),
        )
        .collect(),
    );
    expect(issuesAfter.filter((row) => row.type === "issue")).toHaveLength(1);
  });

  test("cancelling the order drops a packed slip and does not issue the goods", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse", "warehouse-cancel-pack@example.com");
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
      return { customerId, productId, main };
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: world.main,
      referenceNote: "Opening",
      lines: [{ productId: world.productId, qty: 3, unitCost: 4 }],
    });
    const order = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.productId,
      qty: 3,
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: order.salesOrderId,
      warehouseId: world.main,
    });
    const packed = await warehouse.mutation(api.sales.deliveries.pack, {
      salesOrderId: order.salesOrderId,
      lines: [{ lineId: order.lineId, qty: 3 }],
    });
    await sales.mutation(api.sales.orders.cancel, { salesOrderId: order.salesOrderId });
    expect(await sales.query(api.sales.deliveries.get, { deliveryId: packed })).toMatchObject({
      delivery: { status: "cancelled" },
      intent: null,
    });
    expect(await ledgerAt(t, world.productId, world.main)).toMatchObject({
      onHand: 3,
      reserved: 0,
      available: 3,
    });
    await expect(
      warehouse.mutation(api.sales.deliveries.ship, {
        deliveryId: packed,
        shippedOn: "2026-11-08",
        carrier: "City Freight",
        trackingNumber: "TRK-9",
      }),
    ).rejects.toThrow(/can't be shipped/);
    const issues = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(issues.filter((row) => row.type === "issue")).toEqual([]);
  });
});
