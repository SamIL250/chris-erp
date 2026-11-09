import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  creditOnTrail,
  deliveryOnTrail,
  invoiceOnTrail,
  returnOnTrail,
  salesDocFlowSteps,
  type SalesDocFlow,
} from "../lib/docFlow";
import { setup } from "./setup";

/**
 * PH2-27 — one trail for a sale: quote, order, delivery, invoice,
 * then a credit, a return, or an exchange when one exists, then
 * payment. The current page is not a link. Payment is named until a
 * payment exists.
 */

function flow(overrides: Partial<SalesDocFlow> = {}): SalesDocFlow {
  return {
    currentKind: "quote",
    currentId: "q",
    quote: { id: "q", number: "QT-0001" },
    order: null,
    deliveries: [],
    pinnedDelivery: null,
    invoices: [],
    credits: [],
    returns: [],
    exchanges: [],
    payment: null,
    ...overrides,
  };
}

describe("sales document trail", () => {
  test("a quote names the documents that are not open yet", () => {
    const steps = salesDocFlowSteps(flow());
    expect(steps.map((step) => [step.label, step.href ?? null, step.current ?? false])).toEqual([
      ["Quote QT-0001", null, true],
      ["Order", null, false],
      ["Delivery", null, false],
      ["Invoice", null, false],
      ["Payment", null, false],
    ]);
  });

  test("several deliveries share one step, and the open delivery is the current page", () => {
    const shared = salesDocFlowSteps(
      flow({
        currentKind: "order",
        currentId: "so",
        order: { id: "so", number: "SO-0002" },
        deliveries: [
          { id: "d1", number: "DN-0001" },
          { id: "d2", number: "DN-0002" },
        ],
        invoices: [{ id: "inv", number: "INV-00001" }],
      }),
    );
    expect(shared.map((step) => [step.label, step.href ?? null, step.current ?? false])).toEqual([
      ["Quote QT-0001", "/sales/quotes/q", false],
      ["Order SO-0002", null, true],
      ["Delivery", "/sales/deliveries", false],
      ["Invoice INV-00001", "/sales/invoices/inv", false],
      ["Payment", null, false],
    ]);

    const here = salesDocFlowSteps(
      flow({
        currentKind: "delivery",
        currentId: "d2",
        order: { id: "so", number: "SO-0002" },
        deliveries: [
          { id: "d1", number: "DN-0001" },
          { id: "d2", number: "DN-0002" },
        ],
      }),
    );
    expect(here[2]).toEqual({ label: "Delivery DN-0002", current: true });
  });

  test("an invoice keeps its own delivery, and a credit or return sits before payment", () => {
    const steps = salesDocFlowSteps(
      flow({
        currentKind: "invoice",
        currentId: "inv",
        order: { id: "so", number: "SO-0002" },
        deliveries: [
          { id: "d1", number: "DN-0001" },
          { id: "d2", number: "DN-0002" },
        ],
        pinnedDelivery: { id: "d1", number: "DN-0001" },
        invoices: [{ id: "inv", number: "INV-00001" }],
        credits: [{ id: "cr", number: "CR-0001" }],
        returns: [{ id: "rma", number: "RMA-0001" }],
        exchanges: [{ id: "ex", number: "SO-0003" }],
        payment: { id: "pay", number: "PAY-0001" },
      }),
    );
    expect(steps.map((step) => [step.label, step.href ?? null, step.current ?? false])).toEqual([
      ["Quote QT-0001", "/sales/quotes/q", false],
      ["Order SO-0002", "/sales/orders/so", false],
      ["Delivery DN-0001", "/sales/deliveries/d1", false],
      ["Invoice INV-00001", null, true],
      ["Credit CR-0001", "/sales/credit-notes/cr", false],
      ["Return RMA-0001", "/sales/returns/rma", false],
      ["Exchange SO-0003", "/sales/orders/ex", false],
      ["Payment PAY-0001", null, false],
    ]);
  });

  test("a void, a cancellation, and a cancelled return leave the trail unless that page is open", () => {
    expect(invoiceOnTrail("posted", false)).toBe(true);
    expect(invoiceOnTrail("void", false)).toBe(false);
    expect(invoiceOnTrail("void", true)).toBe(true);
    expect(deliveryOnTrail("cancelled", false)).toBe(false);
    expect(deliveryOnTrail("shipped", false)).toBe(true);
    expect(creditOnTrail("void", false)).toBe(false);
    expect(returnOnTrail("cancelled", false)).toBe(false);
    expect(returnOnTrail("exchanged", false)).toBe(true);
  });
});

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

describe("document trail query", () => {
  test("the order's documents are the same trail from the quote and from the invoice", async () => {
    const t = setup();
    const warehouseId = await seedUser(t, "warehouse@example.com");
    await grant(t, warehouseId, "warehouse");
    const warehouse = t.withIdentity({ subject: `${warehouseId}|session-1` });
    const stranger = await seedUser(t, "stranger@example.com");

    const ids = await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        code: "ACME",
        name: "Acme",
        status: "active",
        paymentTermsDays: 0,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      });
      const warehouseRow = await ctx.db.insert("warehouses", {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const quoteId = await ctx.db.insert("quotes", {
        docNumber: "QT-0002",
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
      const salesOrderId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-0002",
        customerId,
        quoteId,
        status: "invoiced",
        channel: "manual",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(quoteId, { salesOrderId });
      const kept = await ctx.db.insert("deliveries", {
        docNumber: "DN-0001",
        salesOrderId,
        warehouseId: warehouseRow,
        status: "shipped",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("deliveries", {
        docNumber: "DN-0009",
        salesOrderId,
        warehouseId: warehouseRow,
        status: "cancelled",
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("deliveries", {
        docNumber: "DN-0002",
        salesOrderId,
        warehouseId: warehouseRow,
        status: "packed",
        createdAt: 3,
        updatedAt: 3,
      });
      const invoiceId = await ctx.db.insert("salesInvoices", {
        docNumber: "INV-00001",
        customerId,
        salesOrderId,
        deliveryId: kept,
        status: "posted",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        invoiceDate: 1,
        dueDate: 2,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("salesInvoices", {
        docNumber: "INV-00002",
        customerId,
        salesOrderId,
        status: "void",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        invoiceDate: 1,
        dueDate: 2,
        createdAt: 2,
        updatedAt: 2,
      });
      const exchangeOrderId = await ctx.db.insert("salesOrders", {
        docNumber: "SO-0003",
        customerId,
        quoteId,
        status: "draft",
        channel: "manual",
        currency: "GBP",
        decimalPlaces: 2,
        paymentTermsDays: 0,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("creditNotes", {
        docNumber: "CR-0001",
        invoiceId,
        customerId,
        salesOrderId,
        kind: "return",
        restock: true,
        status: "posted",
        currency: "GBP",
        decimalPlaces: 2,
        creditDate: 1,
        reason: "Returned",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("salesReturns", {
        docNumber: "RMA-0001",
        customerId,
        salesOrderId,
        invoiceId,
        status: "exchanged",
        reason: "Wrong item",
        currency: "GBP",
        decimalPlaces: 2,
        exchangeOrderId,
        createdAt: 1,
        updatedAt: 1,
      });
      return { quoteId, salesOrderId, invoiceId };
    });

    const fromQuote = await warehouse.query(api.sales.docFlow.get, { quoteId: ids.quoteId });
    expect(salesDocFlowSteps(fromQuote!).map((step) => step.label)).toEqual([
      "Quote QT-0002",
      "Order SO-0002",
      "Delivery",
      "Invoice INV-00001",
      "Credit CR-0001",
      "Return RMA-0001",
      "Exchange SO-0003",
      "Payment",
    ]);
    expect(fromQuote?.currentKind).toBe("quote");

    const fromInvoice = await warehouse.query(api.sales.docFlow.get, { invoiceId: ids.invoiceId });
    const invoiceSteps = salesDocFlowSteps(fromInvoice!);
    expect(invoiceSteps[2]?.label).toBe("Delivery DN-0001");
    expect(invoiceSteps[2]?.href).toContain("/sales/deliveries/");
    expect(invoiceSteps.find((step) => step.label.startsWith("Invoice"))?.current).toBe(true);
    expect(invoiceSteps.some((step) => step.label.includes("INV-00002"))).toBe(false);
    expect(invoiceSteps.some((step) => step.label.includes("DN-0009"))).toBe(false);
    expect(invoiceSteps.at(-1)).toEqual({ label: "Payment" });

    await expect(
      t.withIdentity({ subject: `${stranger}|session-1` }).query(api.sales.docFlow.get, {
        quoteId: ids.quoteId,
      }),
    ).rejects.toThrow(/permission to view sales/);
    await expect(
      warehouse.query(api.sales.docFlow.get, {
        quoteId: ids.quoteId,
        salesOrderId: ids.salesOrderId,
      }),
    ).rejects.toThrow(/Open one document/);
  });
});
