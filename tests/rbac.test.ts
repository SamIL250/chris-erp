import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { setup } from "./setup";

/**
 * RBAC (PH0-22): deny by default, the bootstrap-owner rule, explicit grants,
 * and Owner-only role changes (docs/permissions.md rules 1 + 4).
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

const PAGE = { paginationOpts: { numItems: 10, cursor: null } };

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      name: email.split("@")[0],
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

/** Insert a role assignment directly (what `grantRole` maintains). */
async function grant(t: T, userId: Awaited<ReturnType<typeof seedUser>>, roleKey: string) {
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

async function roleKeysOf(t: T, userId: Awaited<ReturnType<typeof seedUser>>) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const keys: string[] = [];
    for (const row of rows) {
      const role = await ctx.db.get(row.roleId);
      if (role !== null) keys.push(role.key);
    }
    return keys;
  });
}

describe("requirePermission (PH0-22)", () => {
  test("unauthenticated callers are rejected", async () => {
    const t = setup();
    await expect(t.query(api.users.list, PAGE)).rejects.toThrow("Not authenticated");
    await expect(t.mutation(api.invites.create, { email: "x@example.com" })).rejects.toThrow(
      "Not authenticated",
    );
  });

  test("deny by default: an unassigned user has no module permissions", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    await grant(t, owner, "owner"); // explicit world — bootstrap claim is gone
    const staff = await seedUser(t, "staff@example.com");

    const asStaff = t.withIdentity({ subject: `${staff}|session-1` });
    await expect(asStaff.query(api.users.list, PAGE)).rejects.toThrow(
      "You don't have permission to view users items.",
    );
    await expect(
      asStaff.mutation(api.invites.create, { email: "someone@example.com" }),
    ).rejects.toThrow("You don't have permission to create users items.");
    await expect(asStaff.query(api.roles.list, {})).rejects.toThrow(
      "You don't have permission to view users items.",
    );
  });

  test("the matrix decides per role: Admin+ may use users, others may not", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const admin = await seedUser(t, "admin@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    const warehouse = await seedUser(t, "warehouse@example.com");
    await grant(t, owner, "owner");
    await grant(t, admin, "admin");
    await grant(t, sales, "sales");
    await grant(t, accountant, "accountant");
    await grant(t, warehouse, "warehouse");

    // Admin (users: view/create/edit) — can list and can invite (no role).
    const asAdmin = t.withIdentity({ subject: `${admin}|session-1` });
    const page = await asAdmin.query(api.users.list, PAGE);
    expect(page.page).toHaveLength(5);
    const invite = await asAdmin.mutation(api.invites.create, {
      email: "newbie@example.com",
    });
    expect(invite.sent).toBe(false);

    // Everyone without `users` in the matrix is denied both.
    for (const member of [sales, accountant, warehouse]) {
      const asMember = t.withIdentity({ subject: `${member}|session-1` });
      await expect(asMember.query(api.users.list, PAGE)).rejects.toThrow(
        "You don't have permission to view users items.",
      );
      await expect(
        asMember.mutation(api.invites.create, { email: `x${member}@example.com` }),
      ).rejects.toThrow("You don't have permission to create users items.");
    }
  });

  test("users.list carries each row's role keys for badges", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const admin = await seedUser(t, "admin@example.com");
    await grant(t, owner, "owner");
    await grant(t, admin, "admin");

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    const page = await asOwner.query(api.users.list, PAGE);
    const byEmail = new Map(page.page.map((u) => [u.email, u.roleKeys]));
    expect(byEmail.get("admin@example.com")).toEqual(["admin"]);
    expect(byEmail.get("owner@example.com")).toEqual(["owner"]);
  });
});

describe("users.assignRole (PH0-22)", () => {
  test("Owner may grant, change, and clear roles; the catalog is seeded", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const target = await seedUser(t, "target@example.com");
    await grant(t, owner, "owner");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    await asOwner.mutation(api.users.assignRole, { userId: target, roleKey: "sales" });
    expect(await roleKeysOf(t, target)).toEqual(["sales"]);

    await asOwner.mutation(api.users.assignRole, { userId: target, roleKey: "accountant" });
    expect(await roleKeysOf(t, target)).toEqual(["accountant"]); // replaced, not stacked

    // ensureSystemRoles seeded the whole built-in catalog.
    const roleKeys = await t.run(async (ctx) =>
      (await ctx.db.query("roles").collect()).map((r) => r.key).sort(),
    );
    expect(roleKeys).toEqual(["accountant", "admin", "owner", "sales", "warehouse"]);

    // Clearing removes the row → the user falls back to deny-by-default.
    await asOwner.mutation(api.users.assignRole, { userId: target, roleKey: null });
    expect(await roleKeysOf(t, target)).toEqual([]);
    const asTarget = t.withIdentity({ subject: `${target}|session-1` });
    await expect(asTarget.query(api.users.list, PAGE)).rejects.toThrow(
      "You don't have permission to view users items.",
    );
  });

  test("rule 4: role changes are Owner-only — Admin is refused", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const admin = await seedUser(t, "admin@example.com");
    const target = await seedUser(t, "target@example.com");
    await grant(t, owner, "owner");
    await grant(t, admin, "admin");

    const asAdmin = t.withIdentity({ subject: `${admin}|session-1` });
    // Admin holds users.edit — it's the owner gate that stops them.
    await expect(
      asAdmin.mutation(api.users.assignRole, { userId: target, roleKey: "sales" }),
    ).rejects.toThrow("Only an owner can grant or change roles.");
    expect(await roleKeysOf(t, target)).toEqual([]);
  });

  test("you can't change your own role, and unknown roles are rejected", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const target = await seedUser(t, "target@example.com");
    await grant(t, owner, "owner");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    await expect(
      asOwner.mutation(api.users.assignRole, { userId: owner, roleKey: "sales" }),
    ).rejects.toThrow("You can't change your own role.");
    await expect(
      asOwner.mutation(api.users.assignRole, { userId: target, roleKey: "wizard" }),
    ).rejects.toThrow("Unknown role.");

    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        email: "gone@example.com",
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      asOwner.mutation(api.users.assignRole, { userId: gone, roleKey: "sales" }),
    ).rejects.toThrow("This user no longer exists.");
  });
});

describe("invites.create with a role (PH0-19 → PH0-22)", () => {
  test("Owner's invite grants the role without locking the owner out", async () => {
    const t = setup();
    // Bootstrap world: earliest user, no assignment rows anywhere.
    const owner = await seedUser(t, "owner@example.com");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    await asOwner.mutation(api.invites.create, {
      email: "hire@example.com",
      role: "sales",
    });

    // The invitee (still `invited`, can't sign in yet) already holds the role.
    const invitee = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", "hire@example.com"))
        .unique(),
    );
    expect(invitee).not.toBeNull();
    expect(await roleKeysOf(t, invitee!._id)).toEqual(["sales"]);
    const invite = await t.run(async (ctx) =>
      ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", "hire@example.com"))
        .unique(),
    );
    expect(invite?.role).toBe("sales");

    // Creating the FIRST assignment row would have revoked the implicit
    // bootstrap claim — grantRole materialized the owner's row instead, so
    // the owner still passes permission checks (here: users.view).
    expect(await roleKeysOf(t, owner)).toEqual(["owner"]);
    const page = await asOwner.query(api.users.list, PAGE);
    expect(page.page).toHaveLength(2);
  });

  test("Admin may invite without a role but not grant one", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const admin = await seedUser(t, "admin@example.com");
    await grant(t, owner, "owner");
    await grant(t, admin, "admin");
    const asAdmin = t.withIdentity({ subject: `${admin}|session-1` });

    const ok = await asAdmin.mutation(api.invites.create, { email: "plain@example.com" });
    expect(ok.sent).toBe(false);
    const plain = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", "plain@example.com"))
        .unique(),
    );
    expect(await roleKeysOf(t, plain!._id)).toEqual([]);

    await expect(
      asAdmin.mutation(api.invites.create, { email: "withrole@example.com", role: "sales" }),
    ).rejects.toThrow("Only an owner can grant or change roles.");
    await expect(
      asAdmin.mutation(api.invites.create, { email: "badrole@example.com", role: "wizard" }),
    ).rejects.toThrow("Unknown role.");
  });
});

describe("users:me + roles:list (PH0-22)", () => {
  test("me resolves effective roles with labels; bootstrap counts as Owner", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const admin = await seedUser(t, "admin@example.com");
    await grant(t, admin, "admin");

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    // Rows exist (admin's), so bootstrap is off — owner gets deny-by-default
    // here too... unless the owner also has an explicit row.
    const bootstrapped = await asOwner.query(api.users.me, {});
    expect(bootstrapped?.roles).toEqual([]);

    await grant(t, owner, "owner");
    const asOwner2 = t.withIdentity({ subject: `${owner}|session-1` });
    const me = await asOwner2.query(api.users.me, {});
    expect(me?.roles).toEqual([{ key: "owner", name: "Owner" }]);

    const asAdmin = t.withIdentity({ subject: `${admin}|session-1` });
    const meAdmin = await asAdmin.query(api.users.me, {});
    expect(meAdmin?.roles).toEqual([{ key: "admin", name: "Admin" }]);
  });

  test("roles:list returns the catalog to users who can view users", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    await grant(t, owner, "owner");

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    const roles = await asOwner.query(api.roles.list, {});
    expect(roles.map((r) => r.key)).toEqual(["owner", "admin", "sales", "warehouse", "accountant"]);
    expect(roles[0].name).toBe("Owner");
  });
});
