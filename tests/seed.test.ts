import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SYSTEM_ROLES } from "../lib/permissions";
import { setup } from "./setup";

/**
 * Demo-data seed (PH0-34): Owner-only (settings.create then rule 4), fully
 * idempotent — second run creates nothing and records no audit entry — and
 * strictly additive (never overwrites your org, currencies, rates, roles).
 * Invite URLs are returned in the result only, never audited.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string, status: "active" | "invited" | "disabled" = "active") {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      status,
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

async function roleKeyOf(t: T, userId: Id<"users">): Promise<string | null> {
  return await t.run(async (ctx) => {
    const assignment = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (assignment === null) return null;
    const role = await ctx.db.get(assignment.roleId);
    return role?.key ?? null;
  });
}

async function userByEmail(t: T, email: string) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(1);
    return rows[0];
  });
}

describe("seed gates (PH0-34)", () => {
  test("authenticated Owner only — settings.create first, then rule 4", async () => {
    const t = setup();

    await expect(t.mutation(api.seed.seed, {})).rejects.toThrow("Not authenticated");

    const sales = await seedUser(t, "sales@example.com");
    await grant(t, sales, "sales");
    await expect(
      t.withIdentity({ subject: `${sales}|session-1` }).mutation(api.seed.seed, {}),
    ).rejects.toThrow("You don't have permission to create settings items.");

    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, accountant, "accountant");
    await expect(
      t.withIdentity({ subject: `${accountant}|session-1` }).mutation(api.seed.seed, {}),
    ).rejects.toThrow("You don't have permission to create settings items.");

    // Admin passes settings.create but fails the Owner check (rule 4) —
    // seeding grants roles.
    const admin = await seedUser(t, "admin@example.com");
    await grant(t, admin, "admin");
    await expect(
      t.withIdentity({ subject: `${admin}|session-1` }).mutation(api.seed.seed, {}),
    ).rejects.toThrow("Only an owner can grant or change roles.");

    expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(3);
  });
});

describe("seed (PH0-34)", () => {
  test("fresh run creates everything once; second run is a no-op", async () => {
    const t = setup();
    const owner = await seedUser(t, "boss@example.com");
    await grant(t, owner, "owner");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    const first = await asOwner.mutation(api.seed.seed, {});
    expect(first.created).toEqual({
      organization: 1,
      currencies: 3,
      taxRates: 3,
      sequences: 11,
      users: SYSTEM_ROLES.length,
      categories: 5,
      products: 7,
    });
    expect(first.invites).toHaveLength(SYSTEM_ROLES.length);
    for (const invite of first.invites) {
      expect(invite.url).toContain("/invite?email=");
      expect(invite.url).toContain("code=");
    }

    // Demo org + settings.
    const orgs = await t.run((ctx) => ctx.db.query("organizations").collect());
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ name: "Chris Trading Ltd", baseCurrency: "USD" });
    expect(await t.run((ctx) => ctx.db.query("sequences").collect())).toHaveLength(11);

    // One invited user per role, each holding exactly that role.
    for (const role of SYSTEM_ROLES) {
      const user = await userByEmail(t, `${role.key}@example.com`);
      expect(user?.status).toBe("invited");
      expect(await roleKeyOf(t, user!._id)).toBe(role.key);
    }

    // Audit: counts + emails only — no invite URLs, no codes.
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "seed",
      entityId: "demo-data",
      actorLabel: "boss@example.com",
      after: { invited: SYSTEM_ROLES.map((role) => `${role.key}@example.com`) },
    });
    expect(audit[0].after.created).toEqual(first.created);
    const auditJson = JSON.stringify(audit[0].after);
    expect(auditJson).not.toContain("invite?email=");
    expect(auditJson).not.toContain("code=");

    // Idempotent: everything already exists → nothing created, no audit.
    const second = await asOwner.mutation(api.seed.seed, {});
    expect(second.created).toEqual({});
    expect(second.invites).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(
      1 + SYSTEM_ROLES.length,
    );
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);
  });

  test("additive only: skips your data, never clobbers roles, leaves disabled alone", async () => {
    const t = setup();
    const boss = await seedUser(t, "boss@example.com");
    await grant(t, boss, "owner");

    // Pre-existing data seed must respect.
    await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "My Real Company",
        baseCurrency: "EUR",
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("currencies", {
        code: "USD",
        name: "US Dollar",
        decimalPlaces: 2,
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("taxRates", {
        name: "Standard rate",
        rateBps: 2100,
        inclusive: false,
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const warehouse = await seedUser(t, "warehouse@example.com");
    await grant(t, warehouse, "sales"); // deliberate role → must survive
    const accountant = await seedUser(t, "accountant@example.com"); // no role yet
    const disabled = await seedUser(t, "owner@example.com", "disabled");

    const asBoss = t.withIdentity({ subject: `${boss}|session-1` });
    const result = await asBoss.mutation(api.seed.seed, {});

    expect(result.created).toEqual({
      currencies: 2, // EUR + GBP only — USD already there
      taxRates: 2, // Reduced + Zero only
      sequences: 11,
      users: 2, // admin + sales; owner is disabled, warehouse exists
      roleGrants: 1, // accountant only
      categories: 5, // demo tree — nothing pre-existed
      products: 7,
    });
    expect(result.invites.map((invite) => invite.email)).toEqual([
      "admin@example.com",
      "sales@example.com",
    ]);

    // Never clobbered, never touched the disabled account.
    expect(await roleKeyOf(t, warehouse)).toBe("sales");
    expect(await roleKeyOf(t, accountant)).toBe("accountant");
    expect(await roleKeyOf(t, disabled)).toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.query("invites").collect())).some(
        (invite) => invite.email === "owner@example.com",
      ),
    ).toBe(false);

    // Your org, currency, and rate survived unchanged.
    const orgs = await t.run((ctx) => ctx.db.query("organizations").collect());
    expect(orgs).toHaveLength(1);
    expect(orgs[0].name).toBe("My Real Company");
    expect(orgs[0].baseCurrency).toBe("EUR");
    expect(await t.run((ctx) => ctx.db.query("currencies").collect())).toHaveLength(3);
    const standard = await t.run((ctx) => ctx.db.query("taxRates").collect());
    expect(standard).toHaveLength(3);
    expect(standard.find((rate) => rate.name === "Standard rate")?.rateBps).toBe(2100);
  });
});
