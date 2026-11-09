import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { purchaseOrderPdf } from "../lib/purchaseOrderPdf";
import {
  purchaseOrderBillError,
  purchaseOrderEditError,
  purchaseOrderReceivedStatus,
  purchaseOrderSendError,
  purchaseOrderStatusLabel,
} from "../lib/purchaseOrders";
import { setup } from "./setup";

/**
 * PH2-21 — a draft purchase order takes an agreed price and tax, then
 * one send freezes it. Receipts and bills move the later statuses.
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

describe("purchase order rules", () => {
  test("send, receive, and bill follow the status chain", async () => {
    expect(purchaseOrderStatusLabel("draft")).toBe("Draft");
    expect(purchaseOrderStatusLabel("sent")).toBe("Sent");
    expect(purchaseOrderStatusLabel("partiallyReceived")).toBe("Partially received");
    expect(purchaseOrderStatusLabel("received")).toBe("Received");
    expect(purchaseOrderStatusLabel("billed")).toBe("Billed");
    expect(purchaseOrderEditError("draft")).toBeNull();
    expect(purchaseOrderEditError("sent")).toMatch(/can't be edited/);
    expect(purchaseOrderSendError("draft")).toBeNull();
    expect(purchaseOrderSendError("sent")).toMatch(/already sent/);
    expect(purchaseOrderReceivedStatus("draft", 2, 1)).toEqual({
      error: "Send the purchase order before receiving it.",
    });
    expect(purchaseOrderReceivedStatus("sent", 2, 1)).toEqual({ status: "partiallyReceived" });
    expect(purchaseOrderReceivedStatus("partiallyReceived", 2, 2)).toEqual({ status: "received" });
    expect(purchaseOrderReceivedStatus("sent", 2, 3)).toEqual({
      error: "Received quantity can't exceed the order.",
    });
    expect(purchaseOrderBillError("sent")).toMatch(/after it is received/);
    expect(purchaseOrderBillError("received")).toBeNull();
    expect(purchaseOrderBillError("billed")).toMatch(/already billed/);

    const bytes = await purchaseOrderPdf({
      companyName: "Chris",
      docNumber: "PO-0001",
      status: "sent",
      vendorName: "Parts Co",
      vendorCode: "PARTS",
      currency: "GBP",
      decimalPlaces: 2,
      expectedDate: "2026-11-16",
      requisitionNumber: "REQ-0001",
      lines: [
        {
          description: "Gel",
          sku: "GEL",
          qty: 2,
          unitPrice: 100,
          net: 200,
          tax: 40,
          gross: 240,
        },
      ],
      net: 200,
      tax: 40,
      gross: 240,
    });
    expect(Buffer.from(bytes).toString("latin1").startsWith("%PDF-")).toBe(true);
  });
});

describe("purchase orders", () => {
  test("an agreed price is taxed, then send freezes the order", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    const owner = await asRole(t, "owner");
    const sales = await asRole(t, "sales");
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "GEL",
        slug: "gel",
        sku: "GEL",
        status: "active" as const,
        taxCategory: "standard" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const extraId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "TAPE",
        slug: "tape",
        sku: "TAPE",
        status: "active" as const,
        taxCategory: "standard" as const,
        categoryIds: [],
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
    const draft = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(draft?.status).toBe("draft");
    expect(draft?.totals).toEqual({ net: 200, tax: 40, gross: 240 });
    const lineId = draft?.lines[0]?._id;
    if (lineId === undefined) throw new Error("missing line");

    await expect(
      warehouse.mutation(api.procurement.purchaseOrders.updateLine, {
        purchaseOrderId,
        lineId,
        unitPrice: 50,
      }),
    ).rejects.toThrow(/permission to edit procurement/);

    await accountant.mutation(api.procurement.purchaseOrders.updateLine, {
      purchaseOrderId,
      lineId,
      unitPrice: 50,
    });
    const repriced = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(repriced?.lines[0]).toEqual(
      expect.objectContaining({ unitPrice: 50, net: 100, tax: 20, gross: 120, rateBps: 2000 }),
    );

    const added = await accountant.mutation(api.procurement.purchaseOrders.addLine, {
      purchaseOrderId,
      productId: extraId,
      qty: 1,
      unitPrice: 10,
    });
    const withExtra = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(withExtra?.totals).toEqual({ net: 110, tax: 22, gross: 132 });
    await accountant.mutation(api.procurement.purchaseOrders.removeLine, {
      purchaseOrderId,
      lineId: added,
    });

    const later = Date.parse("2026-11-20T00:00:00.000Z");
    await accountant.mutation(api.procurement.purchaseOrders.updateExpectedDate, {
      purchaseOrderId,
      expectedDate: later,
    });
    await expect(
      accountant.mutation(api.procurement.purchaseOrders.send, { purchaseOrderId }),
    ).rejects.toThrow(/permission to approve procurement/);

    await owner.mutation(api.procurement.purchaseOrders.send, { purchaseOrderId });
    const sent = await sales.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(sent?.status).toBe("sent");
    expect(sent?.expectedDate).toBe(later);
    expect(sent?.totals).toEqual({ net: 100, tax: 20, gross: 120 });
    expect(sent?.sentAt).toEqual(expect.any(Number));
    await expect(
      owner.mutation(api.procurement.purchaseOrders.send, { purchaseOrderId }),
    ).rejects.toThrow(/already sent/);
    await expect(
      accountant.mutation(api.procurement.purchaseOrders.updateLine, {
        purchaseOrderId,
        lineId,
        unitPrice: 40,
      }),
    ).rejects.toThrow(/can't be edited/);
  });
});
