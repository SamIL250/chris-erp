import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isLowStock, reorderPointFor, reorderQtyError } from "../lib/reorder";
import { setup } from "./setup";

/**
 * PH1-24 — reorder points and the daily low-stock scan. A point is
 * per product, with an optional warehouse override. The scan notifies
 * once per dip and again only after the slice has recovered.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string, status: "active" | "invited" | "disabled" = "active") {
  return await t.run((ctx) =>
    ctx.db.insert("users", { email, status, createdAt: 1, updatedAt: 1 }),
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
  return { userId, as: t.withIdentity({ subject: `${userId}|session-1` }) };
}

async function product(t: T, sku: string) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: sku,
      slug: sku.toLowerCase(),
      sku,
      status: "active" as const,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function warehouse(t: T, code: string, active = true) {
  return await t.run((ctx) =>
    ctx.db.insert("warehouses", {
      code,
      name: code,
      isDefault: code === "MAIN",
      active,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("reorder point rules", () => {
  test("rejects a bad quantity and picks the warehouse point", () => {
    expect(reorderQtyError(Number.NaN)).toMatch(/number/);
    expect(reorderQtyError(-1)).toMatch(/negative/);
    expect(reorderQtyError(1_000_000_001)).toMatch(/too large/);
    expect(reorderQtyError(0)).toBeNull();

    const points = [
      { productId: "p", qty: 10 },
      { productId: "p", warehouseId: "east", qty: 2 },
    ];
    expect(reorderPointFor(points, "p", "east")).toBe(2);
    expect(reorderPointFor(points, "p", "main")).toBe(10);
    expect(reorderPointFor(points, "other", "main")).toBeUndefined();
    expect(isLowStock(2, 2)).toBe(true);
    expect(isLowStock(2.001, 2)).toBe(false);
    expect(isLowStock(0, undefined)).toBe(false);
  });
});

describe("reorder points (PH1-24)", () => {
  test("set upserts, clear removes, and sales cannot write", async () => {
    const t = setup();
    const { as } = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const gel = await product(t, "GEL-1");
    const east = await warehouse(t, "EAST");

    await expect(
      sales.as.mutation(api.inventory.reorderPoints.set, { productId: gel, qty: 1 }),
    ).rejects.toThrow(/permission/);
    await expect(
      as.mutation(api.inventory.reorderPoints.set, { productId: gel, qty: -1 }),
    ).rejects.toThrow(/negative/);
    await expect(
      as.mutation(api.inventory.reorderPoints.set, {
        productId: gel,
        warehouseId: east,
        qty: 1,
      }),
    ).resolves.toBeDefined();

    const cold = await warehouse(t, "COLD", false);
    await expect(
      as.mutation(api.inventory.reorderPoints.set, {
        productId: gel,
        warehouseId: cold,
        qty: 1,
      }),
    ).rejects.toThrow(/inactive/);

    await as.mutation(api.inventory.reorderPoints.set, { productId: gel, qty: 4 });
    await as.mutation(api.inventory.reorderPoints.set, { productId: gel, qty: 6 });
    const points = await as.query(api.inventory.reorderPoints.forProduct, { productId: gel });
    expect(points.map((row) => row.qty).sort((a, b) => a - b)).toEqual([1, 6]);
    expect(points.find((row) => row.warehouseId === east)?.qty).toBe(1);
    expect(points.find((row) => row.warehouseId === undefined)?.qty).toBe(6);

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.some((row) => row.entity === "reorderPoints" && row.after !== undefined)).toBe(
      true,
    );

    await as.mutation(api.inventory.reorderPoints.clear, { productId: gel });
    await expect(
      as.mutation(api.inventory.reorderPoints.clear, { productId: gel }),
    ).rejects.toThrow(/No reorder point is set/);
    const left = await as.query(api.inventory.reorderPoints.forProduct, { productId: gel });
    expect(left).toEqual([{ warehouseId: east, qty: 1 }]);
  });

  test("a warehouse point wins, and the daily scan notifies once per dip", async () => {
    const t = setup();
    const warehouseUser = await asRole(t, "warehouse");
    const owner = await asRole(t, "owner");
    const sales = await asRole(t, "sales");
    const disabledId = await seedUser(t, "gone@example.com", "disabled");
    await grant(t, disabledId, "owner");

    const gel = await product(t, "GEL-1");
    const bare = await product(t, "BARE-1");
    const main = await warehouse(t, "MAIN");
    const east = await warehouse(t, "EAST");
    const closed = await warehouse(t, "OLD", false);

    await warehouseUser.as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId: gel,
      warehouseId: main,
    });
    await warehouseUser.as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId: gel,
      warehouseId: east,
    });
    await t.run((ctx) =>
      ctx.db.insert("stockMovements", {
        type: "receipt",
        qty: 5,
        productId: gel,
        warehouseId: closed,
        serialIds: [],
        actorId: warehouseUser.userId,
        createdAt: 1,
      }),
    );
    await warehouseUser.as.mutation(api.inventory.reorderPoints.set, { productId: gel, qty: 10 });
    await warehouseUser.as.mutation(api.inventory.reorderPoints.set, {
      productId: gel,
      warehouseId: east,
      qty: 2,
    });
    await t.run((ctx) =>
      ctx.db.insert("reorderPoints", {
        productId: bare,
        qty: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    const rows = await warehouseUser.as.query(api.inventory.stock.positions, {});
    const at = (code: string) =>
      rows.find((row) => row.sku === "GEL-1" && row.warehouseCode === code);
    expect(at("MAIN")?.lowStock).toBe(true);
    expect(at("EAST")?.lowStock).toBe(false);
    expect(at("OLD")?.lowStock).toBe(false);

    await t.mutation(internal.inventory.lowStock.scan, {});
    const first = await t.run((ctx) => ctx.db.query("notifications").collect());
    const titles = (userId: Id<"users">) =>
      first.filter((row) => row.userId === userId).map((row) => row.title);
    expect(titles(warehouseUser.userId).sort()).toEqual([
      "Low stock: BARE-1",
      "Low stock: BARE-1",
      "Low stock: GEL-1",
    ]);
    expect(titles(owner.userId)).toHaveLength(3);
    expect(titles(sales.userId)).toEqual([]);
    expect(titles(disabledId)).toEqual([]);
    const gelNote = first.find(
      (row) => row.userId === owner.userId && row.title === "Low stock: GEL-1",
    );
    expect(gelNote?.body).toMatch(/MAIN/);
    expect(gelNote?.body).toMatch(/Reorder at 10/);
    expect(gelNote?.href).toBe(`/inventory/stock/${gel}?warehouse=${main}`);
    expect(first.some((row) => row.body?.includes("OLD"))).toBe(false);

    await t.mutation(internal.inventory.lowStock.scan, {});
    const second = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(second).toHaveLength(first.length);

    await warehouseUser.as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 6,
      productId: gel,
      warehouseId: main,
    });
    await t.mutation(internal.inventory.lowStock.scan, {});
    const recovered = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(recovered).toHaveLength(first.length);
    const notices = await t.run((ctx) => ctx.db.query("lowStockNotices").collect());
    expect(notices.find((row) => row.productId === gel && row.warehouseId === main)?.open).toBe(
      false,
    );
    expect(notices.find((row) => row.productId === bare)?.open).toBe(true);

    await warehouseUser.as.mutation(api.inventory.stock.post, {
      type: "issue",
      qty: -6,
      productId: gel,
      warehouseId: main,
    });
    await t.mutation(internal.inventory.lowStock.scan, {});
    const dipped = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(
      dipped.filter((row) => row.userId === owner.userId && row.title === "Low stock: GEL-1"),
    ).toHaveLength(2);
  });

  test("refuses a scan that cannot see the whole ledger", async () => {
    const t = setup();
    const actorId = await seedUser(t, "scan@example.com");
    const gel = await product(t, "GEL-1");
    const main = await warehouse(t, "MAIN");
    await t.run(async (ctx) => {
      for (let i = 0; i < 5001; i += 1) {
        await ctx.db.insert("stockMovements", {
          type: "receipt",
          qty: 1,
          productId: gel,
          warehouseId: main,
          serialIds: [],
          actorId,
          createdAt: i,
        });
      }
    });
    await expect(t.mutation(internal.inventory.lowStock.scan, {})).rejects.toThrow(
      /Too many stock movements/,
    );
  });
});
