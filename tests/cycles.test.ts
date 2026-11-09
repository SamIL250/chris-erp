import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { priceDay, priceDayLabel } from "../lib/pricing";
import { setup } from "./setup";

/**
 * PH2-29 — order-to-cash and procure-to-pay through the public
 * mutations. The happy path and the exceptions (a partial delivery, a
 * price outside tolerance, a return) leave stock and pending intents.
 * Nothing is posted, and nothing is marked paid.
 */

type T = ReturnType<typeof setup>;

const SEQUENCES: { name: string; prefix: string }[] = [
  { name: "quote", prefix: "QT-" },
  { name: "salesOrder", prefix: "SO-" },
  { name: "deliveryNote", prefix: "DN-" },
  { name: "invoice", prefix: "INV-" },
  { name: "creditNote", prefix: "CR-" },
  { name: "rma", prefix: "RMA-" },
  { name: "requisition", prefix: "REQ-" },
  { name: "purchaseOrder", prefix: "PO-" },
  { name: "goodsReceipt", prefix: "GRN-" },
  { name: "vendorBill", prefix: "BILL-" },
  { name: "debitNote", prefix: "DBN-" },
];

function calendar() {
  const today = priceDay(Date.now());
  if (today === null) throw new Error("today");
  const label = priceDayLabel(today);
  return {
    today,
    label,
    validUntil: priceDayLabel(today + 30 * 86_400_000),
    needBy: today + 7 * 86_400_000,
    period: label.slice(0, 7),
  };
}

function required<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) throw new Error(label);
  return value;
}

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
  const userId = await seedUser(t, `${roleKey}-cycle@example.com`);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

async function world(t: T, listPrice: number) {
  return await t.run(async (ctx) => {
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
    for (const sequence of SEQUENCES) {
      await ctx.db.insert("sequences", { ...sequence, next: 1, padding: 4, updatedAt: 1 });
    }
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
      listPrice,
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
    const vendorId = await ctx.db.insert("vendors", {
      code: "PARTS",
      name: "Parts Co",
      active: true,
      paymentTermsDays: 30,
      currency: "GBP",
      createdAt: 1,
      updatedAt: 1,
    });
    return { customerId, productId, warehouseId, vendorId };
  });
}

async function intents(t: T) {
  return await t.run((ctx) => ctx.db.query("journalIntents").collect());
}

describe("order to cash and procure to pay", () => {
  test("a quote ships in full and the invoice stays pending", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const when = calendar();
    const company = await world(t, 10);
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: company.warehouseId,
      referenceNote: "Opening",
      lines: [{ productId: company.productId, qty: 2, unitCost: 4 }],
    });

    const quoteId = await sales.mutation(api.sales.quotes.create, {
      customerId: company.customerId,
      validUntil: when.validUntil,
      notes: null,
    });
    await sales.mutation(api.sales.quotes.addLine, {
      quoteId,
      productId: company.productId,
      variantId: null,
      qty: 2,
    });
    await sales.mutation(api.sales.quotes.send, { quoteId });
    await sales.mutation(api.sales.quotes.accept, { quoteId });
    const salesOrderId = await sales.mutation(api.sales.quotes.convert, { quoteId });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId,
      warehouseId: company.warehouseId,
    });
    const confirmed = required(await sales.query(api.sales.orders.get, { salesOrderId }), "order");
    expect(confirmed.order).toMatchObject({ docNumber: "SO-0001", status: "confirmed" });
    expect(confirmed.lines[0]).toMatchObject({ qty: 2, unitPrice: 10, reservedQty: 2 });
    expect(confirmed.totals).toEqual({ net: 20, tax: 0, gross: 20 });
    const lineId = required(confirmed.lines[0]?._id, "order line");

    const deliveryId = await warehouse.mutation(api.sales.deliveries.pack, {
      salesOrderId,
      lines: [{ lineId, qty: 2 }],
    });
    await warehouse.mutation(api.sales.deliveries.ship, {
      deliveryId,
      shippedOn: when.label,
      carrier: "City Freight",
      trackingNumber: "TRK-1",
    });
    const invoiceId = await sales.mutation(api.sales.invoices.createFromDelivery, {
      deliveryId,
      invoiceOn: when.label,
    });
    await sales.mutation(api.sales.invoices.post, { invoiceId });

    const invoice = required(await sales.query(api.sales.invoices.get, { invoiceId }), "invoice");
    expect(invoice.invoice).toMatchObject({
      docNumber: "INV-0001",
      status: "posted",
      orderNumber: "SO-0001",
      deliveryNumber: "DN-0001",
    });
    expect(invoice.totals).toEqual({ net: 20, tax: 0, gross: 20 });
    expect(invoice.intent).toMatchObject({
      type: "salesInvoice",
      status: "pending",
      amount: 20,
      period: when.period,
    });
    expect((await sales.query(api.sales.orders.get, { salesOrderId }))?.order.status).toBe(
      "invoiced",
    );
    expect(
      await warehouse.query(api.inventory.stock.balance, {
        productId: company.productId,
        warehouseId: company.warehouseId,
      }),
    ).toMatchObject({ onHand: 0, reserved: 0, available: 0, unitCost: 4, value: 0 });

    const posted = await intents(t);
    expect(posted.every((row) => row.status === "pending" && row.currency === "GBP")).toBe(true);
    expect(posted.map((row) => [row.type, row.amount])).toEqual([
      ["goodsReceipt", 8],
      ["cogs", 8],
      ["salesInvoice", 20],
    ]);
  });

  test("a partial delivery invoices only what shipped, and a return puts that unit back", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const when = calendar();
    const company = await world(t, 10);
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: company.warehouseId,
      referenceNote: "Opening",
      lines: [{ productId: company.productId, qty: 4, unitCost: 4 }],
    });

    const quoteId = await sales.mutation(api.sales.quotes.create, {
      customerId: company.customerId,
      validUntil: when.validUntil,
      notes: null,
    });
    await sales.mutation(api.sales.quotes.addLine, {
      quoteId,
      productId: company.productId,
      variantId: null,
      qty: 4,
    });
    await sales.mutation(api.sales.quotes.send, { quoteId });
    await sales.mutation(api.sales.quotes.accept, { quoteId });
    const salesOrderId = await sales.mutation(api.sales.quotes.convert, { quoteId });
    await sales.mutation(api.sales.orders.confirm, {
      salesOrderId,
      warehouseId: company.warehouseId,
    });
    const lineId = required(
      (await sales.query(api.sales.orders.get, { salesOrderId }))?.lines[0]?._id,
      "order line",
    );
    const deliveryId = await warehouse.mutation(api.sales.deliveries.pack, {
      salesOrderId,
      lines: [{ lineId, qty: 1 }],
    });
    await warehouse.mutation(api.sales.deliveries.ship, {
      deliveryId,
      shippedOn: when.label,
      carrier: "City Freight",
      trackingNumber: "TRK-1",
    });
    const invoiceId = await sales.mutation(api.sales.invoices.createFromDelivery, {
      deliveryId,
      invoiceOn: when.label,
    });
    await sales.mutation(api.sales.invoices.post, { invoiceId });

    const invoiced = required(await sales.query(api.sales.invoices.get, { invoiceId }), "invoice");
    expect(invoiced.lines[0]).toMatchObject({ qty: 1, unitPrice: 10, gross: 10 });
    expect((await sales.query(api.sales.orders.get, { salesOrderId }))?.order.status).toBe(
      "fulfilling",
    );
    expect((await sales.query(api.sales.orders.get, { salesOrderId }))?.lines[0]).toMatchObject({
      qty: 4,
      reservedQty: 3,
      fulfilledQty: 1,
    });
    expect(
      await warehouse.query(api.inventory.stock.balance, {
        productId: company.productId,
        warehouseId: company.warehouseId,
      }),
    ).toMatchObject({ onHand: 3, reserved: 3, available: 0, value: 12 });

    const invoiceLineId = required(invoiced.lines[0]?._id, "invoice line");
    const salesReturnId = await sales.mutation(api.sales.salesReturns.createFromInvoice, {
      invoiceId,
      reason: "Customer sent one back",
      lines: [{ invoiceLineId, qty: 1 }],
    });
    const requested = required(
      await sales.query(api.sales.salesReturns.get, { salesReturnId }),
      "return",
    );
    const salesReturnLineId = required(requested.lines[0]?._id, "return line");
    await sales.mutation(api.sales.salesReturns.receive, {
      salesReturnId,
      lines: [{ salesReturnLineId, disposition: "restock" }],
    });
    await sales.mutation(api.sales.salesReturns.credit, {
      salesReturnId,
      creditOn: when.label,
    });

    expect(
      (await sales.query(api.sales.salesReturns.get, { salesReturnId }))?.salesReturn.status,
    ).toBe("credited");
    expect(
      await warehouse.query(api.inventory.stock.balance, {
        productId: company.productId,
        warehouseId: company.warehouseId,
      }),
    ).toMatchObject({ onHand: 4, reserved: 3, available: 1, unitCost: 4, value: 16 });
    const posted = await intents(t);
    expect(posted.every((row) => row.status === "pending")).toBe(true);
    expect(posted.map((row) => row.type)).toEqual([
      "goodsReceipt",
      "cogs",
      "salesInvoice",
      "creditNote",
    ]);
    expect(posted.find((row) => row.type === "cogs")?.amount).toBe(4);
    expect(posted.find((row) => row.type === "salesInvoice")?.amount).toBe(10);
    expect(posted.find((row) => row.type === "creditNote")).toMatchObject({
      amount: 10,
      net: 10,
      tax: 0,
      currency: "GBP",
      period: when.period,
    });
    expect(posted.some((row) => row.type === "stockAdjustment")).toBe(false);
  });

  test("a requisition is received and the matched bill stays pending", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const owner = await asRole(t, "owner");
    const accountant = await asRole(t, "accountant");
    const when = calendar();
    const company = await world(t, 10);

    const requisitionId = await warehouse.mutation(api.procurement.requisitions.create, {
      needBy: when.needBy,
      lines: [{ productId: company.productId, qty: 2, unitPrice: 100 }],
    });
    await owner.mutation(api.procurement.requisitions.approve, { requisitionId });
    const purchaseOrderId = await owner.mutation(api.procurement.requisitions.convert, {
      requisitionId,
      vendorId: company.vendorId,
    });
    const draft = required(
      await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId }),
      "purchase order",
    );
    expect(draft).toMatchObject({ docNumber: "PO-0001", status: "draft" });
    expect(draft.lines[0]).toMatchObject({ qty: 2, unitPrice: 100 });
    const purchaseOrderLineId = required(draft.lines[0]?._id, "purchase line");
    await owner.mutation(api.procurement.purchaseOrders.send, { purchaseOrderId });
    const receiptId = await warehouse.mutation(api.procurement.purchaseReceipts.receive, {
      purchaseOrderId,
      warehouseId: company.warehouseId,
      lines: [{ purchaseOrderLineId, qtyAccepted: 2, qtyRejected: 0 }],
    });
    expect(
      (await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId }))?.status,
    ).toBe("received");

    const vendorBillId = await accountant.mutation(
      api.procurement.vendorBills.createFromPurchaseOrder,
      { purchaseOrderId, billDate: when.today },
    );
    await accountant.mutation(api.procurement.vendorBills.match, { vendorBillId });

    expect(await accountant.query(api.procurement.vendorBills.get, { vendorBillId })).toMatchObject(
      { status: "matched", totals: { net: 200, tax: 0, gross: 200 } },
    );
    expect(
      (await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId }))?.status,
    ).toBe("billed");
    expect(
      await warehouse.query(api.inventory.stock.balance, {
        productId: company.productId,
        warehouseId: company.warehouseId,
      }),
    ).toMatchObject({ onHand: 2, reserved: 0, available: 2, unitCost: 100, value: 200 });

    const posted = await intents(t);
    expect(posted.every((row) => row.status === "pending" && row.currency === "GBP")).toBe(true);
    expect(posted.map((row) => [row.type, row.sourceId, row.amount])).toEqual([
      ["goodsReceipt", receiptId, 200],
      ["vendorBill", vendorBillId, 200],
    ]);
  });

  test("a price outside tolerance does not match, and a return issues the receipt cost", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const owner = await asRole(t, "owner");
    const accountant = await asRole(t, "accountant");
    const when = calendar();
    const company = await world(t, 10);

    const requisitionId = await warehouse.mutation(api.procurement.requisitions.create, {
      needBy: when.needBy,
      lines: [{ productId: company.productId, qty: 2, unitPrice: 100 }],
    });
    await owner.mutation(api.procurement.requisitions.approve, { requisitionId });
    const purchaseOrderId = await owner.mutation(api.procurement.requisitions.convert, {
      requisitionId,
      vendorId: company.vendorId,
    });
    const purchaseOrderLineId = required(
      (await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId }))?.lines[0]?._id,
      "purchase line",
    );
    await owner.mutation(api.procurement.purchaseOrders.send, { purchaseOrderId });
    const receiptId = await warehouse.mutation(api.procurement.purchaseReceipts.receive, {
      purchaseOrderId,
      warehouseId: company.warehouseId,
      lines: [{ purchaseOrderLineId, qtyAccepted: 2, qtyRejected: 0 }],
    });
    const vendorBillId = await accountant.mutation(
      api.procurement.vendorBills.createFromPurchaseOrder,
      { purchaseOrderId, billDate: when.today },
    );
    const billLineId = required(
      (await accountant.query(api.procurement.vendorBills.get, { vendorBillId }))?.lines[0]?._id,
      "bill line",
    );
    await accountant.mutation(api.procurement.vendorBills.updateLine, {
      vendorBillId,
      lineId: billLineId,
      qty: 2,
      unitPrice: 103,
    });
    await expect(
      accountant.mutation(api.procurement.vendorBills.match, { vendorBillId }),
    ).rejects.toThrow(/tolerance/);
    expect(
      (await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId }))?.status,
    ).toBe("received");

    await accountant.mutation(api.procurement.vendorBills.updateLine, {
      vendorBillId,
      lineId: billLineId,
      qty: 2,
      unitPrice: 102,
    });
    await accountant.mutation(api.procurement.vendorBills.match, { vendorBillId });
    expect(await accountant.query(api.procurement.vendorBills.get, { vendorBillId })).toMatchObject(
      { status: "matched", totals: { net: 204, tax: 0, gross: 204 } },
    );

    const goodsReceiptLineId = required(
      (await warehouse.query(api.inventory.goodsReceipts.get, { receiptId })).lines[0]?.lineId,
      "receipt line",
    );
    const purchaseReturnId = await warehouse.mutation(api.procurement.purchaseReturns.create, {
      goodsReceiptId: receiptId,
      reason: "One unit went back to the vendor",
      lines: [{ goodsReceiptLineId, qty: 1 }],
    });

    expect(
      await warehouse.query(api.inventory.stock.balance, {
        productId: company.productId,
        warehouseId: company.warehouseId,
      }),
    ).toMatchObject({ onHand: 1, reserved: 0, available: 1, unitCost: 100, value: 100 });
    expect(
      (await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId }))?.status,
    ).toBe("billed");
    const posted = await intents(t);
    expect(posted.every((row) => row.status === "pending")).toBe(true);
    expect(posted.map((row) => [row.type, row.amount])).toEqual([
      ["goodsReceipt", 200],
      ["vendorBill", 204],
      ["debitNote", 100],
    ]);
    expect(posted.find((row) => row.type === "debitNote")?.sourceId).toBe(purchaseReturnId);
  });
});
