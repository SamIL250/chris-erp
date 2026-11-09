import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { purchaseOrderStatusLabel } from "../lib/purchaseOrders";
import {
  requisitionApproveError,
  requisitionConvertError,
  requisitionPriceError,
  requisitionQtyError,
  requisitionRejectError,
  requisitionStatusLabel,
} from "../lib/requisitions";
import { setup } from "./setup";

/**
 * PH2-20 — an internal requisition is drafted by someone who can create
 * procurement documents, approved by a role that can approve, and
 * converted once into a draft purchase order.
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

async function seedProduct(t: T, sku: string, status: "active" | "archived" = "active") {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: sku,
      slug: sku.toLowerCase(),
      sku,
      status,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedVendor(t: T, code: string, active = true) {
  return await t.run((ctx) =>
    ctx.db.insert("vendors", {
      code,
      name: code,
      active,
      paymentTermsDays: 30,
      currency: "GBP",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("requisition rules", () => {
  test("a draft is the only status that can be approved or rejected", () => {
    expect(requisitionStatusLabel("draft")).toBe("Draft");
    expect(requisitionStatusLabel("approved")).toBe("Approved");
    expect(requisitionStatusLabel("rejected")).toBe("Rejected");
    expect(purchaseOrderStatusLabel("draft")).toBe("Draft");
    expect(requisitionQtyError(0)).toMatch(/greater than zero/);
    expect(requisitionQtyError(1)).toBeNull();
    expect(requisitionPriceError(0)).toMatch(/greater than zero/);
    expect(requisitionPriceError(12.5)).toBeNull();
    expect(requisitionRejectError("  ")).toMatch(/reason/);
    expect(requisitionApproveError("approved")).toMatch(/already approved/);
    expect(requisitionConvertError("draft", false)).toMatch(/Approve/);
    expect(requisitionConvertError("rejected", false)).toMatch(/rejected/);
    expect(requisitionConvertError("approved", true)).toMatch(/already has a purchase order/);
    expect(requisitionConvertError("approved", false)).toBeNull();
  });
});

describe("requisitions", () => {
  test("warehouse requests, an owner approves and converts once", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const accountant = await asRole(t, "accountant");
    const owner = await asRole(t, "owner");
    const productId = await seedProduct(t, "GEL");
    const archivedId = await seedProduct(t, "OLD", "archived");
    const variantProductId = await seedProduct(t, "GLOVE");
    const partsId = await seedVendor(t, "PARTS");
    const closedId = await seedVendor(t, "CLOSED", false);
    await t.run(async (ctx) => {
      await ctx.db.insert("currencies", {
        code: "GBP",
        name: "Pound",
        decimalPlaces: 2,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const attributeId = await ctx.db.insert("attributeDefinitions", {
        name: "Size",
        type: "select",
        options: ["M"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("variants", {
        productId: variantProductId,
        optionValues: [{ attributeId, value: "M" }],
        sku: "GLOVE-M",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const lines = [{ productId, qty: 2, unitPrice: 12.5 }];
    const requisitionId = await warehouse.mutation(api.procurement.requisitions.create, {
      needBy: NEED_BY,
      note: "Cover stock",
      lines,
    });
    await expect(
      sales.mutation(api.procurement.requisitions.create, { needBy: NEED_BY, lines }),
    ).rejects.toThrow(/permission to create procurement/);
    await expect(
      accountant.mutation(api.procurement.requisitions.create, { needBy: NEED_BY, lines }),
    ).rejects.toThrow(/permission to create procurement/);
    await expect(
      warehouse.mutation(api.procurement.requisitions.approve, { requisitionId }),
    ).rejects.toThrow(/permission to approve procurement/);
    await expect(
      warehouse.mutation(api.procurement.requisitions.convert, {
        requisitionId,
        vendorId: partsId,
      }),
    ).rejects.toThrow(/permission to approve procurement/);

    await owner.mutation(api.procurement.requisitions.approve, { requisitionId });
    await expect(
      owner.mutation(api.procurement.requisitions.approve, { requisitionId }),
    ).rejects.toThrow(/already approved/);
    await expect(
      owner.mutation(api.procurement.requisitions.convert, {
        requisitionId,
        vendorId: closedId,
      }),
    ).rejects.toThrow(/inactive/);

    const purchaseOrderId = await owner.mutation(api.procurement.requisitions.convert, {
      requisitionId,
      vendorId: partsId,
    });
    const order = await owner.query(api.procurement.purchaseOrders.get, { purchaseOrderId });
    expect(order?.docNumber).toBe("PO-0001");
    expect(order?.status).toBe("draft");
    expect(order?.currency).toBe("GBP");
    expect(order?.expectedDate).toBe(NEED_BY);
    expect(order?.lines).toEqual([
      expect.objectContaining({ sku: "GEL", qty: 2, unitPrice: 12.5, amount: 25 }),
    ]);
    const requisition = await warehouse.query(api.procurement.requisitions.get, { requisitionId });
    expect(requisition?.status).toBe("approved");
    expect(requisition?.purchaseOrderNumber).toBe("PO-0001");
    expect(requisition?.requesterEmail).toBe("warehouse@example.com");
    await expect(
      owner.mutation(api.procurement.requisitions.convert, {
        requisitionId,
        vendorId: partsId,
      }),
    ).rejects.toThrow(/already has a purchase order/);

    const ownId = await owner.mutation(api.procurement.requisitions.create, {
      needBy: NEED_BY,
      lines,
    });
    await owner.mutation(api.procurement.requisitions.approve, { requisitionId: ownId });
    const own = await owner.query(api.procurement.requisitions.get, { requisitionId: ownId });
    expect(own?.status).toBe("approved");
    expect(own?.docNumber).toBe("REQ-0002");

    const rejectedId = await warehouse.mutation(api.procurement.requisitions.create, {
      needBy: NEED_BY,
      lines,
    });
    await expect(
      owner.mutation(api.procurement.requisitions.reject, {
        requisitionId: rejectedId,
        reason: " ",
      }),
    ).rejects.toThrow(/reason/);
    await owner.mutation(api.procurement.requisitions.reject, {
      requisitionId: rejectedId,
      reason: "Not this quarter",
    });
    await expect(
      owner.mutation(api.procurement.requisitions.convert, {
        requisitionId: rejectedId,
        vendorId: partsId,
      }),
    ).rejects.toThrow(/can't be converted/);
    await expect(
      warehouse.mutation(api.procurement.requisitions.update, {
        requisitionId: rejectedId,
        needBy: NEED_BY,
        lines,
      }),
    ).rejects.toThrow(/can't be edited/);

    const draftId = await warehouse.mutation(api.procurement.requisitions.create, {
      needBy: NEED_BY,
      note: "First note",
      lines,
    });
    await expect(
      owner.mutation(api.procurement.requisitions.convert, {
        requisitionId: draftId,
        vendorId: partsId,
      }),
    ).rejects.toThrow(/Approve the requisition/);
    const later = Date.parse("2026-11-20T00:00:00.000Z");
    await warehouse.mutation(api.procurement.requisitions.update, {
      requisitionId: draftId,
      needBy: later,
      lines: [{ productId, qty: 1, unitPrice: 9 }],
    });
    const draft = await owner.query(api.procurement.requisitions.get, { requisitionId: draftId });
    expect(draft?.needBy).toBe(later);
    expect(draft?.note).toBeNull();
    expect(draft?.lines).toEqual([expect.objectContaining({ sku: "GEL", qty: 1, unitPrice: 9 })]);

    await expect(
      warehouse.mutation(api.procurement.requisitions.create, {
        needBy: NEED_BY,
        lines: [{ productId: variantProductId, qty: 1, unitPrice: 4 }],
      }),
    ).rejects.toThrow(/Name the variant/);
    await expect(
      warehouse.mutation(api.procurement.requisitions.create, {
        needBy: NEED_BY,
        lines: [{ productId: archivedId, qty: 1, unitPrice: 4 }],
      }),
    ).rejects.toThrow(/archived/);
    await expect(sales.query(api.procurement.requisitions.list, {})).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ docNumber: "REQ-0001" })]),
    );
  });
});
