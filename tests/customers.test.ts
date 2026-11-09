import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  creditLimitError,
  customerCodeError,
  customerStatusLabel,
  paymentTermsError,
} from "../lib/customers";
import { setup } from "./setup";

/**
 * PH2-01 — customer master. A company, its contacts and addresses,
 * and an append-only notes timeline. Sales writes. Accountant reads.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      name: email,
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

async function seedCurrency(t: T, code: string, active = true) {
  await t.run((ctx) =>
    ctx.db.insert("currencies", {
      code,
      name: code,
      decimalPlaces: 2,
      active,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedTaxGroup(t: T, name: string, active = true) {
  return await t.run((ctx) =>
    ctx.db.insert("taxGroups", {
      name,
      isDefault: false,
      rates: {},
      active,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("customer rules", () => {
  test("codes, terms, credit, and status labels", () => {
    expect(customerCodeError("  acme-1 ")).toBeNull();
    expect(customerCodeError("a b")).toMatch(/letters/);
    expect(paymentTermsError(0)).toBeNull();
    expect(paymentTermsError(1.5)).toMatch(/whole number/);
    expect(paymentTermsError(366)).toMatch(/365/);
    expect(creditLimitError(null)).toBeNull();
    expect(creditLimitError(0)).toBeNull();
    expect(creditLimitError(-1)).toMatch(/negative/);
    expect(customerStatusLabel("onHold")).toBe("On hold");
    expect(customerStatusLabel("active")).toBe("Active");
    expect(customerStatusLabel("closed")).toBe("Closed");
  });
});

describe("customers (PH2-01)", () => {
  test("a company keeps contacts, addresses, terms, and a notes timeline", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const accountant = await asRole(t, "accountant");
    await seedCurrency(t, "USD");
    const cold = await seedTaxGroup(t, "Retired", false);
    const vat = await seedTaxGroup(t, "Local VAT");

    const header = {
      code: "acme",
      name: "  Acme Clinic  ",
      status: "active" as const,
      paymentTermsDays: 30,
      taxGroupId: vat,
      groupId: null,
      currency: "usd",
      creditLimit: 5000,
    };

    await expect(accountant.mutation(api.sales.customers.create, header)).rejects.toThrow(
      /permission/,
    );
    await expect(
      sales.mutation(api.sales.customers.create, { ...header, taxGroupId: cold }),
    ).rejects.toThrow(/inactive/);

    const customerId = await sales.mutation(api.sales.customers.create, header);
    await expect(sales.mutation(api.sales.customers.create, header)).rejects.toThrow(
      /already exists/,
    );

    const created = await accountant.query(api.sales.customers.get, { customerId });
    expect(created?.customer).toMatchObject({
      code: "ACME",
      name: "Acme Clinic",
      paymentTermsDays: 30,
      currency: "USD",
      creditLimit: 5000,
      taxGroupId: vat,
    });

    const first = await sales.mutation(api.sales.customers.addContact, {
      customerId,
      name: "Ada",
      email: "ada@acme.test",
      isPrimary: false,
    });
    const second = await sales.mutation(api.sales.customers.addContact, {
      customerId,
      name: "Bea",
      phone: "0700",
      jobTitle: "Buyer",
      isPrimary: true,
    });
    await sales.mutation(api.sales.customers.addAddress, {
      customerId,
      line1: "1 Market",
      city: "Nairobi",
      country: "Kenya",
      isDefaultBill: true,
      isDefaultShip: true,
    });
    const ship = await sales.mutation(api.sales.customers.addAddress, {
      customerId,
      line1: "9 Dock",
      city: "Mombasa",
      country: "Kenya",
      isDefaultBill: false,
      isDefaultShip: true,
    });
    await sales.mutation(api.sales.customers.addNote, {
      customerId,
      body: "  Asked for net 30.  ",
    });

    const detail = await sales.query(api.sales.customers.get, { customerId });
    expect(detail?.contacts.map((row) => [row.name, row.isPrimary])).toEqual([
      ["Ada", false],
      ["Bea", true],
    ]);
    expect(
      detail?.addresses.map((row) => [row.line1, row.isDefaultBill, row.isDefaultShip]),
    ).toEqual([
      ["1 Market", true, false],
      ["9 Dock", false, true],
    ]);
    expect(detail?.notes).toMatchObject([
      { body: "Asked for net 30.", author: "sales@example.com" },
    ]);

    await sales.mutation(api.sales.customers.removeContact, { contactId: second });
    const afterRemove = await sales.query(api.sales.customers.get, { customerId });
    expect(afterRemove?.contacts).toMatchObject([{ _id: first, name: "Ada", isPrimary: true }]);

    await sales.mutation(api.sales.customers.update, {
      customerId,
      code: "ACME",
      name: "Acme Clinic",
      status: "onHold",
      paymentTermsDays: 0,
      taxGroupId: null,
      groupId: null,
      currency: "USD",
      creditLimit: null,
    });
    const held = await sales.query(api.sales.customers.get, { customerId });
    expect(held?.customer.status).toBe("onHold");
    expect(held?.customer.taxGroupId).toBeUndefined();
    expect(held?.customer.creditLimit).toBeUndefined();
    expect(held?.customer.paymentTermsDays).toBe(0);

    const listed = await sales.query(api.sales.customers.list, {
      search: "acme",
      status: "onHold",
    });
    expect(listed.map((row) => row.code)).toEqual(["ACME"]);
    expect(await sales.query(api.sales.customers.list, { status: "active" })).toEqual([]);

    await expect(
      sales.mutation(api.sales.customers.updateAddress, {
        addressId: ship,
        customerId,
        line1: "",
        city: "Mombasa",
        country: "Kenya",
        isDefaultBill: false,
        isDefaultShip: true,
      }),
    ).rejects.toThrow(/Address line 1/);
  });
});
