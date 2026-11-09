import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  billMatchBlocked,
  billMatchIssues,
  vendorBillPayError,
  vendorBillStatusLabel,
} from "../lib/vendorBills";
import { setup } from "./setup";

/**
 * PH2-23 — a vendor bill from a received purchase order, or on its own.
 * Matching posts a vendor-bill intent. Payment is Phase 3.
 */

type T = ReturnType<typeof setup>;

const NEED_BY = Date.parse("2026-11-16T00:00:00.000Z");
const BILL_DATE = Date.parse("2026-11-09T00:00:00.000Z");

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

describe("vendor bill rules", () => {
  test("a match warns, and payment stays closed", () => {
    expect(vendorBillStatusLabel("open")).toBe("Open");
    expect(vendorBillStatusLabel("matched")).toBe("Matched");
    expect(vendorBillStatusLabel("paid")).toBe("Paid");
    expect(vendorBillPayError("open")).toMatch(/Phase 3/);
    expect(vendorBillPayError("matched")).toMatch(/Phase 3/);
    expect(vendorBillPayError("paid")).toMatch(/Phase 3/);
    const matched = {
      orderedQty: 2,
      receivedQty: 2,
      billedQty: 2,
      orderPrice: 100,
      billPrice: 102,
    };
    expect(billMatchBlocked(matched)).toBe(false);
    expect(billMatchBlocked({ ...matched, billPrice: 103 })).toBe(true);
    expect(
      billMatchIssues({
        orderedQty: 4,
        receivedQty: 2,
        billedQty: 2,
        orderPrice: 10,
        billPrice: 10,
      }),
    ).toEqual([{ message: "Received quantity differs from the order.", blocks: false }]);
    expect(
      billMatchIssues({
        orderedQty: null,
        receivedQty: null,
        billedQty: 1,
        orderPrice: null,
        billPrice: 6,
      }),
    ).toEqual([]);
  });
});

describe("vendor bills", () => {
  test("a received order is billed within tolerance, and a standalone bill matches too", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    const owner = await asRole(t, "owner");
    const sales = await asRole(t, "sales");
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Gel",
        slug: "gel",
        sku: "GEL",
        status: "active" as const,
        taxCategory: "standard" as const,
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
      const rateId = await ctx.db.insert("taxRates", {
        name: "VAT 20%",
        rateBps: 2000,
        inclusive: false,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const taxGroupId = await ctx.db.insert("taxGroups", {
        name: "UK VAT",
        isDefault: false,
        rates: { standard: rateId },
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
        taxGroupId,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const requisitionId = await warehouse.mutation(api.procurement.requisitions.create, {
      needBy: NEED_BY,
      lines: [{ productId, qty: 2, unitPrice: 100 }],
    });
    await owner.mutation(api.procurement.requisitions.approve, { requisitionId });
    const purchaseOrderId = await owner.mutation(api.procurement.requisitions.convert, {
      requisitionId,
      vendorId,
    });
    await owner.mutation(api.procurement.purchaseOrders.send, { purchaseOrderId });
    const sent = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    const lineId = sent?.lines[0]?._id;
    if (lineId === undefined) throw new Error("missing line");

    await warehouse.mutation(api.procurement.purchaseReceipts.receive, {
      purchaseOrderId,
      warehouseId,
      lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 1, qtyRejected: 0 }],
    });
    await expect(
      accountant.mutation(api.procurement.vendorBills.createFromPurchaseOrder, {
        purchaseOrderId,
        billDate: BILL_DATE,
      }),
    ).rejects.toThrow(/after it is received/);

    await warehouse.mutation(api.procurement.purchaseReceipts.receive, {
      purchaseOrderId,
      warehouseId,
      lines: [{ purchaseOrderLineId: lineId, qtyAccepted: 1, qtyRejected: 0 }],
    });
    await expect(
      warehouse.mutation(api.procurement.vendorBills.createFromPurchaseOrder, {
        purchaseOrderId,
        billDate: BILL_DATE,
      }),
    ).rejects.toThrow(/permission to edit procurement/);
    await expect(
      sales.mutation(api.procurement.vendorBills.createFromPurchaseOrder, {
        purchaseOrderId,
        billDate: BILL_DATE,
      }),
    ).rejects.toThrow(/permission to edit procurement/);

    const vendorBillId = await accountant.mutation(
      api.procurement.vendorBills.createFromPurchaseOrder,
      { purchaseOrderId, billDate: BILL_DATE },
    );
    const open = await sales.query(api.procurement.vendorBills.get, { vendorBillId });
    expect(open?.status).toBe("open");
    expect(open?.purchaseOrderNumber).toBe("PO-0001");
    expect(open?.totals).toEqual({ net: 200, tax: 40, gross: 240 });
    expect(open?.lines[0]).toMatchObject({
      qty: 2,
      unitPrice: 100,
      orderedQty: 2,
      receivedQty: 2,
      orderPrice: 100,
    });
    await expect(
      accountant.mutation(api.procurement.vendorBills.createFromPurchaseOrder, {
        purchaseOrderId,
        billDate: BILL_DATE,
      }),
    ).rejects.toThrow(/already has a bill/);

    const billLineId = open?.lines[0]?._id;
    if (billLineId === undefined) throw new Error("missing bill line");
    await accountant.mutation(api.procurement.vendorBills.updateLine, {
      vendorBillId,
      lineId: billLineId,
      qty: 1,
      unitPrice: 100,
    });
    await expect(
      accountant.mutation(api.procurement.vendorBills.match, { vendorBillId }),
    ).rejects.toThrow(/differs from what was received/);
    await accountant.mutation(api.procurement.vendorBills.updateLine, {
      vendorBillId,
      lineId: billLineId,
      qty: 2,
      unitPrice: 103,
    });
    await expect(
      accountant.mutation(api.procurement.vendorBills.match, { vendorBillId }),
    ).rejects.toThrow(/tolerance/);
    await expect(
      sales.mutation(api.procurement.vendorBills.match, { vendorBillId }),
    ).rejects.toThrow(/permission to post finance/);

    await accountant.mutation(api.procurement.vendorBills.updateLine, {
      vendorBillId,
      lineId: billLineId,
      qty: 2,
      unitPrice: 100,
    });
    await accountant.mutation(api.procurement.vendorBills.match, { vendorBillId });
    const matched = await sales.query(api.procurement.vendorBills.get, { vendorBillId });
    expect(matched?.status).toBe("matched");
    expect(matched?.totals).toEqual({ net: 200, tax: 40, gross: 240 });
    const billed = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(billed?.status).toBe("billed");
    const intents = await t.run((ctx) => ctx.db.query("journalIntents").collect());
    expect(intents.find((row) => row.sourceId === vendorBillId)).toMatchObject({
      type: "vendorBill",
      sourceType: "vendorBill",
      status: "pending",
      period: "2026-11",
      amount: 240,
      net: 200,
      tax: 40,
    });
    await expect(
      accountant.mutation(api.procurement.vendorBills.updateLine, {
        vendorBillId,
        lineId: billLineId,
        qty: 2,
        unitPrice: 100,
      }),
    ).rejects.toThrow(/can't be edited/);

    const standaloneId = await accountant.mutation(api.procurement.vendorBills.create, {
      vendorId,
      billDate: BILL_DATE,
      reference: "  INV-9  ",
      lines: [{ productId, qty: 1, unitPrice: 6 }],
    });
    const standalone = await sales.query(api.procurement.vendorBills.get, {
      vendorBillId: standaloneId,
    });
    expect(standalone).toMatchObject({
      status: "open",
      purchaseOrderId: null,
      reference: "INV-9",
      lines: [{ qty: 1, unitPrice: 6, orderedQty: null, receivedQty: null, orderPrice: null }],
    });
    await accountant.mutation(api.procurement.vendorBills.match, { vendorBillId: standaloneId });
    const posted = await sales.query(api.procurement.vendorBills.get, { vendorBillId: standaloneId });
    expect(posted?.status).toBe("matched");
    const again = await t.run((ctx) => ctx.db.query("journalIntents").collect());
    expect(again.filter((row) => row.type === "vendorBill")).toHaveLength(2);
  });
});
