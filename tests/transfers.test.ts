import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  draftBlock,
  outstandingQty,
  receiveBlock,
  transferNoteError,
  transferPairError,
  transferQtyError,
} from "../lib/transfers";
import { setup } from "./setup";

/**
 * PH1-21 — stock transfers. Shipping takes goods off the source.
 * A receipt puts only what arrived onto the destination. The document
 * stays on the in-transit report until every line is fully received.
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

async function seedProduct(t: T, sku: string, name: string) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name,
      slug: sku.toLowerCase(),
      sku,
      status: "active" as const,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedWarehouse(t: T, code: string, name: string, isDefault: boolean) {
  return await t.run((ctx) =>
    ctx.db.insert("warehouses", {
      code,
      name,
      isDefault,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("stock transfers (PH1-21)", () => {
  test("a transfer needs two warehouses, a positive quantity, and the right status", () => {
    expect(transferPairError("main", "east")).toBeNull();
    expect(transferPairError("main", "main")).toMatch(/different/);
    expect(transferQtyError(2)).toBeNull();
    expect(transferQtyError(0)).toMatch(/greater than zero/);
    expect(transferNoteError("  ")).toBeNull();
    expect(transferNoteError("x".repeat(501))).toMatch(/500/);
    expect(outstandingQty(6, 2)).toBe(4);
    expect(draftBlock("draft")).toBeNull();
    expect(draftBlock("inTransit")).toMatch(/in transit/);
    expect(draftBlock("received")).toMatch(/received/);
    expect(draftBlock("cancelled")).toMatch(/cancelled/);
    expect(receiveBlock("inTransit")).toBeNull();
    expect(receiveBlock("draft")).toMatch(/Ship the transfer/);
    expect(receiveBlock("received")).toMatch(/received/);
  });

  test("shipping removes the source, and a partial receipt stays in transit", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t, "MOVE-1", "Moved item");
    const main = await seedWarehouse(t, "MAIN", "Main", true);
    const east = await seedWarehouse(t, "EAST", "East", false);
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 10,
      productId,
      warehouseId: main,
      unitCost: 4,
    });

    await expect(
      as.mutation(api.inventory.transfers.create, {
        fromWarehouseId: main,
        toWarehouseId: main,
        lines: [{ productId, qty: 1 }],
      }),
    ).rejects.toThrow(/different/);

    const transferId = await as.mutation(api.inventory.transfers.create, {
      fromWarehouseId: main,
      toWarehouseId: east,
      note: "  restock east  ",
      lines: [{ productId, qty: 6 }],
    });
    const draft = await as.query(api.inventory.transfers.get, { transferId });
    expect(draft.number).toBe("TR-0001");
    expect(draft.status).toBe("draft");
    expect(draft.note).toBe("restock east");
    expect(await as.query(api.inventory.transfers.inTransit, {})).toEqual([]);

    await as.mutation(api.inventory.transfers.ship, { transferId });
    expect(
      await as.query(api.inventory.stock.balance, { productId, warehouseId: main }),
    ).toMatchObject({ onHand: 4, available: 4 });
    expect(
      await as.query(api.inventory.stock.balance, { productId, warehouseId: east }),
    ).toMatchObject({ onHand: 0, available: 0 });

    const report = await sales.query(api.inventory.transfers.inTransit, {});
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      number: "TR-0001",
      fromCode: "MAIN",
      toCode: "EAST",
      lines: [{ name: "Moved item", sku: "MOVE-1", qty: 6, receivedQty: 0, outstanding: 6 }],
    });
    const lineId = report[0]?.lines[0]?.lineId;
    if (lineId === undefined) throw new Error("missing line");

    const outs = await as.query(api.inventory.stock.list, { productId, warehouseId: main });
    const transferOut = outs.find((row) => row.type === "transferOut");
    expect(transferOut).toMatchObject({ qty: -6, unitCost: 4, referenceType: "stockTransfer" });

    await as.mutation(api.inventory.transfers.receive, {
      transferId,
      lines: [{ lineId, qty: 2 }],
    });
    expect(await as.query(api.inventory.transfers.get, { transferId })).toMatchObject({
      status: "inTransit",
      lines: [{ receivedQty: 2, outstanding: 4 }],
    });
    expect(
      await as.query(api.inventory.stock.balance, { productId, warehouseId: east }),
    ).toMatchObject({ onHand: 2, available: 2, unitCost: 4, value: 8 });
    expect(await sales.query(api.inventory.transfers.inTransit, {})).toHaveLength(1);

    await expect(
      as.mutation(api.inventory.transfers.receive, {
        transferId,
        lines: [{ lineId, qty: 5 }],
      }),
    ).rejects.toThrow("Only 4 is still in transit.");
    expect(
      await as.query(api.inventory.stock.balance, { productId, warehouseId: east }),
    ).toMatchObject({ onHand: 2 });

    await as.mutation(api.inventory.transfers.receive, {
      transferId,
      lines: [{ lineId, qty: 4 }],
    });
    expect(await as.query(api.inventory.transfers.get, { transferId })).toMatchObject({
      status: "received",
      lines: [{ receivedQty: 6, outstanding: 0 }],
    });
    expect(
      await as.query(api.inventory.stock.balance, { productId, warehouseId: east }),
    ).toMatchObject({ onHand: 6, available: 6, value: 24 });
    expect(await as.query(api.inventory.transfers.inTransit, {})).toEqual([]);
    expect(
      await as.query(api.inventory.stock.balance, { productId, warehouseId: main }),
    ).toMatchObject({
      onHand: 4,
    });
  });

  test("a short shelf refuses the ship and leaves the draft untouched", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const held = await seedProduct(t, "HELD-1", "Held");
    const missing = await seedProduct(t, "NONE-1", "None");
    const main = await seedWarehouse(t, "MAIN", "Main", true);
    const east = await seedWarehouse(t, "EAST", "East", false);
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId: held,
      warehouseId: main,
    });
    await as.mutation(api.inventory.stock.reserve, {
      productId: held,
      warehouseId: main,
      qty: 4,
      referenceType: "salesOrder",
      referenceId: "SO-1",
    });

    const blocked = await as.mutation(api.inventory.transfers.create, {
      fromWarehouseId: main,
      toWarehouseId: east,
      lines: [{ productId: held, qty: 2 }],
    });
    await expect(
      as.mutation(api.inventory.transfers.ship, { transferId: blocked }),
    ).rejects.toThrow("Only 1 available to transfer.");
    expect(await as.query(api.inventory.transfers.get, { transferId: blocked })).toMatchObject({
      status: "draft",
    });
    expect(
      await as.query(api.inventory.stock.balance, { productId: held, warehouseId: main }),
    ).toMatchObject({ onHand: 5, reserved: 4, available: 1 });

    const both = await as.mutation(api.inventory.transfers.create, {
      fromWarehouseId: main,
      toWarehouseId: east,
      lines: [
        { productId: held, qty: 1 },
        { productId: missing, qty: 1 },
      ],
    });
    await expect(as.mutation(api.inventory.transfers.ship, { transferId: both })).rejects.toThrow(
      "Nothing available to transfer.",
    );
    const movements = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(movements.filter((row) => row.type === "transferOut")).toEqual([]);
    expect(await as.query(api.inventory.transfers.get, { transferId: both })).toMatchObject({
      status: "draft",
    });
  });

  test("only a draft can change or be cancelled, and sales cannot ship", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const sales = await asRole(t, "sales");
    const productId = await seedProduct(t, "MOVE-2", "Second");
    const main = await seedWarehouse(t, "MAIN", "Main", true);
    const east = await seedWarehouse(t, "EAST", "East", false);
    const args = {
      fromWarehouseId: main,
      toWarehouseId: east,
      lines: [{ productId, qty: 1 }],
    };

    await expect(sales.mutation(api.inventory.transfers.create, args)).rejects.toThrow(
      "You don't have permission to create inventory items.",
    );
    await expect(t.query(api.inventory.transfers.inTransit, {})).rejects.toThrow(
      /Not authenticated/,
    );

    const transferId = await as.mutation(api.inventory.transfers.create, args);
    await as.mutation(api.inventory.transfers.cancel, { transferId });
    expect(await as.query(api.inventory.transfers.get, { transferId })).toMatchObject({
      status: "cancelled",
    });
    await expect(as.mutation(api.inventory.transfers.ship, { transferId })).rejects.toThrow(
      /cancelled/,
    );
    await expect(
      as.mutation(api.inventory.transfers.update, { transferId, ...args }),
    ).rejects.toThrow(/cancelled/);
    const movements = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(movements).toEqual([]);
  });
});
