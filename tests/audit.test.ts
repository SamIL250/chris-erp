import { describe, expect, test } from "vitest";
import { appendAudit, REDACTED, redact } from "../convex/_lib/audit";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Audit trail (PH0-26): redaction, audited mutations (append-only,
 * actor-resolved, nothing recorded on failure), and the viewer queries
 * (settings.view gate + actor/entity/date filters).
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

const PAGE = (numItems = 50) => ({ paginationOpts: { numItems, cursor: null } });

async function seedUser(t: T, email: string, name?: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      ...(name !== undefined ? { name } : {}),
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

/** Direct role assignment (what `grantRole` maintains). */
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

async function auditRows(t: T) {
  return await t.run((ctx) => ctx.db.query("auditLog").order("asc").collect());
}

describe("redact (PH0-26)", () => {
  test("masks credential-shaped keys anywhere in a snapshot", () => {
    expect(
      redact({
        name: "Ada",
        passwordHash: "scrypt$…",
        nested: { apiKey: "k", token: "t", roles: ["owner"], deep: { code: "c" } },
        list: [{ phone: "+1", secretValue: "s" }],
      }),
    ).toEqual({
      name: "Ada",
      passwordHash: REDACTED,
      nested: { apiKey: REDACTED, token: REDACTED, roles: ["owner"], deep: { code: REDACTED } },
      list: [{ phone: "+1", secretValue: REDACTED }],
    });
  });

  test("leaves primitives, null, and unrelated fields alone", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(null)).toBeNull();
    expect(redact({ currencyCode: "USD", taxId: "DE…" })).toEqual({
      currencyCode: "USD",
      taxId: "DE…",
    });
  });
});

describe("audited mutations (PH0-26)", () => {
  test("updateProfile: actor-resolved entry; failures and no-ops record nothing", async () => {
    const t = setup();
    const ada = await seedUser(t, "ada@example.com", "Ada");
    const asAda = t.withIdentity({ subject: `${ada}|session-1` });

    // Invalid input throws ⇒ handler never completes ⇒ no entry.
    await expect(asAda.mutation(api.users.updateProfile, { name: "" })).rejects.toThrow();
    expect(await auditRows(t)).toHaveLength(0);

    await asAda.mutation(api.users.updateProfile, { name: "Ada L." });
    const afterFirst = await auditRows(t);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      action: "update",
      entity: "users",
      entityId: ada,
      actorId: ada,
      actorLabel: "ada@example.com",
      before: { name: "Ada" },
      after: { name: "Ada L." },
    });

    // Saving the same name again isn't worth an entry.
    await asAda.mutation(api.users.updateProfile, { name: "Ada L." });
    expect(await auditRows(t)).toHaveLength(1);
  });

  test("assignRole: before/after role keys; a denied attempt appends nothing", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const admin = await seedUser(t, "admin@example.com");
    const target = await seedUser(t, "target@example.com");
    await grant(t, owner, "owner");
    await grant(t, admin, "admin");

    // Admin holds users.edit but not the owner gate — denied ⇒ no entry.
    const asAdmin = t.withIdentity({ subject: `${admin}|session-1` });
    await expect(
      asAdmin.mutation(api.users.assignRole, { userId: target, roleKey: "sales" }),
    ).rejects.toThrow();
    expect(await auditRows(t)).toHaveLength(0);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await asOwner.mutation(api.users.assignRole, { userId: target, roleKey: "sales" });
    const rows = await auditRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "roleChange",
      entity: "users",
      entityId: target,
      actorId: owner,
      actorLabel: "owner@example.com",
      before: { roles: [] },
      after: { roles: ["sales"] },
    });
  });

  test("invites.create: records the invite (with role) for the invited profile", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    await asOwner.mutation(api.invites.create, {
      email: "hire@example.com",
      role: "warehouse",
    });
    const invitee = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", "hire@example.com"))
        .unique(),
    );
    expect(invitee).not.toBeNull();

    const rows = await auditRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "invite",
      entity: "users",
      entityId: invitee!._id,
      actorId: owner,
      after: { status: "invited", email: "hire@example.com", role: "warehouse" },
    });
    expect(rows[0].before).toBeUndefined(); // profile created, not re-invited
  });
});

describe("audit viewer queries (PH0-26)", () => {
  test("settings.view gates the log — unauthenticated and Sales are refused", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");

    await expect(
      t.query(api.audit.list, { ...PAGE(), actorId: null, entity: null, from: null, to: null }),
    ).rejects.toThrow("Not authenticated");

    const asSales = t.withIdentity({ subject: `${sales}|session-1` });
    const denied = "You don't have permission to view settings items.";
    await expect(
      asSales.query(api.audit.list, {
        ...PAGE(),
        actorId: null,
        entity: null,
        from: null,
        to: null,
      }),
    ).rejects.toThrow(denied);
    await expect(asSales.query(api.audit.actors, {})).rejects.toThrow(denied);
    await expect(asSales.query(api.audit.entities, {})).rejects.toThrow(denied);
  });

  test("Accountant (settings.view, no users.view) can filter by actor/entity/date", async () => {
    const t = setup();
    const accountant = await seedUser(t, "accountant@example.com");
    const one = await seedUser(t, "one@example.com");
    const two = await seedUser(t, "two@example.com");
    await grant(t, accountant, "accountant");

    await t.run(async (ctx) => {
      const rows = [
        {
          actorId: one,
          actorLabel: "one@example.com",
          action: "update",
          entity: "users",
          entityId: "a",
          createdAt: 1000,
        },
        {
          actorId: two,
          actorLabel: "two@example.com",
          action: "create",
          entity: "products",
          entityId: "b",
          createdAt: 2000,
        },
        {
          actorId: one,
          actorLabel: "one@example.com",
          action: "update",
          entity: "users",
          entityId: "c",
          createdAt: 3000,
        },
        {
          actorLabel: "system",
          action: "housekeeping",
          entity: "jobs",
          entityId: "d",
          createdAt: 4000,
        },
      ] as const;
      for (const row of rows) await ctx.db.insert("auditLog", { ...row });
    });

    const asAccountant = t.withIdentity({ subject: `${accountant}|session-1` });
    const list = (
      filters: {
        actorId?: Id<"users"> | null;
        entity?: string | null;
        from?: number | null;
        to?: number | null;
      },
      numItems = 50,
    ) =>
      asAccountant.query(api.audit.list, {
        ...PAGE(numItems),
        actorId: filters.actorId ?? null,
        entity: filters.entity ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
      });

    // Newest first, everything visible.
    const all = await list({});
    expect(all.page.map((row) => row.entityId)).toEqual(["d", "c", "b", "a"]);

    const byActor = await list({ actorId: one });
    expect(byActor.page.map((row) => row.entityId)).toEqual(["c", "a"]);

    const byEntity = await list({ entity: "products" });
    expect(byEntity.page.map((row) => row.entityId)).toEqual(["b"]);

    const ranged = await list({ from: 1500, to: 2500 });
    expect(ranged.page.map((row) => row.entityId)).toEqual(["b"]);

    const since = await list({ from: 3500 });
    expect(since.page.map((row) => row.entityId)).toEqual(["d"]);

    // Pagination walks the index in order.
    const firstPage = await list({}, 2);
    expect(firstPage.page.map((row) => row.entityId)).toEqual(["d", "c"]);
    expect(firstPage.isDone).toBe(false);
    const secondPage = await asAccountant.query(api.audit.list, {
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
      actorId: null,
      entity: null,
      from: null,
      to: null,
    });
    expect(secondPage.page.map((row) => row.entityId)).toEqual(["b", "a"]);
    expect(secondPage.isDone).toBe(true);
  });

  test("actors/entities summarize the log (system entries skipped as actors)", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const one = await seedUser(t, "one@example.com");
    const two = await seedUser(t, "two@example.com");
    await grant(t, owner, "owner");

    await t.run(async (ctx) => {
      const rows = [
        {
          actorId: one,
          actorLabel: "one@example.com",
          action: "update",
          entity: "users",
          entityId: "a",
          createdAt: 1000,
        },
        {
          actorId: two,
          actorLabel: "two@example.com",
          action: "create",
          entity: "catalog",
          entityId: "b",
          createdAt: 2000,
        },
        {
          actorId: one,
          actorLabel: "one@example.com",
          action: "update",
          entity: "users",
          entityId: "c",
          createdAt: 3000,
        },
        {
          actorLabel: "system",
          action: "housekeeping",
          entity: "jobs",
          entityId: "d",
          createdAt: 4000,
        },
      ] as const;
      for (const row of rows) await ctx.db.insert("auditLog", { ...row });
    });

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    expect(await asOwner.query(api.audit.actors, {})).toEqual([
      { id: one, label: "one@example.com" },
      { id: two, label: "two@example.com" },
    ]);
    expect(await asOwner.query(api.audit.entities, {})).toEqual(["catalog", "jobs", "users"]);
  });

  test("appendAudit without an identity records a system entry, redacted", async () => {
    const t = setup();
    await t.run((ctx) =>
      appendAudit(ctx, {
        entity: "sequences",
        action: "reset",
        entityId: "invoice",
        before: { next: 7, passwordHash: "nope" },
      }),
    );
    const rows = await auditRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBeUndefined();
    expect(rows[0].actorLabel).toBe("system");
    expect(rows[0].before).toEqual({ next: 7, passwordHash: REDACTED });
  });
});
