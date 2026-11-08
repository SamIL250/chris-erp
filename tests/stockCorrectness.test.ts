import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { onHandDelta, reservedDelta, type StockMovementType } from "../lib/stock";
import { setup } from "./setup";

/**
 * PH1-25 — stock stays equal to the ledger. One path walks a product
 * through two warehouses, and two reservations started together cannot
 * hold more than is free.
 */

type T = ReturnType<typeof setup>;
type As = ReturnType<T["withIdentity"]>;

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

async function asRole(t: T, roleKey: string, email = `${roleKey}@example.com`) {
  const userId = await seedUser(t, email);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

async function ledgerAt(t: T, productId: Id<"products">, warehouseId: Id<"warehouses">) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("stockMovements")
      .withIndex("by_product_warehouse", (q) =>
        q.eq("productId", productId).eq("warehouseId", warehouseId),
      )
      .collect(),
  );
  let onHand = 0;
  let reserved = 0;
  for (const row of rows) {
    onHand += onHandDelta(row.type as StockMovementType, row.qty);
    reserved += reservedDelta(row.type as StockMovementType, row.qty);
  }
  return { onHand, reserved, available: onHand - reserved, lines: rows.length };
}

async function expectPosition(
  t: T,
  as: As,
  productId: Id<"products">,
  warehouseId: Id<"warehouses">,
  expected: { onHand: number; reserved: number; available: number },
) {
  const summed = await ledgerAt(t, productId, warehouseId);
  const balance = await as.query(api.inventory.stock.balance, { productId, warehouseId });
  expect(balance.onHand).toBe(summed.onHand);
  expect(balance.reserved).toBe(summed.reserved);
  expect(balance.available).toBe(summed.available);
  expect(balance.available).toBe(balance.onHand - balance.reserved);
  expect(balance).toMatchObject(expected);
  return summed;
}

describe("stock correctness (PH1-25)", () => {
  test("receive, transfer, reserve, issue, and adjust keep the ledger equal to on-hand", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await t.run((ctx) =>
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

    await as.mutation(api.inventory.goodsReceipts.create, {
      warehouseId: main,
      referenceNote: "Opening delivery",
      lines: [{ productId, qty: 10, unitCost: 4 }],
    });
    await expectPosition(t, as, productId, main, { onHand: 10, reserved: 0, available: 10 });
    await expectPosition(t, as, productId, east, { onHand: 0, reserved: 0, available: 0 });

    const transferId = await as.mutation(api.inventory.transfers.create, {
      fromWarehouseId: main,
      toWarehouseId: east,
      lines: [{ productId, qty: 4 }],
    });
    await as.mutation(api.inventory.transfers.ship, { transferId });
    await expectPosition(t, as, productId, main, { onHand: 6, reserved: 0, available: 6 });
    await expectPosition(t, as, productId, east, { onHand: 0, reserved: 0, available: 0 });

    const transfer = await as.query(api.inventory.transfers.get, { transferId });
    const lineId = transfer.lines[0]?.lineId;
    if (lineId === undefined) throw new Error("missing transfer line");
    await as.mutation(api.inventory.transfers.receive, {
      transferId,
      lines: [{ lineId, qty: 4 }],
    });
    await expectPosition(t, as, productId, main, { onHand: 6, reserved: 0, available: 6 });
    await expectPosition(t, as, productId, east, { onHand: 4, reserved: 0, available: 4 });

    await as.mutation(api.inventory.stock.reserve, {
      productId,
      warehouseId: east,
      qty: 3,
      referenceType: "salesOrder",
      referenceId: "SO-1",
    });
    await expectPosition(t, as, productId, east, { onHand: 4, reserved: 3, available: 1 });

    await as.mutation(api.inventory.stock.post, {
      type: "issue",
      qty: -2,
      productId,
      warehouseId: main,
    });
    await expectPosition(t, as, productId, main, { onHand: 4, reserved: 0, available: 4 });

    await as.mutation(api.inventory.stock.adjust, {
      productId,
      warehouseId: east,
      qty: -1,
      reason: "damage",
      note: "Cracked foot",
    });
    const eastEnd = await expectPosition(t, as, productId, east, {
      onHand: 3,
      reserved: 3,
      available: 0,
    });
    const mainEnd = await expectPosition(t, as, productId, main, {
      onHand: 4,
      reserved: 0,
      available: 4,
    });

    expect(mainEnd.onHand + eastEnd.onHand).toBe(7);
    expect(mainEnd.lines + eastEnd.lines).toBe(6);

    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId: east,
        qty: -1,
        reason: "writeOff",
      }),
    ).rejects.toThrow(/reserved/);
    const afterRefusal = await ledgerAt(t, productId, east);
    expect(afterRefusal).toMatchObject({ onHand: 3, reserved: 3, available: 0, lines: 3 });
  });

  test("two reservations started together cannot hold more than is free", async () => {
    const t = setup();
    const first = await asRole(t, "warehouse", "one@example.com");
    const second = await asRole(t, "warehouse", "two@example.com");
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Gel",
        slug: "gel",
        sku: "GEL-1",
        status: "active" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const warehouseId = await t.run((ctx) =>
      ctx.db.insert("warehouses", {
        code: "MAIN",
        name: "Main",
        isDefault: true,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await first.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId,
      warehouseId,
    });

    const bothFit = await Promise.allSettled([
      first.mutation(api.inventory.stock.reserve, {
        productId,
        warehouseId,
        qty: 2,
        referenceType: "salesOrder",
        referenceId: "SO-1",
      }),
      second.mutation(api.inventory.stock.reserve, {
        productId,
        warehouseId,
        qty: 2,
        referenceType: "salesOrder",
        referenceId: "SO-2",
      }),
    ]);
    expect(bothFit.every((result) => result.status === "fulfilled")).toBe(true);
    await expectPosition(t, first, productId, warehouseId, {
      onHand: 5,
      reserved: 4,
      available: 1,
    });

    const raced = await Promise.allSettled([
      first.mutation(api.inventory.stock.reserve, {
        productId,
        warehouseId,
        qty: 1,
        referenceType: "salesOrder",
        referenceId: "SO-3",
      }),
      second.mutation(api.inventory.stock.reserve, {
        productId,
        warehouseId,
        qty: 1,
        referenceType: "salesOrder",
        referenceId: "SO-4",
      }),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = raced.find((result) => result.status === "rejected");
    expect(lost?.status).toBe("rejected");
    if (lost?.status === "rejected") {
      expect(String(lost.reason)).toMatch(/available to reserve/);
    }

    await expectPosition(t, first, productId, warehouseId, {
      onHand: 5,
      reserved: 5,
      available: 0,
    });
  });
});
