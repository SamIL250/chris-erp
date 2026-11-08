import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  normalizeWarehouseAddress,
  normalizeWarehouseCode,
  warehouseCodeError,
  warehouseNameError,
} from "../lib/warehouses";
import { setup } from "./setup";

/**
 * PH1-16 — warehouse master: code rules, exactly one default, inactive
 * rows stay listed, and the permission ladder.
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

describe("warehouse field rules", () => {
  test("codes uppercase and reject blanks, length, and symbols", () => {
    expect(normalizeWarehouseCode("  main ")).toBe("MAIN");
    expect(warehouseCodeError("")).toBe("Warehouse code is required.");
    expect(warehouseCodeError("A".repeat(17))).toMatch(/16 characters/);
    expect(warehouseCodeError("MAIN ST")).toMatch(/letters, numbers, and dashes/);
    expect(warehouseCodeError("wh-01")).toBeNull();
  });

  test("names trim; a blank address is absent and a long one is refused", () => {
    expect(warehouseNameError("  ")).toBe("Warehouse name is required.");
    expect(warehouseNameError("Main")).toBeNull();
    expect(normalizeWarehouseAddress("  ")).toEqual({});
    expect(normalizeWarehouseAddress("  12 Dock St ")).toEqual({ address: "12 Dock St" });
    expect(normalizeWarehouseAddress("x".repeat(501))).toEqual({
      error: "Address must be 500 characters or fewer.",
    });
  });
});

describe("warehouses CRUD", () => {
  test("the first warehouse is the default, and a second code must be unique", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");

    const first = await as.mutation(api.inventory.warehouses.create, {
      code: "main",
      name: "Main",
      isDefault: false,
      active: false,
    });
    const created = await t.run((ctx) => ctx.db.get(first.id));
    expect(created).toMatchObject({ code: "MAIN", isDefault: true, active: true });

    await expect(
      as.mutation(api.inventory.warehouses.create, {
        code: "MAIN",
        name: "Again",
        isDefault: false,
        active: true,
      }),
    ).rejects.toThrow("A warehouse with code MAIN already exists.");

    const second = await as.mutation(api.inventory.warehouses.create, {
      code: "east",
      name: "East",
      address: "  4 Pier Rd ",
      isDefault: true,
      active: true,
    });
    const rows = await as.query(api.inventory.warehouses.list, {});
    expect(rows.map((row) => row.code)).toEqual(["EAST", "MAIN"]);
    expect(rows[0]).toMatchObject({
      _id: second.id,
      isDefault: true,
      address: "4 Pier Rd",
    });
    expect(rows[1]?.isDefault).toBe(false);
  });

  test("the default cannot be dropped, deactivated, or removed while another exists", async () => {
    const t = setup();
    const as = await asRole(t, "admin");
    const main = await as.mutation(api.inventory.warehouses.create, {
      code: "MAIN",
      name: "Main",
      isDefault: true,
      active: true,
    });
    await as.mutation(api.inventory.warehouses.create, {
      code: "EAST",
      name: "East",
      isDefault: false,
      active: true,
    });

    await expect(
      as.mutation(api.inventory.warehouses.update, {
        id: main.id,
        code: "MAIN",
        name: "Main",
        isDefault: false,
        active: true,
      }),
    ).rejects.toThrow("Choose another warehouse as the default first.");

    await expect(
      as.mutation(api.inventory.warehouses.update, {
        id: main.id,
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: false,
      }),
    ).rejects.toThrow("The default warehouse has to stay active.");

    await expect(as.mutation(api.inventory.warehouses.remove, { id: main.id })).rejects.toThrow(
      "Choose another warehouse as the default before removing this one.",
    );
  });

  test("clearing the address, a no-op, and removing the last warehouse", async () => {
    const t = setup();
    const as = await asRole(t, "owner");
    const created = await as.mutation(api.inventory.warehouses.create, {
      code: "MAIN",
      name: "Main",
      address: "Dock",
      isDefault: true,
      active: true,
    });

    await as.mutation(api.inventory.warehouses.update, {
      id: created.id,
      code: "MAIN",
      name: "Main",
      address: "   ",
      isDefault: true,
      active: true,
    });
    const cleared = await t.run((ctx) => ctx.db.get(created.id));
    expect(cleared?.address).toBeUndefined();

    const before = (await t.run((ctx) => ctx.db.query("auditLog").collect())).length;
    await as.mutation(api.inventory.warehouses.update, {
      id: created.id,
      code: "main",
      name: "Main",
      isDefault: true,
      active: true,
    });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(before);

    await as.mutation(api.inventory.warehouses.remove, { id: created.id });
    expect(await as.query(api.inventory.warehouses.list, {})).toEqual([]);
  });

  test("an inactive warehouse cannot be made the default in one write", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    await as.mutation(api.inventory.warehouses.create, {
      code: "MAIN",
      name: "Main",
      isDefault: true,
      active: true,
    });
    await expect(
      as.mutation(api.inventory.warehouses.create, {
        code: "EAST",
        name: "East",
        isDefault: true,
        active: false,
      }),
    ).rejects.toThrow("An inactive warehouse can't be the default.");
  });

  test("sales may list and may not create; anonymous is refused", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    expect(await sales.query(api.inventory.warehouses.list, {})).toEqual([]);
    await expect(
      sales.mutation(api.inventory.warehouses.create, {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
      }),
    ).rejects.toThrow("You don't have permission to create inventory items.");
    await expect(
      t.mutation(api.inventory.warehouses.create, {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
      }),
    ).rejects.toThrow("Not authenticated");
  });
});
