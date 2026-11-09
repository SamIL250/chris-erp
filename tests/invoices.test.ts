import { inflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { invoicePdf } from "../lib/invoicePdf";
import {
  dueOn,
  invoiceOrderStatusError,
  orderCoveredByInvoices,
  payInvoiceError,
  postInvoiceError,
  taxBreakdown,
  unbilledQty,
  voidInvoiceError,
} from "../lib/invoices";
import { setup } from "./setup";

/**
 * PH2-16 — an invoice snapshots shipped quantity, the charged price,
 * and the tax. Posting writes a sales-invoice intent. A draft can be
 * voided. Paid does not reduce the balance.
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

async function draftOrder(
  t: T,
  args: {
    customerId: Id<"customers">;
    productId: Id<"products">;
    qty: number;
    docNumber: string;
    rateBps?: number;
  },
) {
  const rateBps = args.rateBps ?? 0;
  return await t.run(async (ctx) => {
    const quoteId = await ctx.db.insert("quotes", {
      docNumber: `QT-${args.docNumber}`,
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
      taxCategory: rateBps > 0 ? "standard" : "zero",
      rateBps,
      inclusive: false,
      net: args.qty * 10,
      tax: 0,
      gross: args.qty * 10,
      sort: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const salesOrderId = await ctx.db.insert("salesOrders", {
      docNumber: args.docNumber,
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
      taxCategory: rateBps > 0 ? "standard" : "zero",
      rateBps,
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

describe("invoice rules", () => {
  test("unbilled quantity, tax slices, and which status can move", () => {
    expect(unbilledQty(2, 1)).toBe(1);
    expect(unbilledQty(1, 1)).toBe(0);
    expect(dueOn(Date.parse("2026-11-09T00:00:00.000Z"), 14)).toBe(
      Date.parse("2026-11-23T00:00:00.000Z"),
    );
    expect(dueOn(Date.parse("2026-11-09T00:00:00.000Z"), 0)).toBe(
      Date.parse("2026-11-09T00:00:00.000Z"),
    );
    expect(
      taxBreakdown(
        [
          { taxCategory: "standard", rateBps: 2000, inclusive: false, net: 10, tax: 2 },
          { taxCategory: "standard", rateBps: 2000, inclusive: false, net: 10, tax: 2 },
        ],
        2,
      ),
    ).toEqual([{ taxCategory: "standard", rateBps: 2000, inclusive: false, net: 20, tax: 4 }]);
    expect(invoiceOrderStatusError("invoiced")).toMatch(/can't be invoiced/);
    expect(invoiceOrderStatusError("fulfilling")).toBeNull();
    expect(postInvoiceError("posted")).toMatch(/can't be posted/);
    expect(voidInvoiceError("posted")).toMatch(/can't be voided/);
    expect(voidInvoiceError("draft")).toBeNull();
    expect(payInvoiceError("draft")).toMatch(/can't be marked paid/);
    expect(payInvoiceError("posted")).toBeNull();
    expect(orderCoveredByInvoices([{ qty: 2, fulfilledQty: 1, billedQty: 1 }])).toBe(false);
    expect(orderCoveredByInvoices([{ qty: 2, fulfilledQty: 2, billedQty: 2 }])).toBe(true);
  });

  test("the PDF names the invoice and the tax, not the unit cost", async () => {
    const text = await pdfText(
      await invoicePdf({
        companyName: "Chris",
        footer: "Payment due within 30 days.",
        docNumber: "INV-0001",
        status: "posted",
        customerName: "Acme Clinic",
        customerCode: "ACME",
        currency: "GBP",
        decimalPlaces: 2,
        invoiceDate: "2026-11-09",
        dueDate: "2026-11-23",
        orderNumber: "SO-0002",
        deliveryNumber: "DN-0001",
        billTo: "12 High Street, Leeds",
        lines: [
          {
            description: "Lab Bench Stand",
            sku: "DEMO-1006",
            qty: 1,
            unitPrice: 450,
            net: 450,
            tax: 0,
            gross: 450,
          },
        ],
        breakdown: [{ taxCategory: "zero", rateBps: 0, inclusive: false, net: 450, tax: 0 }],
        net: 450,
        tax: 0,
        gross: 450,
      }),
    );
    expect(text).toContain("INV-0001");
    expect(text).toContain("SO-0002");
    expect(text).toContain("DN-0001");
    expect(text).toContain("12 High Street, Leeds");
    expect(text).toContain("450.00 GBP");
    expect(text).toContain("Zero 0% exclusive");
    expect(text).toContain("Payment due within 30 days.");
    expect(text).not.toContain("12.50");
  });
});

describe("sales invoices (PH2-16)", () => {
  test("a partial shipment invoices only what left, and posting the rest marks the order", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse", "warehouse-invoice@example.com");
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
      lines: [{ productId: world.productId, qty: 2, unitCost: 4 }],
    });
    const order = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.productId,
      qty: 2,
      docNumber: "SO-TAX",
      rateBps: 2000,
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: order.salesOrderId,
      warehouseId: world.main,
    });
    await warehouse.mutation(api.sales.orders.fulfill, {
      salesOrderId: order.salesOrderId,
      lineId: order.lineId,
      qty: 1,
    });
    await expect(
      warehouse.mutation(api.sales.invoices.createFromOrder, {
        salesOrderId: order.salesOrderId,
        invoiceOn: "2026-11-09",
      }),
    ).rejects.toThrow(/permission to create sales/);

    const invoiceId = await sales.mutation(api.sales.invoices.createFromOrder, {
      salesOrderId: order.salesOrderId,
      invoiceOn: "2026-11-09",
    });
    expect(await sales.query(api.sales.invoices.get, { invoiceId })).toMatchObject({
      invoice: {
        docNumber: "INV-0001",
        status: "draft",
        orderNumber: "SO-TAX",
        deliveryNumber: null,
      },
      lines: [{ qty: 1, unitPrice: 10, rateBps: 2000, net: 10, tax: 2, gross: 12 }],
      totals: { net: 10, tax: 2, gross: 12 },
      breakdown: [{ taxCategory: "standard", rateBps: 2000, net: 10, tax: 2 }],
      intent: null,
    });
    const drafted = await sales.query(api.sales.invoices.get, { invoiceId });
    expect(new Date(drafted?.invoice.dueDate ?? 0).toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(
      (await sales.query(api.sales.invoices.forOrder, { salesOrderId: order.salesOrderId }))
        ?.billable,
    ).toBe(false);
    await expect(
      sales.mutation(api.sales.invoices.createFromOrder, {
        salesOrderId: order.salesOrderId,
        invoiceOn: "2026-11-09",
      }),
    ).rejects.toThrow(/ready to invoice/);

    await sales.mutation(api.sales.invoices.post, { invoiceId });
    expect(await sales.query(api.sales.invoices.get, { invoiceId })).toMatchObject({
      invoice: { status: "posted" },
      intent: {
        type: "salesInvoice",
        amount: 12,
        net: 10,
        tax: 2,
        period: "2026-11",
        status: "pending",
      },
    });
    const intent = await t.run((ctx) =>
      ctx.db
        .query("journalIntents")
        .withIndex("by_source", (q) => q.eq("sourceType", "salesInvoice").eq("sourceId", invoiceId))
        .unique(),
    );
    expect(intent?.lines).toEqual([
      expect.objectContaining({ qty: 1, unitPrice: 10, tax: 2, amount: 12 }),
    ]);
    expect(intent?.lines[0]?.unitCost).toBeUndefined();
    expect(
      (await sales.query(api.sales.orders.get, { salesOrderId: order.salesOrderId }))?.order.status,
    ).toBe("fulfilling");
    expect(
      await sales.query(api.sales.customers.statement, { customerId: world.customerId }),
    ).toMatchObject({ invoiced: 12, paid: 0, balance: 12 });

    await warehouse.mutation(api.sales.orders.fulfill, {
      salesOrderId: order.salesOrderId,
      lineId: order.lineId,
      qty: 1,
    });
    const rest = await sales.mutation(api.sales.invoices.createFromOrder, {
      salesOrderId: order.salesOrderId,
      invoiceOn: "2026-11-09",
    });
    await sales.mutation(api.sales.invoices.voidInvoice, { invoiceId: rest });
    expect(
      (await sales.query(api.sales.invoices.forOrder, { salesOrderId: order.salesOrderId }))
        ?.billable,
    ).toBe(true);
    const again = await sales.mutation(api.sales.invoices.createFromOrder, {
      salesOrderId: order.salesOrderId,
      invoiceOn: "2026-11-09",
    });
    await expect(sales.mutation(api.sales.invoices.voidInvoice, { invoiceId })).rejects.toThrow(
      /can't be voided/,
    );
    await sales.mutation(api.sales.invoices.post, { invoiceId: again });
    expect(
      (await sales.query(api.sales.orders.get, { salesOrderId: order.salesOrderId }))?.order.status,
    ).toBe("invoiced");
    await sales.mutation(api.sales.invoices.markPaid, { invoiceId });
    expect(
      await sales.query(api.sales.customers.statement, { customerId: world.customerId }),
    ).toMatchObject({ invoiced: 24, paid: 0, balance: 24 });
    expect(
      (await sales.query(api.sales.customers.statement, { customerId: world.customerId }))
        ?.documents,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "invoice", number: "INV-0001", amount: 12 }),
        expect.objectContaining({ kind: "invoice", number: "INV-0003", amount: 12 }),
      ]),
    );
  });

  test("a shipped delivery is invoiced once, and a packed slip is not", async () => {
    const t = setup();
    const sales = await asRole(t, "sales", "sales-slip@example.com");
    const warehouse = await asRole(t, "warehouse", "warehouse-slip@example.com");
    const accountant = await asRole(t, "accountant", "accountant-slip@example.com");
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
      lines: [{ productId: world.productId, qty: 2, unitCost: 4 }],
    });
    const order = await draftOrder(t, {
      customerId: world.customerId,
      productId: world.productId,
      qty: 2,
      docNumber: "SO-SLIP",
    });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId: order.salesOrderId,
      warehouseId: world.main,
    });
    const packed = await warehouse.mutation(api.sales.deliveries.pack, {
      salesOrderId: order.salesOrderId,
      lines: [{ lineId: order.lineId, qty: 2 }],
    });
    await expect(
      sales.mutation(api.sales.invoices.createFromDelivery, {
        deliveryId: packed,
        invoiceOn: "2026-11-09",
      }),
    ).rejects.toThrow(/Ship the delivery/);
    await warehouse.mutation(api.sales.deliveries.ship, {
      deliveryId: packed,
      shippedOn: "2026-11-08",
      carrier: "City Freight",
      trackingNumber: "TRK-1",
    });
    await expect(
      accountant.mutation(api.sales.invoices.createFromDelivery, {
        deliveryId: packed,
        invoiceOn: "2026-11-09",
      }),
    ).rejects.toThrow(/permission to create sales/);
    const invoiceId = await sales.mutation(api.sales.invoices.createFromDelivery, {
      deliveryId: packed,
      invoiceOn: "2026-11-09",
    });
    expect(await sales.query(api.sales.invoices.get, { invoiceId })).toMatchObject({
      invoice: { docNumber: "INV-0001", deliveryNumber: "DN-0001", status: "draft" },
      lines: [{ qty: 2, gross: 20 }],
      totals: { net: 20, tax: 0, gross: 20 },
    });
    expect(
      new Date((await sales.query(api.sales.invoices.get, { invoiceId }))?.invoice.dueDate ?? 0)
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-11-23");
    await expect(
      sales.mutation(api.sales.invoices.createFromOrder, {
        salesOrderId: order.salesOrderId,
        invoiceOn: "2026-11-09",
      }),
    ).rejects.toThrow(/ready to invoice/);
    expect(
      (await sales.query(api.sales.invoices.forDelivery, { deliveryId: packed }))?.billable,
    ).toBe(false);
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
