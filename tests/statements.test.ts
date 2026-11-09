import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  accountBalance,
  availableCredit,
  documentKindLabel,
  receiptAmount,
  receivedTotal,
} from "../lib/statements";
import { setup } from "./setup";

/**
 * PH2-05 — the partner statement. A customer balance is invoices less
 * credits and payments, which is zero until those documents exist.
 * A vendor total is the cost on receipts that name them.
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

async function asRole(t: T, roleKey: string) {
  const userId = await seedUser(t, `${roleKey}@example.com`);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

async function seedProduct(t: T, sku: string) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: sku,
      slug: sku.toLowerCase(),
      sku,
      status: "active" as const,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedWarehouse(t: T) {
  return await t.run((ctx) =>
    ctx.db.insert("warehouses", {
      code: "MAIN",
      name: "Main",
      isDefault: true,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedCustomer(t: T, code: string, creditLimit?: number) {
  return await t.run((ctx) =>
    ctx.db.insert("customers", {
      code,
      name: code,
      status: "active" as const,
      paymentTermsDays: 0,
      currency: "GBP",
      ...(creditLimit === undefined ? {} : { creditLimit }),
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedVendor(t: T, code: string) {
  return await t.run((ctx) =>
    ctx.db.insert("vendors", {
      code,
      name: code,
      active: true,
      paymentTermsDays: 0,
      currency: "GBP",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("statements (PH2-05)", () => {
  test("balance, available credit, and receipt cost follow the account rules", () => {
    expect(accountBalance({ invoiced: 100, credited: 20, paid: 30 })).toBe(50);
    expect(availableCredit(500, 50)).toBe(450);
    expect(availableCredit(null, 50)).toBeNull();
    expect(availableCredit(10, 50)).toBe(-40);
    expect(availableCredit(0, 0)).toBe(0);
    expect(receiptAmount([])).toBeNull();
    expect(receiptAmount([{ qty: 3 }])).toBeNull();
    expect(receiptAmount([{ qty: 2, unitCost: 12.5 }, { qty: 1 }])).toBe(25);
    expect(
      receiptAmount([
        { qty: 1, unitCost: 0.1 },
        { qty: 1, unitCost: 0.2 },
      ]),
    ).toBe(0.3);
    expect(receivedTotal([25, null, 0.3])).toBe(25.3);
    expect(documentKindLabel("invoice")).toBe("Invoice");
    expect(documentKindLabel("creditNote")).toBe("Credit note");
  });

  test("a customer with no documents is at zero, and a vendor totals only its own receipts", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const stranger = t.withIdentity({
      subject: `${await seedUser(t, "nobody@example.com")}|session-1`,
    });
    const capped = await seedCustomer(t, "ACME", 500);
    const open = await seedCustomer(t, "OPEN");
    const vendorId = await seedVendor(t, "PARTS");
    const otherId = await seedVendor(t, "OTHER");
    const productId = await seedProduct(t, "BENCH");
    const warehouseId = await seedWarehouse(t);

    await expect(
      stranger.query(api.sales.customers.statement, { customerId: capped }),
    ).rejects.toThrow(/permission to view sales/);
    expect(await sales.query(api.sales.customers.statement, { customerId: capped })).toEqual({
      currency: "GBP",
      creditLimit: 500,
      invoiced: 0,
      credited: 0,
      paid: 0,
      balance: 0,
      available: 500,
      documents: [],
    });
    expect(
      await warehouse.query(api.sales.customers.statement, { customerId: open }),
    ).toMatchObject({
      creditLimit: null,
      balance: 0,
      available: null,
      documents: [],
    });

    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      vendorId,
      referenceNote: "DN 12",
      lines: [{ productId, qty: 2, unitCost: 12.5 }],
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      vendorId,
      referenceNote: "no cost",
      lines: [{ productId, qty: 1 }],
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      vendorId: otherId,
      referenceNote: "someone else",
      lines: [{ productId, qty: 4, unitCost: 9 }],
    });
    await warehouse.mutation(api.inventory.goodsReceipts.create, {
      warehouseId,
      referenceNote: "no vendor",
      lines: [{ productId, qty: 1, unitCost: 3 }],
    });

    const statement = await sales.query(api.procurement.vendors.statement, { vendorId });
    expect(statement?.currency).toBe("GBP");
    expect(statement?.receiptCount).toBe(2);
    expect(statement?.received).toBe(25);
    expect(statement?.documents.map((row) => [row.number, row.amount, row.warehouseCode])).toEqual([
      ["GRN-0002", null, "MAIN"],
      ["GRN-0001", 25, "MAIN"],
    ]);
    expect(
      await sales.query(api.procurement.vendors.statement, { vendorId: otherId }),
    ).toMatchObject({
      receiptCount: 1,
      received: 36,
    });
    const missing = await seedVendor(t, "GONE");
    await t.run((ctx) => ctx.db.delete(missing));
    expect(await sales.query(api.procurement.vendors.statement, { vendorId: missing })).toBeNull();
  });
});
