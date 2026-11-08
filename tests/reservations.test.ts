import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { allocateStock, postMovement, releaseStock, reserveStock } from "../convex/inventory/stock";
import { setup } from "./setup";

/**
 * PH1-19 — reservation engine. A hold is checked against the lines
 * already written in this transaction, so a second reserve cannot take
 * stock the first one claimed. Allocate is a release plus an issue.
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

async function seedProduct(t: T) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: "Held item",
      slug: "held-item",
      sku: "HELD-1",
      status: "active" as const,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedWarehouse(t: T) {
  return await t.run((ctx) =>
    ctx.db.insert("warehouses", {
      code: "MAIN",
      name: "Main",
      isDefault: true,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("reservation engine (PH1-19)", () => {
  test("a second hold cannot take more than what is still available", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId,
      warehouseId,
    });

    const first = await as.mutation(api.inventory.stock.reserve, {
      productId,
      warehouseId,
      qty: 4,
      referenceType: "salesOrder",
      referenceId: "SO-1",
    });
    await expect(
      as.mutation(api.inventory.stock.reserve, {
        productId,
        warehouseId,
        qty: 2,
        referenceType: "salesOrder",
        referenceId: "SO-2",
      }),
    ).rejects.toThrow("Only 1 available to reserve.");

    const rows = await as.query(api.inventory.stock.list, { productId, warehouseId });
    const reservations = rows.filter((row) => row.type === "reservation");
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?._id).toBe(first);
    expect(reservations[0]?.qty).toBe(4);
    expect(await as.query(api.inventory.stock.balance, { productId, warehouseId })).toMatchObject({
      onHand: 5,
      reserved: 4,
      available: 1,
    });

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const holdAudit = audits.find((entry) => entry.entityId === first);
    expect(holdAudit?.action).toBe("create");
    expect(holdAudit?.entity).toBe("stockMovements");
    expect(holdAudit?.before).toBeUndefined();
  });

  test("two holds in one transaction see each other, and a thrown order keeps none", async () => {
    const t = setup();
    const actorId = await seedUser(t, "picker@example.com");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const shared = { productId, warehouseId, actorId, referenceType: "salesOrder" };

    await t.run(async (ctx) => {
      await postMovement(ctx, { type: "receipt", qty: 5, productId, warehouseId, actorId });
      await reserveStock(ctx, { ...shared, qty: 4, referenceId: "SO-A" });
      await expect(reserveStock(ctx, { ...shared, qty: 2, referenceId: "SO-B" })).rejects.toThrow(
        "Only 1 available to reserve.",
      );
    });

    const held = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(held.filter((row) => row.type === "reservation")).toHaveLength(1);

    await expect(
      t.run(async (ctx) => {
        await reserveStock(ctx, { ...shared, qty: 1, referenceId: "SO-ROLL" });
        throw new Error("order failed");
      }),
    ).rejects.toThrow("order failed");

    const after = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(after.filter((row) => row.referenceId === "SO-ROLL")).toEqual([]);
    expect(after.filter((row) => row.type === "reservation")).toHaveLength(1);
  });

  test("release and allocate only touch the document that holds the stock", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId,
      warehouseId,
      unitCost: 4,
    });
    const hold = {
      productId,
      warehouseId,
      referenceType: "salesOrder",
      referenceId: "SO-1",
    };
    await as.mutation(api.inventory.stock.reserve, { ...hold, qty: 4 });

    await expect(
      as.mutation(api.inventory.stock.release, {
        ...hold,
        referenceId: "SO-OTHER",
        qty: 1,
      }),
    ).rejects.toThrow("Nothing is reserved against this document.");

    const allocated = await as.mutation(api.inventory.stock.allocate, { ...hold, qty: 3 });
    expect(allocated.releaseId).not.toBe(allocated.issueId);
    expect(await as.query(api.inventory.stock.balance, { productId, warehouseId })).toMatchObject({
      onHand: 2,
      reserved: 1,
      available: 1,
    });

    await as.mutation(api.inventory.stock.release, { ...hold, qty: 1 });
    expect(await as.query(api.inventory.stock.balance, { productId, warehouseId })).toMatchObject({
      onHand: 2,
      reserved: 0,
      available: 2,
    });

    await expect(as.mutation(api.inventory.stock.allocate, { ...hold, qty: 1 })).rejects.toThrow(
      "Nothing is reserved against this document.",
    );
    await expect(as.mutation(api.inventory.stock.reserve, { ...hold, qty: 0 })).rejects.toThrow(
      /greater than zero/,
    );
    await expect(
      as.mutation(api.inventory.stock.reserve, {
        ...hold,
        qty: 1,
        referenceType: " ",
        referenceId: " ",
      }),
    ).rejects.toThrow(/held for/);
  });

  test("a refused allocation writes neither a release nor an issue", async () => {
    const t = setup();
    const actorId = await seedUser(t, "picker@example.com");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const serialId = await t.run((ctx) =>
      ctx.db.insert("serials", {
        productId,
        number: "SN-1",
        status: "available",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const otherId = await t.run((ctx) =>
      ctx.db.insert("serials", {
        productId,
        number: "SN-2",
        status: "available",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await t.run(async (ctx) => {
      await postMovement(ctx, {
        type: "receipt",
        qty: 1,
        productId,
        warehouseId,
        actorId,
        serialIds: [serialId],
      });
      await reserveStock(ctx, {
        productId,
        warehouseId,
        actorId,
        qty: 1,
        referenceType: "salesOrder",
        referenceId: "SO-1",
        serialIds: [serialId],
      });
      await expect(
        allocateStock(ctx, {
          productId,
          warehouseId,
          actorId,
          qty: 1,
          referenceType: "salesOrder",
          referenceId: "SO-1",
          serialIds: [serialId, otherId],
        }),
      ).rejects.toThrow(/match the number of serials/);
    });

    const rows = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(rows.map((row) => row.type).sort()).toEqual(["receipt", "reservation"]);
    const serial = await t.run((ctx) => ctx.db.get(serialId));
    expect(serial?.status).toBe("available");
  });

  test("sales cannot reserve, and an empty shelf refuses the hold", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const hold = {
      productId,
      warehouseId,
      qty: 1,
      referenceType: "salesOrder",
      referenceId: "SO-1",
    };

    await expect(sales.mutation(api.inventory.stock.reserve, hold)).rejects.toThrow(
      "You don't have permission to create inventory items.",
    );
    await expect(t.mutation(api.inventory.stock.reserve, hold)).rejects.toThrow(
      /Not authenticated/,
    );

    const warehouse = await asRole(t, "warehouse");
    await expect(warehouse.mutation(api.inventory.stock.reserve, hold)).rejects.toThrow(
      "Nothing available to reserve.",
    );
  });

  test("releasing inside a thrown transaction puts the hold back", async () => {
    const t = setup();
    const actorId = await seedUser(t, "picker@example.com");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const shared = {
      productId,
      warehouseId,
      actorId,
      qty: 2,
      referenceType: "salesOrder",
      referenceId: "SO-1",
    };

    await t.run(async (ctx) => {
      await postMovement(ctx, { type: "receipt", qty: 2, productId, warehouseId, actorId });
      await reserveStock(ctx, shared);
    });
    await expect(
      t.run(async (ctx) => {
        await releaseStock(ctx, shared);
        throw new Error("order failed");
      }),
    ).rejects.toThrow("order failed");

    const rows = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(rows.filter((row) => row.type === "release")).toEqual([]);
    expect(rows.filter((row) => row.type === "reservation")).toHaveLength(1);
  });
});
