import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Tax engine config (PH0-32): settings.view reads, settings.create for new
 * rates/groups, settings.edit for changes — audited with before/after;
 * exactly one default group (demotions recorded); rates never deleted,
 * only deactivated.
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

async function seedRate(t: T, name: string, rateBps = 2000) {
  return await t.run((ctx) =>
    ctx.db.insert("taxRates", {
      name,
      rateBps,
      inclusive: false,
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function seedGroup(
  t: T,
  name: string,
  overrides: Partial<{ isDefault: boolean; standard: Id<"taxRates"> }> = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("taxGroups", {
      name,
      isDefault: overrides.isDefault ?? false,
      rates: overrides.standard ? { standard: overrides.standard } : {},
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

const rateInput = (name: string) => ({
  name,
  rateBps: 2000,
  inclusive: false,
  active: true,
});

describe("tax queries (PH0-32)", () => {
  test("rates and groups need settings.view, sorted by name", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to view settings items.";
    await expect(t.query(api.tax.rates, {})).rejects.toThrow("Not authenticated");
    await expect(t.query(api.tax.groups, {})).rejects.toThrow("Not authenticated");
    const asSales = t.withIdentity({ subject: `${sales}|session-1` });
    await expect(asSales.query(api.tax.rates, {})).rejects.toThrow(denied);
    await expect(asSales.query(api.tax.groups, {})).rejects.toThrow(denied);

    await seedRate(t, "VAT 20%", 2000);
    await seedRate(t, "Zero", 0);
    await seedGroup(t, "Zero rated");
    await seedGroup(t, "Standard");

    const asAccountant = t.withIdentity({ subject: `${accountant}|session-1` });
    expect((await asAccountant.query(api.tax.rates, {})).map((row) => row.name)).toEqual([
      "VAT 20%",
      "Zero",
    ]);
    expect((await asAccountant.query(api.tax.groups, {})).map((row) => row.name)).toEqual([
      "Standard",
      "Zero rated",
    ]);
  });
});

describe("tax rates (PH0-32)", () => {
  test("create: settings.create, validates basis points, audited as label not code", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to create settings items.";
    await expect(t.mutation(api.tax.createRate, rateInput("VAT"))).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.tax.createRate, rateInput("VAT")),
    ).rejects.toThrow(denied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await expect(
      asOwner.mutation(api.tax.createRate, { ...rateInput(""), name: " " }),
    ).rejects.toThrow("between 1 and 100");
    await expect(
      asOwner.mutation(api.tax.createRate, { ...rateInput("VAT"), rateBps: 19.5 }),
    ).rejects.toThrow("0-100%");
    await expect(
      asOwner.mutation(api.tax.createRate, { ...rateInput("VAT"), rateBps: 10001 }),
    ).rejects.toThrow("0-100%");

    await asOwner.mutation(api.tax.createRate, {
      name: "  VAT 20%  ",
      code: "VAT20",
      rateBps: 2000,
      inclusive: true,
      active: true,
    });
    const rows = await t.run((ctx) => ctx.db.query("taxRates").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "VAT 20%",
      code: "VAT20",
      rateBps: 2000,
      inclusive: true,
    });

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    // `label`, not `code` — the redactor masks bare `code` keys (PH0-26).
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "taxRates",
      actorLabel: "owner@example.com",
      after: { name: "VAT 20%", label: "VAT20", rateBps: 2000, inclusive: true },
    });
    expect(JSON.stringify(audit[0].after)).not.toContain("[redacted]");
  });

  test("update: settings.edit, edits + deactivates (no delete), audited, no-op silent", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");
    const rateId = await seedRate(t, "VAT 20%", 2000);

    const denied = "You don't have permission to edit settings items.";
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.tax.updateRate, { id: rateId, ...rateInput("X") }),
    ).rejects.toThrow(denied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await expect(
      asOwner.mutation(api.tax.updateRate, {
        id: await missingRateId(t),
        ...rateInput("X"),
      }),
    ).rejects.toThrow("no longer exists");

    await asOwner.mutation(api.tax.updateRate, {
      id: rateId,
      name: "VAT 19%",
      code: "VAT19",
      rateBps: 1900,
      inclusive: true,
      active: false,
    });
    const row = await t.run((ctx) => ctx.db.get(rateId));
    expect(row).toMatchObject({ name: "VAT 19%", code: "VAT19", rateBps: 1900, active: false });

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "update",
      entity: "taxRates",
      entityId: rateId,
      before: { name: "VAT 20%", rateBps: 2000, inclusive: false, active: true },
      after: { name: "VAT 19%", rateBps: 1900, inclusive: true, active: false },
    });

    // Saving identical values records nothing.
    await asOwner.mutation(api.tax.updateRate, {
      id: rateId,
      name: "VAT 19%",
      code: "VAT19",
      rateBps: 1900,
      inclusive: true,
      active: false,
    });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);
  });
});

describe("tax groups (PH0-32)", () => {
  test("create: settings.create, validates rate ids, one default with recorded demotion", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to create settings items.";
    await expect(t.mutation(api.tax.createGroup, groupInput("UK"))).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.tax.createGroup, groupInput("UK")),
    ).rejects.toThrow(denied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await expect(asOwner.mutation(api.tax.createGroup, groupInput(" "))).rejects.toThrow(
      "between 1 and 100",
    );
    const standard = await seedRate(t, "VAT 20%", 2000);
    await expect(
      asOwner.mutation(api.tax.createGroup, {
        ...groupInput("Bad"),
        rates: { standard: (await missingRateId(t)) as Id<"taxRates"> },
      }),
    ).rejects.toThrow("The selected standard rate no longer exists");

    // First default — nobody to demote.
    await asOwner.mutation(api.tax.createGroup, {
      ...groupInput("UK VAT"),
      isDefault: true,
      rates: { standard },
    });
    // Second default demotes the first, and says so in the audit.
    await asOwner.mutation(api.tax.createGroup, {
      ...groupInput("EU VAT"),
      isDefault: true,
    });

    const groups = await t.run((ctx) => ctx.db.query("taxGroups").collect());
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.name === "UK VAT")?.isDefault).toBe(false);
    expect(groups.find((group) => group.name === "EU VAT")?.isDefault).toBe(true);

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    // seedRate writes no audit; two group creates do.
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      action: "create",
      entity: "taxGroups",
      after: { name: "EU VAT", isDefault: true },
    });
    expect(audit[1].after.demotedDefaultIds).toHaveLength(1);
  });

  test("update: settings.edit, swaps rates, default promotion demotes, no-op silent", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    await grant(t, owner, "owner");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    const standard = await seedRate(t, "VAT 20%", 2000);
    const reduced = await seedRate(t, "VAT 5%", 500);
    const first = await seedGroup(t, "Group A", { isDefault: true, standard });
    const second = await seedGroup(t, "Group B");

    // Swap rates + promote B → A demoted, audit says which.
    await asOwner.mutation(api.tax.updateGroup, {
      id: second,
      name: "Group B",
      isDefault: true,
      active: true,
      rates: { standard: reduced },
    });
    const groups = await t.run((ctx) => ctx.db.query("taxGroups").collect());
    expect(groups.find((group) => group._id === first)?.isDefault).toBe(false);
    expect(groups.find((group) => group._id === second)).toMatchObject({
      isDefault: true,
      rates: { standard: reduced },
    });

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "update",
      entity: "taxGroups",
      entityId: second,
      before: { name: "Group B", isDefault: false },
      after: { name: "Group B", isDefault: true, standard: reduced },
    });
    expect(audit[0].after.demotedDefaultIds).toEqual([first]);

    // Identical save records nothing.
    await asOwner.mutation(api.tax.updateGroup, {
      id: second,
      name: "Group B",
      isDefault: true,
      active: true,
      rates: { standard: reduced },
    });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);
  });
});

function groupInput(name: string) {
  return { name, isDefault: false, rates: {}, active: true };
}

/** An id of the right type whose document doesn't exist. */
async function missingRateId(t: T) {
  const id = await t.run((ctx) =>
    ctx.db.insert("taxRates", {
      name: "temp",
      rateBps: 0,
      inclusive: false,
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await t.run((ctx) => ctx.db.delete(id));
  return id;
}
