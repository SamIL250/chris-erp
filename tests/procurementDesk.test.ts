import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  isBillPendingMatch,
  isOpenPurchaseOrder,
  isOverdueDelivery,
  pendingReceiptQty,
  procurementDeskTileLabel,
  procurementDeskToday,
} from "../lib/procurementDesk";
import { priceDayLabel } from "../lib/pricing";
import { setup } from "./setup";

/**
 * PH2-25 — the procurement desk counts four queues from the documents
 * that already exist.
 */

type T = ReturnType<typeof setup>;

const DAY = 86_400_000;

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

describe("procurement desk rules", () => {
  const today = Date.parse("2026-11-09T00:00:00.000Z");

  test("open, overdue, still to receive, and an open bill", () => {
    expect(procurementDeskTileLabel("open")).toBe("Open purchase orders");
    expect(procurementDeskTileLabel("overdue")).toBe("Overdue deliveries");
    expect(procurementDeskTileLabel("receipts")).toBe("Receipts pending");
    expect(procurementDeskTileLabel("bills")).toBe("Bills pending match");
    expect(procurementDeskToday(Date.parse("2026-11-09T15:00:00.000Z"))).toBe(today);

    expect(isOpenPurchaseOrder("draft")).toBe(true);
    expect(isOpenPurchaseOrder("received")).toBe(true);
    expect(isOpenPurchaseOrder("billed")).toBe(false);

    expect(isOverdueDelivery("sent", today - DAY, today)).toBe(true);
    expect(isOverdueDelivery("partiallyReceived", today - DAY, today)).toBe(true);
    expect(isOverdueDelivery("sent", today, today)).toBe(false);
    expect(isOverdueDelivery("draft", today - DAY, today)).toBe(false);
    expect(isOverdueDelivery("received", today - DAY, today)).toBe(false);
    expect(isOverdueDelivery("billed", today - DAY, today)).toBe(false);

    expect(pendingReceiptQty("sent", 4, 1)).toBe(3);
    expect(pendingReceiptQty("partiallyReceived", 2, 2)).toBe(0);
    expect(pendingReceiptQty("draft", 2, 0)).toBe(0);
    expect(pendingReceiptQty("received", 2, 2)).toBe(0);
    expect(pendingReceiptQty("billed", 2, 2)).toBe(0);

    expect(isBillPendingMatch("open")).toBe(true);
    expect(isBillPendingMatch("matched")).toBe(false);
    expect(isBillPendingMatch("paid")).toBe(false);
  });
});

describe("procurement desk", () => {
  test("each queue lists only the documents that still need that step", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const stranger = t.withIdentity({ subject: "nobody|session-1" });
    await expect(stranger.query(api.procurement.desk.get, {})).rejects.toThrow(
      /permission to view procurement/,
    );

    const today = procurementDeskToday(Date.now());
    const yesterday = today - DAY;
    const tomorrow = today + DAY;

    await t.run(async (ctx) => {
      const requesterId = await ctx.db.insert("users", {
        email: "buyer@example.com",
        status: "active" as const,
        createdAt: 1,
        updatedAt: 1,
      });
      const vendorId = await ctx.db.insert("vendors", {
        code: "PARTS",
        name: "Parts Co",
        active: true,
        paymentTermsDays: 0,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      });
      const productId = await ctx.db.insert("products", {
        name: "Gel",
        slug: "gel",
        sku: "GEL",
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

      const order = async (
        docNumber: string,
        status: "draft" | "sent" | "received" | "billed",
        expectedDate: number,
        qty: number,
        accepted: number,
      ) => {
        const requisitionId = await ctx.db.insert("requisitions", {
          docNumber: `REQ-${docNumber}`,
          requesterId,
          needBy: expectedDate,
          status: "approved" as const,
          createdAt: 1,
          updatedAt: 1,
        });
        const purchaseOrderId = await ctx.db.insert("purchaseOrders", {
          docNumber,
          vendorId,
          requisitionId,
          status,
          currency: "GBP",
          decimalPlaces: 2,
          expectedDate,
          createdAt: 1,
          updatedAt: 1,
        });
        const purchaseOrderLineId = await ctx.db.insert("purchaseOrderLines", {
          purchaseOrderId,
          productId,
          description: "Gel",
          sku: "GEL",
          qty,
          unitPrice: 6,
          sort: 0,
          createdAt: 1,
        });
        if (accepted > 0) {
          const receiptId = await ctx.db.insert("goodsReceipts", {
            number: `GRN-${docNumber}`,
            warehouseId,
            referenceNote: docNumber,
            vendorId,
            purchaseOrderId,
            createdAt: 1,
          });
          await ctx.db.insert("goodsReceiptLines", {
            receiptId,
            productId,
            serialIds: [],
            qty: accepted,
            qtyAccepted: accepted,
            qtyRejected: 0,
            purchaseOrderLineId,
            unitCost: 6,
          });
        }
      };

      await order("PO-1", "draft", yesterday, 1, 0);
      await order("PO-2", "sent", yesterday, 4, 1);
      await order("PO-3", "sent", tomorrow, 2, 0);
      await order("PO-4", "received", yesterday, 1, 1);
      await order("PO-5", "billed", yesterday, 1, 1);

      const bill = async (docNumber: string, status: "open" | "matched" | "paid") => {
        await ctx.db.insert("vendorBills", {
          docNumber,
          vendorId,
          status,
          currency: "GBP",
          decimalPlaces: 2,
          billDate: today,
          createdAt: 1,
          updatedAt: 1,
        });
      };
      await bill("BILL-1", "open");
      await bill("BILL-2", "matched");
      await bill("BILL-3", "paid");
    });

    const desk = await sales.query(api.procurement.desk.get, {});
    expect(desk.open.rows.map((row) => row.number)).toEqual(["PO-1", "PO-2", "PO-3", "PO-4"]);
    expect(desk.open.rows.map((row) => row.detail)).toEqual(["Draft", "Sent", "Sent", "Received"]);
    expect(desk.overdue.count).toBe(1);
    expect(desk.overdue.rows[0]).toMatchObject({
      number: "PO-2",
      vendorName: "Parts Co",
      detail: `Expected ${priceDayLabel(yesterday)}`,
    });
    expect(desk.receipts.count).toBe(2);
    expect(desk.receipts.units).toBe(5);
    expect(desk.receipts.rows.map((row) => `${row.number} ${row.detail}`)).toEqual([
      "PO-2 3 to receive",
      "PO-3 2 to receive",
    ]);
    expect(desk.bills.rows.map((row) => row.number)).toEqual(["BILL-1"]);
    expect(desk.bills.rows[0]?.detail).toBe("Open");
  });
});
