import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { marginPercent, MAX_PRICE } from "../lib/pricing";
import { setup } from "./setup";

/**
 * Pricing fields (PH1-10): `listPrice`/`costPrice` on products — optional,
 * finite, 0..MAX_PRICE (typo guard), audited in the commercial snapshot,
 * part of full-form update's no-op diff, and the product-level `listPrice`
 * becoming the variant price's display fallback (PH1-09 kept the override;
 * resolvePrice formalizes the chain in PH2-07).
 *
 * Margin % is a READ-TIME figure (lib/pricing) — never stored, never in an
 * audit entry, staff-side only. The storefront (PH4) projects listPrice
 * alone; this file pins the pure math.
 *
 * The variants price now shares MAX_PRICE with the product fields — one
 * cap, one wording family.
 */

type T = ReturnType<typeof setup>;

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

async function ownerTools(t: T) {
  const owner = await seedUser(t, "owner@example.com");
  await grant(t, owner, "owner");
  return t.withIdentity({ subject: `${owner}|session-1` });
}

function fullArgs(over: Record<string, unknown> = {}) {
  return {
    name: "Portable Ultrasound X5",
    sku: "US-1001",
    status: "active" as const,
    serialTracked: false,
    lotTracked: false,
    expiryRequired: false,
    warrantyEligible: false,
    allowBackorder: false,
    images: [] as { fileId: Id<"files">; alt?: string }[],
    categoryIds: [] as Id<"categories">[],
    attributeSetIds: [] as Id<"attributeSets">[],
    ...over,
  };
}

/* ------------------------------------------------- pure margin math */

describe("marginPercent (lib/pricing)", () => {
  test("computes (list − cost) / list × 100, one decimal", () => {
    expect(marginPercent(100, 75)).toBe(25);
    expect(marginPercent(24_500, 15_900)).toBe(35.1);
    expect(marginPercent(3, 2)).toBe(33.3);
  });

  test("null when a price is missing or the list price is not positive", () => {
    expect(marginPercent(undefined, 50)).toBeNull();
    expect(marginPercent(100, undefined)).toBeNull();
    expect(marginPercent(0, 0)).toBeNull();
    expect(marginPercent(-5, 1)).toBeNull();
    expect(marginPercent(Number.NaN, 1)).toBeNull();
    expect(marginPercent(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("a negative margin is shown, not hidden — selling below cost is real", () => {
    expect(marginPercent(600, 780)).toBe(-30);
  });
});

/* ------------------------------------------------------ product fields */

describe("product pricing fields", () => {
  test("create stores listPrice/costPrice; get returns them", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({ listPrice: 24_500, costPrice: 15_900 }),
    );
    const row = await as.query(api.catalog.products.get, { id });
    expect(row?.product.listPrice).toBe(24_500);
    expect(row?.product.costPrice).toBe(15_900);
  });

  test("omitted prices stay unset — margin reads null, nothing invented", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const { id } = await as.mutation(api.catalog.products.create, fullArgs());
    const row = await as.query(api.catalog.products.get, { id });
    expect(row?.product.listPrice).toBeUndefined();
    expect(row?.product.costPrice).toBeUndefined();
  });

  test("zero is a valid price (free giveaway), a negative is not", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const { id } = await as.mutation(api.catalog.products.create, fullArgs({ listPrice: 0 }));
    expect((await as.query(api.catalog.products.get, { id }))?.product.listPrice).toBe(0);
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ sku: "US-1002", listPrice: -1 })),
    ).rejects.toThrow("List price must be zero or more.");
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ sku: "US-1003", costPrice: -0.01 })),
    ).rejects.toThrow("Cost price must be zero or more.");
  });

  test("NaN and Infinity ride the zero-or-more error (Convex admits them)", async () => {
    const t = setup();
    const as = await ownerTools(t);
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ sku: "US-1004", listPrice: Number.NaN })),
    ).rejects.toThrow("List price must be zero or more.");
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({
          sku: "US-1005",
          costPrice: Number.POSITIVE_INFINITY,
        }),
      ),
    ).rejects.toThrow("Cost price must be zero or more.");
  });

  test("prices above MAX_PRICE are rejected with the cap named", async () => {
    const t = setup();
    const as = await ownerTools(t);
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({
          sku: "US-1006",
          listPrice: MAX_PRICE + 0.01,
        }),
      ),
    ).rejects.toThrow(`List price must be ${MAX_PRICE} or fewer.`);
    // The boundary itself is accepted.
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({ sku: "US-1007", listPrice: MAX_PRICE }),
    );
    expect((await as.query(api.catalog.products.get, { id }))?.product.listPrice).toBe(MAX_PRICE);
  });

  test("full-form update diffs prices: change audited, identical save is a no-op", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({ listPrice: 100, costPrice: 60 }),
    );

    // Identical full-form save → no-op (PH0-30): only the CREATE row exists.
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ listPrice: 100, costPrice: 60 }),
      id,
    });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);

    // Price-only change → audited with before/after prices.
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ listPrice: 120, costPrice: 60 }),
      id,
    });
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(2);
    expect(audit[1].before).toMatchObject({ listPrice: 100, costPrice: 60 });
    expect(audit[1].after).toMatchObject({ listPrice: 120, costPrice: 60 });
    // Margin never appears — it's derived, never stored.
    expect(audit[1].after).not.toHaveProperty("margin");

    // Omitting a price in a full-form save clears it (full-form semantics).
    await as.mutation(api.catalog.products.update, { ...fullArgs(), id });
    const row = await as.query(api.catalog.products.get, { id });
    expect(row?.product.listPrice).toBeUndefined();
    expect(row?.product.costPrice).toBeUndefined();
  });

  test("RBAC: the catalog ladder gates price edits like any product write", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({ listPrice: 100, costPrice: 60 }),
    );

    const salesUser = await seedUser(t, "pat@example.com");
    await grant(t, salesUser, "sales");
    const asSales = t.withIdentity({ subject: `${salesUser}|session-1` });
    // Sales holds catalog.edit → may adjust prices.
    await asSales.mutation(api.catalog.products.update, {
      ...fullArgs({ listPrice: 150 }),
      id,
    });

    const warehouseUser = await seedUser(t, "dave@example.com");
    await grant(t, warehouseUser, "warehouse");
    const asWarehouse = t.withIdentity({ subject: `${warehouseUser}|session-1` });
    // Warehouse holds catalog.view only → reads, never writes.
    const row = await asWarehouse.query(api.catalog.products.get, { id });
    expect(row?.product.listPrice).toBe(150);
    await expect(
      asWarehouse.mutation(api.catalog.products.update, {
        ...fullArgs({ listPrice: 200 }),
        id,
      }),
    ).rejects.toThrow("You don't have permission to edit catalog items.");

    // Anonymous hits the auth gate before the permission matrix.
    await expect(t.query(api.catalog.products.get, { id })).rejects.toThrow("Not authenticated");
  });
});
