import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { adjustmentNoteError, adjustmentReasonError } from "../lib/stock";
import { setup } from "./setup";

/**
 * PH1-20 — manual adjustments. The reason fixes the sign, a removal
 * cannot eat reserved stock, and only inventory.approve may post one.
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
      name: "Counted item",
      slug: "counted-item",
      sku: "COUNT-1",
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

describe("manual stock adjustment (PH1-20)", () => {
  test("the reason decides which way the quantity may go", () => {
    expect(adjustmentReasonError("damage", -2)).toBeNull();
    expect(adjustmentReasonError("writeOff", -1)).toBeNull();
    expect(adjustmentReasonError("damage", 2)).toMatch(/negative/);
    expect(adjustmentReasonError("writeOff", 1)).toMatch(/negative/);
    expect(adjustmentReasonError("found", 3)).toBeNull();
    expect(adjustmentReasonError("found", -3)).toMatch(/positive/);
    expect(adjustmentReasonError("countCorrection", 4)).toBeNull();
    expect(adjustmentReasonError("countCorrection", -4)).toBeNull();
    expect(adjustmentReasonError("countCorrection", 0)).toMatch(/can't be zero/);
    expect(adjustmentReasonError("shrinkage", -1)).toMatch(/Choose a reason/);
    expect(adjustmentNoteError(undefined)).toBeNull();
    expect(adjustmentNoteError("  ")).toBeNull();
    expect(adjustmentNoteError("x".repeat(501))).toMatch(/500/);
  });

  test("a counted removal keeps the note and photo and updates on-hand", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const photoFileId = await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      if (user === null) throw new Error("missing user");
      return await ctx.db.insert("files", {
        name: "crack.jpg",
        mimeType: "image/jpeg",
        size: 10,
        kind: "adjustmentPhoto",
        uploadedBy: user._id,
        createdAt: 1,
      });
    });
    await as.mutation(api.inventory.stock.post, {
      type: "receipt",
      qty: 5,
      productId,
      warehouseId,
    });

    const id = await as.mutation(api.inventory.stock.adjust, {
      productId,
      warehouseId,
      qty: -2,
      reason: "damage",
      note: "  cracked case  ",
      photoFileId,
    });

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.type).toBe("adjustment");
    expect(row?.qty).toBe(-2);
    expect(row?.reason).toBe("damage");
    expect(row?.note).toBe("cracked case");
    expect(row?.photoFileId).toBe(photoFileId);
    expect(await as.query(api.inventory.stock.balance, { productId, warehouseId })).toMatchObject({
      onHand: 3,
      reserved: 0,
      available: 3,
    });

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const entry = audits.find((audit) => audit.entityId === id);
    expect(entry?.action).toBe("create");
    expect(entry?.before).toBeUndefined();
    expect(entry?.after).toMatchObject({ reason: "damage", qty: -2, note: "cracked case" });
  });

  test("a removal cannot take units that are still reserved", async () => {
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
    await as.mutation(api.inventory.stock.reserve, {
      productId,
      warehouseId,
      qty: 4,
      referenceType: "salesOrder",
      referenceId: "SO-1",
    });

    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId,
        qty: -2,
        reason: "writeOff",
      }),
    ).rejects.toThrow("Only 1 can be removed. The rest is reserved.");

    await as.mutation(api.inventory.stock.adjust, {
      productId,
      warehouseId,
      qty: -1,
      reason: "writeOff",
    });
    expect(await as.query(api.inventory.stock.balance, { productId, warehouseId })).toMatchObject({
      onHand: 4,
      reserved: 4,
      available: 0,
    });

    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId,
        qty: -1,
        reason: "countCorrection",
      }),
    ).rejects.toThrow("Nothing is free to remove. The stock on hand is reserved.");
  });

  test("found stock arrives, and a bad photo or note is refused", async () => {
    const t = setup();
    const as = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const userId = await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      if (user === null) throw new Error("missing user");
      return user._id;
    });
    const pdfId = await t.run((ctx) =>
      ctx.db.insert("files", {
        name: "note.pdf",
        mimeType: "application/pdf",
        size: 10,
        kind: "adjustmentPhoto",
        uploadedBy: userId,
        createdAt: 1,
      }),
    );

    const id = await as.mutation(api.inventory.stock.adjust, {
      productId,
      warehouseId,
      qty: 2,
      reason: "found",
      note: "   ",
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.note).toBeUndefined();
    expect(row?.photoFileId).toBeUndefined();
    expect(await as.query(api.inventory.stock.balance, { productId, warehouseId })).toMatchObject({
      onHand: 2,
      available: 2,
    });

    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId,
        qty: -1,
        reason: "found",
      }),
    ).rejects.toThrow(/positive/);
    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId,
        qty: 1,
        reason: "damage",
      }),
    ).rejects.toThrow(/negative/);
    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId,
        qty: 1,
        reason: "countCorrection",
        note: "x".repeat(501),
      }),
    ).rejects.toThrow(/500/);
    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId,
        qty: 1,
        reason: "found",
        photoFileId: pdfId,
      }),
    ).rejects.toThrow(/image/);
    await expect(
      as.mutation(api.inventory.stock.adjust, {
        productId,
        warehouseId,
        qty: -3,
        reason: "countCorrection",
      }),
    ).rejects.toThrow("Only 2 on hand to remove.");
  });

  test("sales cannot adjust, and the raw ledger post cannot skip the reason", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const productId = await seedProduct(t);
    const warehouseId = await seedWarehouse(t);
    const args = {
      productId,
      warehouseId,
      qty: 1,
      reason: "found" as const,
    };

    await expect(sales.mutation(api.inventory.stock.adjust, args)).rejects.toThrow(
      "You don't have permission to approve inventory items.",
    );
    await expect(t.mutation(api.inventory.stock.adjust, args)).rejects.toThrow(/Not authenticated/);
    await expect(
      warehouse.mutation(api.inventory.stock.post, {
        type: "adjustment",
        qty: 1,
        productId,
        warehouseId,
      }),
    ).rejects.toThrow("Record a count change with the adjustment action.");

    const rows = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(rows).toEqual([]);
  });
});
