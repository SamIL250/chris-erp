import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { customerGroupNameError, STARTER_CUSTOMER_GROUPS } from "../lib/customers";
import { setup } from "./setup";

/**
 * PH2-02 — customer groups. One tier per company. The starting names
 * are Retail, Wholesale, and Institutional. A group is deactivated,
 * never deleted.
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

async function seedCurrency(t: T) {
  await t.run((ctx) =>
    ctx.db.insert("currencies", {
      code: "USD",
      name: "US Dollar",
      decimalPlaces: 2,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

function company(code: string, groupId: Id<"customerGroups"> | null) {
  return {
    code,
    name: code,
    status: "active" as const,
    paymentTermsDays: 0,
    taxGroupId: null,
    groupId,
    currency: "USD",
    creditLimit: null,
  };
}

describe("customer group rules", () => {
  test("the starting tiers and a required name", () => {
    expect(STARTER_CUSTOMER_GROUPS).toEqual(["Retail", "Wholesale", "Institutional"]);
    expect(customerGroupNameError("  ")).toMatch(/required/);
    expect(customerGroupNameError("W")).toBeNull();
  });
});

describe("customer groups (PH2-02)", () => {
  test("a company sits in one tier, and an inactive tier cannot take a new one", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    await seedCurrency(t);

    await expect(
      warehouse.mutation(api.sales.customerGroups.create, { name: "Retail", active: true }),
    ).rejects.toThrow(/permission/);
    await expect(
      accountant.mutation(api.sales.customerGroups.create, { name: "Retail", active: true }),
    ).rejects.toThrow(/permission/);

    const retail = await sales.mutation(api.sales.customerGroups.create, {
      name: "  Retail  ",
      active: true,
    });
    await expect(
      sales.mutation(api.sales.customerGroups.create, { name: "retail", active: true }),
    ).rejects.toThrow(/already exists/);
    const wholesale = await sales.mutation(api.sales.customerGroups.create, {
      name: "Wholesale",
      active: true,
    });

    const acme = await sales.mutation(api.sales.customers.create, company("ACME", retail));
    await sales.mutation(api.sales.customerGroups.update, {
      groupId: retail,
      name: "Retail",
      active: false,
    });
    await sales.mutation(api.sales.customers.update, {
      customerId: acme,
      ...company("ACME", retail),
    });
    expect((await sales.query(api.sales.customers.get, { customerId: acme }))?.group).toMatchObject(
      {
        name: "Retail",
        active: false,
      },
    );
    await sales.mutation(api.sales.customerGroups.update, {
      groupId: retail,
      name: "Retail",
      active: true,
    });
    await expect(
      sales.mutation(api.sales.customerGroups.update, {
        groupId: retail,
        name: "Wholesale",
        active: true,
      }),
    ).rejects.toThrow(/already exists/);

    const beta = await sales.mutation(api.sales.customers.create, company("BETA", null));
    expect(
      (await sales.query(api.sales.customerGroups.get, { groupId: retail }))?.customers,
    ).toMatchObject([{ code: "ACME" }]);

    await warehouse.mutation(api.sales.customers.update, {
      customerId: beta,
      ...company("BETA", wholesale),
    });
    await sales.mutation(api.sales.customers.update, {
      customerId: acme,
      ...company("ACME", wholesale),
    });
    const moved = await sales.query(api.sales.customerGroups.get, { groupId: wholesale });
    expect(moved?.customers.map((row) => row.code).sort()).toEqual(["ACME", "BETA"]);
    expect(
      (await sales.query(api.sales.customerGroups.get, { groupId: retail }))?.customers,
    ).toEqual([]);

    await sales.mutation(api.sales.customerGroups.update, {
      groupId: retail,
      name: "Retail",
      active: false,
    });
    await expect(
      sales.mutation(api.sales.customers.update, {
        customerId: acme,
        ...company("ACME", retail),
      }),
    ).rejects.toThrow(/inactive/);

    await sales.mutation(api.sales.customers.update, {
      customerId: acme,
      ...company("ACME", wholesale),
    });
    const listed = await accountant.query(api.sales.customers.list, {});
    expect(listed.find((row) => row.code === "ACME")?.groupName).toBe("Wholesale");
    expect(listed.find((row) => row.code === "BETA")?.groupName).toBe("Wholesale");

    await sales.mutation(api.sales.customers.update, {
      customerId: acme,
      ...company("ACME", null),
    });
    const cleared = await sales.query(api.sales.customers.get, { customerId: acme });
    expect(cleared?.customer.groupId).toBeUndefined();
    expect(cleared?.group).toBeNull();
  });
});
