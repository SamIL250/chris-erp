import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { licenseExpiryError, licenseExpiryFromInput, vendorCodeError } from "../lib/vendors";
import { setup } from "./setup";

/**
 * PH2-03 — vendor master. A company, its contacts and addresses, terms,
 * currency, tax number, and a license that is stored but not enforced.
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

async function seedCurrency(t: T, code: string) {
  await t.run((ctx) =>
    ctx.db.insert("currencies", {
      code,
      name: code,
      decimalPlaces: 2,
      active: true,
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

const PAST = Date.parse("2020-01-01T00:00:00.000Z");

describe("vendor rules", () => {
  test("codes and a license date that may already have passed", () => {
    expect(vendorCodeError("  med-1 ")).toBeNull();
    expect(vendorCodeError("a b")).toMatch(/letters/);
    expect(licenseExpiryError(PAST)).toBeNull();
    expect(licenseExpiryError(Date.now())).toMatch(/YYYY-MM-DD/);
    expect(licenseExpiryFromInput("")).toEqual({ ms: null });
    expect(licenseExpiryFromInput("2020-02-31")).toEqual({
      error: "Enter the license expiry as YYYY-MM-DD.",
    });
  });
});

describe("vendors (PH2-03)", () => {
  test("a company keeps contacts, addresses, terms, and an unenforced license", async () => {
    const t = setup();
    const warehouse = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    const sales = await asRole(t, "sales");
    await seedCurrency(t, "USD");
    const cold = await seedTaxGroup(t, "Retired", false);
    const vat = await seedTaxGroup(t, "Local VAT");

    const header = {
      code: "medsup",
      name: "  Med Supply  ",
      active: true,
      paymentTermsDays: 30,
      taxGroupId: vat,
      taxNumber: "GB123",
      currency: "usd",
      licenseNumber: "MH-100",
      licenseJurisdiction: "England",
      licenseExpiresOn: PAST,
    };

    await expect(accountant.mutation(api.procurement.vendors.create, header)).rejects.toThrow(
      /permission/,
    );
    await expect(sales.mutation(api.procurement.vendors.create, header)).rejects.toThrow(
      /permission/,
    );
    await expect(
      warehouse.mutation(api.procurement.vendors.create, { ...header, taxGroupId: cold }),
    ).rejects.toThrow(/inactive/);

    const vendorId = await warehouse.mutation(api.procurement.vendors.create, header);
    await expect(warehouse.mutation(api.procurement.vendors.create, header)).rejects.toThrow(
      /already exists/,
    );
    await expect(
      warehouse.mutation(api.procurement.vendors.update, { vendorId, ...header, name: "Nope" }),
    ).rejects.toThrow(/permission/);

    const created = await sales.query(api.procurement.vendors.get, { vendorId });
    expect(created?.vendor).toMatchObject({
      code: "MEDSUP",
      name: "Med Supply",
      active: true,
      paymentTermsDays: 30,
      currency: "USD",
      taxNumber: "GB123",
      taxGroupId: vat,
      licenseNumber: "MH-100",
      licenseJurisdiction: "England",
      licenseExpiresOn: PAST,
    });

    const first = await accountant.mutation(api.procurement.vendors.addContact, {
      vendorId,
      name: "Ada",
      email: "ada@med.test",
      isPrimary: false,
    });
    const second = await accountant.mutation(api.procurement.vendors.addContact, {
      vendorId,
      name: "Bea",
      isPrimary: true,
    });
    await accountant.mutation(api.procurement.vendors.addAddress, {
      vendorId,
      line1: "1 Dock",
      city: "Leeds",
      country: "United Kingdom",
      isDefaultRemit: true,
      isDefaultShip: true,
    });
    const ship = await accountant.mutation(api.procurement.vendors.addAddress, {
      vendorId,
      line1: "9 Yard",
      city: "Hull",
      country: "United Kingdom",
      isDefaultRemit: false,
      isDefaultShip: true,
    });

    const detail = await accountant.query(api.procurement.vendors.get, { vendorId });
    expect(detail?.contacts.map((row) => [row.name, row.isPrimary])).toEqual([
      ["Ada", false],
      ["Bea", true],
    ]);
    expect(
      detail?.addresses.map((row) => [row.line1, row.isDefaultRemit, row.isDefaultShip]),
    ).toEqual([
      ["1 Dock", true, false],
      ["9 Yard", false, true],
    ]);

    await accountant.mutation(api.procurement.vendors.removeContact, { contactId: second });
    const afterRemove = await accountant.query(api.procurement.vendors.get, { vendorId });
    expect(afterRemove?.contacts).toMatchObject([{ _id: first, name: "Ada", isPrimary: true }]);

    await accountant.mutation(api.procurement.vendors.update, {
      vendorId,
      code: "MEDSUP",
      name: "Med Supply",
      active: false,
      paymentTermsDays: 0,
      taxGroupId: null,
      taxNumber: null,
      currency: "USD",
      licenseNumber: null,
      licenseJurisdiction: null,
      licenseExpiresOn: null,
    });
    const held = await accountant.query(api.procurement.vendors.get, { vendorId });
    expect(held?.vendor.active).toBe(false);
    expect(held?.vendor.taxGroupId).toBeUndefined();
    expect(held?.vendor.taxNumber).toBeUndefined();
    expect(held?.vendor.licenseNumber).toBeUndefined();
    expect(held?.vendor.licenseExpiresOn).toBeUndefined();
    expect(held?.vendor.paymentTermsDays).toBe(0);

    const listed = await sales.query(api.procurement.vendors.list, {
      search: "med",
      active: false,
    });
    expect(listed.map((row) => row.code)).toEqual(["MEDSUP"]);
    expect(await sales.query(api.procurement.vendors.list, { active: true })).toEqual([]);

    await expect(
      accountant.mutation(api.procurement.vendors.updateAddress, {
        addressId: ship,
        vendorId,
        line1: "",
        city: "Hull",
        country: "United Kingdom",
        isDefaultRemit: false,
        isDefaultShip: true,
      }),
    ).rejects.toThrow(/Address line 1/);
  });
});
