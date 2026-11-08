import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * PH1-23 — the stock list query. Warehouse and category are applied
 * before the rows leave the server. Low stock is a reorder point
 * (PH1-24): a slice with no point is never low.
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

describe("stock positions (PH1-23)", () => {
  test("filters by warehouse, category, and reorder point", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const categoryId = await t.run((ctx) =>
      ctx.db.insert("categories", {
        name: "Gels",
        slug: "gels",
        visible: true,
        position: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const gel = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Gel",
        slug: "gel",
        sku: "GEL-1",
        status: "active" as const,
        categoryIds: [categoryId],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const stand = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Stand",
        slug: "stand",
        sku: "STAND-1",
        status: "active" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const main = await t.run((ctx) =>
      ctx.db.insert("warehouses", {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const east = await t.run((ctx) =>
      ctx.db.insert("warehouses", {
        code: "EAST",
        name: "East",
        isDefault: false,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId: gel,
      warehouseId: main,
    });
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 1,
      productId: gel,
      warehouseId: east,
    });
    await as.mutation(api.inventory.stock.post, {
      type: "issue",
      qty: -1,
      productId: gel,
      warehouseId: east,
    });
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 3,
      productId: stand,
      warehouseId: main,
    });

    const before = await as.query(api.inventory.stock.positions, {});
    expect(before.every((row) => row.lowStock === false)).toBe(true);

    await as.mutation(api.inventory.reorderPoints.set, { productId: gel, qty: 1 });

    const all = await as.query(api.inventory.stock.positions, {});
    expect(all.map((row) => `${row.warehouseCode}:${row.sku}:${row.available}`)).toEqual([
      "EAST:GEL-1:0",
      "MAIN:GEL-1:5",
      "MAIN:STAND-1:3",
    ]);
    expect(all.find((row) => row.sku === "GEL-1" && row.warehouseCode === "EAST")?.lowStock).toBe(
      true,
    );
    expect(all.find((row) => row.sku === "GEL-1" && row.warehouseCode === "MAIN")?.lowStock).toBe(
      false,
    );
    expect(all.find((row) => row.sku === "STAND-1")?.reorderPoint).toBeUndefined();

    const atMain = await as.query(api.inventory.stock.positions, { warehouseId: main });
    expect(atMain.map((row) => row.sku)).toEqual(["GEL-1", "STAND-1"]);

    const gels = await as.query(api.inventory.stock.positions, { categoryId });
    expect(gels.map((row) => row.sku)).toEqual(["GEL-1", "GEL-1"]);

    const low = await as.query(api.inventory.stock.positions, { lowStock: true });
    expect(low.map((row) => `${row.warehouseCode}:${row.sku}`)).toEqual(["EAST:GEL-1"]);
  });
});
