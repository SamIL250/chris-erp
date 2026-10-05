import { describe, expect, test } from "vitest";
import { notify } from "../convex/_lib/notifications";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SYSTEM_ROLES } from "../lib/permissions";
import { setup } from "./setup";

/**
 * Notification center (PH0-28): notify() inserts, list/countUnread/markRead/
 * markAllRead are session-scoped (own rows only), and a real event — a role
 * change — notifies the target through the same transaction.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

const PAGE = (numItems = 50, cursor: string | null = null) => ({
  paginationOpts: { numItems, cursor },
});

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

describe("notify helper (PH0-28)", () => {
  test("inserts a notification with title/body/kind/href", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");

    await t.run((ctx) =>
      notify(ctx, {
        userId: user,
        title: "Order shipped",
        body: "SO-0001 left the warehouse.",
        kind: "success",
        href: "/sales/orders",
      }),
    );

    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user,
      title: "Order shipped",
      body: "SO-0001 left the warehouse.",
      kind: "success",
      href: "/sales/orders",
    });
    expect(rows[0].readAt).toBeUndefined();
    expect(typeof rows[0].createdAt).toBe("number");
  });
});

describe("notifications queries + read state (PH0-28)", () => {
  test("needs a session", async () => {
    const t = setup();
    await expect(t.query(api.notifications.list, PAGE())).rejects.toThrow("Not authenticated");
    await expect(t.query(api.notifications.countUnread, {})).rejects.toThrow("Not authenticated");
    await expect(t.mutation(api.notifications.markRead, { ids: [] })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(t.mutation(api.notifications.markAllRead, {})).rejects.toThrow(
      "Not authenticated",
    );
  });

  test("list: own rows only, newest first, paginated", async () => {
    const t = setup();
    const ada = await seedUser(t, "ada@example.com");
    const other = await seedUser(t, "other@example.com");

    await t.run(async (ctx) => {
      // Deterministic timestamps so order can't tie.
      const base = Date.now() - 10_000;
      for (const [i, title] of ["first", "second", "third"].entries()) {
        await ctx.db.insert("notifications", { userId: ada, title, createdAt: base + i * 1000 });
      }
      await ctx.db.insert("notifications", {
        userId: other,
        title: "not yours",
        createdAt: base + 3000,
      });
    });

    const asAda = t.withIdentity({ subject: `${ada}|session-1` });
    const page1 = await asAda.query(api.notifications.list, PAGE(2));
    expect(page1.page.map((row) => row.title)).toEqual(["third", "second"]);
    expect(page1.isDone).toBe(false);
    const page2 = await asAda.query(api.notifications.list, PAGE(2, page1.continueCursor));
    expect(page2.page.map((row) => row.title)).toEqual(["first"]);
    expect(page2.isDone).toBe(true);
  });

  test("countUnread → markRead (foreign ids ignored) → markAllRead", async () => {
    const t = setup();
    const ada = await seedUser(t, "ada@example.com");
    const other = await seedUser(t, "other@example.com");

    await t.run(async (ctx) => {
      for (const title of ["a", "b", "c"]) {
        await notify(ctx, { userId: ada, title });
      }
      await notify(ctx, { userId: other, title: "foreign" });
    });
    const ids = (await t.run((ctx) => ctx.db.query("notifications").collect()))
      .filter((row) => row.userId === ada)
      .map((row) => row._id);

    const asAda = t.withIdentity({ subject: `${ada}|session-1` });
    expect(await asAda.query(api.notifications.countUnread, {})).toBe(3);

    // Read one of mine + someone else's id — only mine changes.
    const foreign = await t.run((ctx) => ctx.db.query("notifications").collect());
    const foreignId = foreign.find((row) => row.userId !== ada)!._id;
    await asAda.mutation(api.notifications.markRead, { ids: [ids[0], foreignId] });

    expect(await asAda.query(api.notifications.countUnread, {})).toBe(2);
    const after = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(after.find((row) => row._id === foreignId)?.readAt).toBeUndefined();
    expect(after.find((row) => row._id === ids[0])?.readAt).toBeTypeOf("number");

    await asAda.mutation(api.notifications.markAllRead, {});
    expect(await asAda.query(api.notifications.countUnread, {})).toBe(0);
    // The other user's row is still unread.
    expect(
      (await t.run((ctx) => ctx.db.query("notifications").collect())).find(
        (row) => row._id === foreignId,
      )?.readAt,
    ).toBeUndefined();
  });
});

describe("role change notifies the target (PH0-28)", () => {
  test("granting and removing a role each produce a notification", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const target = await seedUser(t, "target@example.com");
    await grant(t, owner, "owner");

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await asOwner.mutation(api.users.assignRole, { userId: target, roleKey: "sales" });
    await asOwner.mutation(api.users.assignRole, { userId: target, roleKey: null });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user_time", (q) => q.eq("userId", target))
        .order("desc")
        .collect(),
    );
    expect(rows).toHaveLength(2);

    const salesName = SYSTEM_ROLES.find((role) => role.key === "sales")?.name ?? "sales";
    expect(rows[0]).toMatchObject({
      title: "Your role was removed",
      kind: "warning",
      href: "/settings/profile",
    });
    expect(rows[1].title).toBe(`You now have the ${salesName} role`);
    expect(rows[1].kind).toBe("info");

    // The owner isn't notified — only the target.
    const ownerRows = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user_time", (q) => q.eq("userId", owner))
        .collect(),
    );
    expect(ownerRows).toHaveLength(0);
  });

  test("a denied role change notifies nobody", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const admin = await seedUser(t, "admin@example.com");
    const target = await seedUser(t, "target@example.com");
    await grant(t, owner, "owner");
    await grant(t, admin, "admin");

    const asAdmin = t.withIdentity({ subject: `${admin}|session-1` });
    await expect(
      asAdmin.mutation(api.users.assignRole, { userId: target, roleKey: "sales" }),
    ).rejects.toThrow();

    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(0);
  });
});
