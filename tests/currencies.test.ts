import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Currency settings (PH0-31): settings.view reads, settings.create for the
 * catalog, settings.edit for base currency + rates — all audited; rates are
 * append-only observations.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
        : await ctx.db.insert("roles", { key: roleKey, name: roleKey, createdAt: Date.now() });
    await ctx.db.insert("userRoles", { userId, roleId, createdAt: Date.now() });
  });
}

async function seedCurrency(t: T, code: string, overrides: Partial<{ active: boolean }> = {}) {
  return await t.run((ctx) =>
    ctx.db.insert("currencies", {
      code,
      name: code,
      decimalPlaces: 2,
      active: overrides.active ?? true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function seedOrg(t: T, baseCurrency = "USD") {
  return await t.run((ctx) =>
    ctx.db.insert("organizations", {
      name: "Chris Trading Ltd",
      baseCurrency,
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

describe("currencies:list (PH0-31)", () => {
  test("settings.view, sorted by code, base from the org row", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to view settings items.";
    await expect(t.query(api.currencies.list, {})).rejects.toThrow("Not authenticated");
    await expect(
      t.withIdentity({ subject: `${sales}|session-1` }).query(api.currencies.list, {}),
    ).rejects.toThrow(denied);

    await seedCurrency(t, "GBP");
    await seedCurrency(t, "USD");
    await seedCurrency(t, "EUR");

    const asAccountant = t.withIdentity({ subject: `${accountant}|session-1` });
    const before = await asAccountant.query(api.currencies.list, {});
    expect(before.currencies.map((row) => row.code)).toEqual(["EUR", "GBP", "USD"]);
    expect(before.base).toBeNull(); // no company row yet

    await seedOrg(t, "GBP");
    expect((await asAccountant.query(api.currencies.list, {})).base).toBe("GBP");
  });
});

describe("currencies:create (PH0-31)", () => {
  test("settings.create required; validates and uppercases; audited", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to create settings items.";
    await expect(t.mutation(api.currencies.create, currency("USD", "US Dollar"))).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.currencies.create, currency("USD", "US Dollar")),
    ).rejects.toThrow(denied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await expect(asOwner.mutation(api.currencies.create, currency("us4", "Bad"))).rejects.toThrow(
      "3 letters",
    );
    await expect(asOwner.mutation(api.currencies.create, currency("USD", ""))).rejects.toThrow(
      "between 1 and 100",
    );
    await expect(
      asOwner.mutation(api.currencies.create, {
        ...currency("USD", "US Dollar"),
        decimalPlaces: 9,
      }),
    ).rejects.toThrow("between 0 and 6");

    // Lowercase input lands uppercase; blanks drop the symbol.
    await asOwner.mutation(api.currencies.create, {
      ...currency("eur", "Euro"),
      symbol: "€",
    });
    const rows = await t.run((ctx) => ctx.db.query("currencies").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "EUR", name: "Euro", symbol: "€", active: true });

    await expect(asOwner.mutation(api.currencies.create, currency("EUR", "Dup"))).rejects.toThrow(
      "EUR already exists",
    );
    expect(await t.run((ctx) => ctx.db.query("currencies").collect())).toHaveLength(1);

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "currencies",
      actorLabel: "owner@example.com",
      after: { currency: "EUR", name: "Euro", decimalPlaces: 2, active: true },
    });
  });
});

function currency(code: string, name: string) {
  return { code, name, decimalPlaces: 2, active: true };
}

describe("currencies:updateBase (PH0-31)", () => {
  test("settings.edit, needs company + catalog entries, audited", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    const denied = "You don't have permission to edit settings items.";
    await expect(t.mutation(api.currencies.updateBase, { code: "USD" })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.currencies.updateBase, { code: "USD" }),
    ).rejects.toThrow(denied);

    // Company row must exist first.
    await expect(asOwner.mutation(api.currencies.updateBase, { code: "USD" })).rejects.toThrow(
      "Save your company details first",
    );
    await seedOrg(t, "USD");

    // …and so must the currency.
    await expect(asOwner.mutation(api.currencies.updateBase, { code: "GBP" })).rejects.toThrow(
      "No currency with code GBP",
    );
    await seedCurrency(t, "GBP");

    await asOwner.mutation(api.currencies.updateBase, { code: "gbp" });
    const org = await t.run((ctx) => ctx.db.query("organizations").collect());
    expect(org[0].baseCurrency).toBe("GBP");

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "updateBase",
      entity: "organizations",
      before: { baseCurrency: "USD" },
      after: { baseCurrency: "GBP" },
    });

    // Saving the same base again records nothing.
    await asOwner.mutation(api.currencies.updateBase, { code: "GBP" });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);
  });
});

describe("exchange rates (PH0-31)", () => {
  test("list is settings.view; addRate is settings.edit with validation", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, accountant, "accountant");
    await seedCurrency(t, "USD");
    await seedCurrency(t, "EUR");

    const viewDenied = "You don't have permission to view settings items.";
    const editDenied = "You don't have permission to edit settings items.";
    await expect(t.query(api.currencies.rates, {})).rejects.toThrow("Not authenticated");
    await expect(
      t.withIdentity({ subject: `${sales}|session-1` }).query(api.currencies.rates, {}),
    ).rejects.toThrow(viewDenied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    const asAccountant = t.withIdentity({ subject: `${accountant}|session-1` });
    // Accountant can VIEW rates but not record them.
    expect(await asAccountant.query(api.currencies.rates, {})).toEqual([]);
    await expect(
      asAccountant.mutation(api.currencies.addRate, rate("USD", "EUR", 0.92)),
    ).rejects.toThrow(editDenied);

    await expect(asOwner.mutation(api.currencies.addRate, rate("USD", "USD", 1))).rejects.toThrow(
      "must differ",
    );
    await expect(asOwner.mutation(api.currencies.addRate, rate("USD", "JPY", -2))).rejects.toThrow(
      "positive number",
    );
    await expect(asOwner.mutation(api.currencies.addRate, rate("USD", "GBP", 0.8))).rejects.toThrow(
      "No currency with code GBP",
    );
    expect(await t.run((ctx) => ctx.db.query("exchangeRates").collect())).toHaveLength(0);

    await asOwner.mutation(api.currencies.addRate, rate("usd", "eur", 0.92));
    // Distinct effectiveAt — a same-millisecond pair would tie in sorting.
    await new Promise((resolve) => setTimeout(resolve, 3));
    await asOwner.mutation(api.currencies.addRate, rate("USD", "EUR", 0.93));

    // Append-only: both observations survive, newest first.
    const rows = await asOwner.query(api.currencies.rates, {});
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.rate)).toEqual([0.93, 0.92]);
    expect(rows[0]).toMatchObject({
      baseCurrency: "USD",
      quoteCurrency: "EUR",
      source: "manual",
      createdBy: owner,
    });

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(2);
    // Insertion order: first observation, then the newer one.
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "exchangeRates",
      actorLabel: "owner@example.com",
      after: { pair: "USD/EUR", rate: 0.92, source: "manual" },
    });
    expect(audit[1].after).toMatchObject({ pair: "USD/EUR", rate: 0.93 });
  });
});

function rate(baseCurrency: string, quoteCurrency: string, rate: number) {
  return { baseCurrency, quoteCurrency, rate };
}
