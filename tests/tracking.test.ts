import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { TRACKING_RULES, trackingError } from "../lib/tracking";
import { setup } from "./setup";

/**
 * Track-flag rules (PH1-12): the four cross-field combinations over the
 * seven PH1-06 fields — serial ⊥ lot, expiry ⇒ lot, warranty months ⇒
 * eligible, shelf life ⇒ expiry — shared as messages through `lib/tracking`
 * (the zod quiet gate mirrors the numeric couplings, the mutations enforce
 * all four verbatim, `variants:update` enforces the boolean pairs), plus
 * the deliberate NON-rules (eligible without months, expiry without shelf
 * life) and the ordering contract: range errors before coupling errors.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
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

async function auditRows(t: T, entity = "products") {
  const rows = await t.run((ctx) => ctx.db.query("auditLog").collect());
  return rows.filter((row) => row.entity === entity);
}

/** The create/update payload; every flag stated (writer-always-sends). */
function fullArgs(over: Record<string, unknown> = {}) {
  return {
    name: "Flag Probe",
    sku: "FLAG-1",
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

/* ------------------------------------------------------ shared rules */

describe("trackingError (PH1-12)", () => {
  test("flags each violated rule with its shared message; first violation wins", () => {
    // All four broken → rule order: the serial/lot pair reports first.
    expect(
      trackingError({
        serialTracked: true,
        lotTracked: true,
        expiryRequired: true,
        warrantyEligible: false,
        warrantyMonths: 24,
        shelfLifeDays: 730,
      }),
    ).toBe(TRACKING_RULES.serialLot);

    expect(
      trackingError({
        serialTracked: false,
        lotTracked: false,
        expiryRequired: true,
        warrantyEligible: false,
      }),
    ).toBe(TRACKING_RULES.expiryNeedsLot);

    expect(
      trackingError({
        serialTracked: false,
        lotTracked: false,
        expiryRequired: false,
        warrantyEligible: false,
        warrantyMonths: 24,
      }),
    ).toBe(TRACKING_RULES.warrantyMonthsNeedEligible);

    expect(
      trackingError({
        serialTracked: false,
        lotTracked: false,
        expiryRequired: false,
        warrantyEligible: false,
        shelfLifeDays: 730,
      }),
    ).toBe(TRACKING_RULES.shelfLifeNeedsExpiry);
  });

  test("valid combinations pass — including the deliberate non-rules", () => {
    const base = {
      serialTracked: false,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
    };
    // All off — the default state every new product starts in.
    expect(trackingError(base)).toBeNull();
    // Serial + warranty term (the equipment bucket).
    expect(
      trackingError({
        ...base,
        serialTracked: true,
        warrantyEligible: true,
        warrantyMonths: 24,
      }),
    ).toBeNull();
    // Lot + expiry + shelf life (the consumable bucket).
    expect(
      trackingError({
        ...base,
        lotTracked: true,
        expiryRequired: true,
        shelfLifeDays: 730,
      }),
    ).toBeNull();
    // NON-rules: terms without their flag-adjacent cousins are legal —
    // eligible without months (terms vary; PH1-17 may ask at claim),
    // expiry without shelf life (supplier-stated dates land on the lot).
    expect(trackingError({ ...base, warrantyEligible: true })).toBeNull();
    expect(trackingError({ ...base, lotTracked: true, expiryRequired: true })).toBeNull();
  });

  test("0 counts as unset; NaN never crashes (normalizeCount rejects it first)", () => {
    const base = {
      serialTracked: false,
      lotTracked: false,
      expiryRequired: false,
      warrantyEligible: false,
    };
    expect(trackingError({ ...base, warrantyMonths: 0 })).toBeNull();
    expect(trackingError({ ...base, shelfLifeDays: 0 })).toBeNull();
    expect(trackingError({ ...base, warrantyMonths: Number.NaN })).toBeNull();
    expect(trackingError({ ...base, warrantyMonths: undefined })).toBeNull();
  });
});

/* ------------------------------------------------------ products */

describe("products:create / update track-flag guards (PH1-12)", () => {
  test("rejects the four invalid combinations verbatim — nothing stored, nothing audited", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);

    await expect(
      asOwner.mutation(
        api.catalog.products.create,
        fullArgs({ serialTracked: true, lotTracked: true }),
      ),
    ).rejects.toThrow(TRACKING_RULES.serialLot);
    await expect(
      asOwner.mutation(api.catalog.products.create, fullArgs({ expiryRequired: true })),
    ).rejects.toThrow(TRACKING_RULES.expiryNeedsLot);
    await expect(
      asOwner.mutation(api.catalog.products.create, fullArgs({ warrantyMonths: 24 })),
    ).rejects.toThrow(TRACKING_RULES.warrantyMonthsNeedEligible);
    await expect(
      asOwner.mutation(api.catalog.products.create, fullArgs({ shelfLifeDays: 730 })),
    ).rejects.toThrow(TRACKING_RULES.shelfLifeNeedsExpiry);

    // Rejected writes never audit (PH0-30) — and no product row exists.
    expect(await auditRows(t)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("products").collect())).toHaveLength(0);
  });

  test("accepts both valid buckets and round-trips the numeric terms", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);

    const { id: equipmentId } = await asOwner.mutation(
      api.catalog.products.create,
      fullArgs({
        name: "Serial Device",
        sku: "FLAG-SER",
        serialTracked: true,
        warrantyEligible: true,
        warrantyMonths: 24,
      }),
    );
    const { id: consumableId } = await asOwner.mutation(
      api.catalog.products.create,
      fullArgs({
        name: "Reagent Bottle",
        sku: "FLAG-LOT",
        lotTracked: true,
        expiryRequired: true,
        shelfLifeDays: 730,
      }),
    );

    const rows = await t.run((ctx) => ctx.db.query("products").collect());
    expect(rows.find((row) => row._id === equipmentId)).toMatchObject({
      serialTracked: true,
      warrantyEligible: true,
      warrantyMonths: 24,
    });
    expect(rows.find((row) => row._id === consumableId)).toMatchObject({
      lotTracked: true,
      expiryRequired: true,
      shelfLifeDays: 730,
    });
    expect(await auditRows(t)).toHaveLength(2);
  });

  test("update audits flag changes with before/after values; identical flags are a no-op", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const { id } = await asOwner.mutation(api.catalog.products.create, fullArgs());
    expect(await auditRows(t)).toHaveLength(1);

    // Enable serial + warranty with a term — full-form payload.
    await asOwner.mutation(api.catalog.products.update, {
      ...fullArgs({
        serialTracked: true,
        warrantyEligible: true,
        warrantyMonths: 12,
      }),
      id,
    });
    const audit = await auditRows(t);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ action: "update", entity: "products" });
    // Flags join the snapshot (PH1-12): the flip is legible, not just
    // "something changed". The absent term reads as undefined (Convex
    // drops undefined keys — same as barcode/costPrice elsewhere).
    expect(audit[1]?.before).toMatchObject({ serialTracked: false });
    expect((audit[1]?.before as Record<string, unknown>)?.warrantyMonths).toBeUndefined();
    expect(audit[1]?.after).toMatchObject({ serialTracked: true, warrantyMonths: 12 });

    // Identical payload → nothing recorded.
    await asOwner.mutation(api.catalog.products.update, {
      ...fullArgs({
        serialTracked: true,
        warrantyEligible: true,
        warrantyMonths: 12,
      }),
      id,
    });
    expect(await auditRows(t)).toHaveLength(2);

    // An invalid flip is rejected before the diff — audit unchanged.
    await expect(
      asOwner.mutation(api.catalog.products.update, {
        ...fullArgs({ serialTracked: true, lotTracked: true }),
        id,
      }),
    ).rejects.toThrow(TRACKING_RULES.serialLot);
    expect(await auditRows(t)).toHaveLength(2);
  });

  test("range errors precede coupling errors (a typo'd 5000 reports the range)", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);

    // Would ALSO violate the coupling (eligible is false) — the range
    // message must win, matching every pre-PH1-12 caller's expectation.
    await expect(
      asOwner.mutation(api.catalog.products.create, fullArgs({ warrantyMonths: 5000 })),
    ).rejects.toThrow("Warranty months must be a whole number between 0 and 1200.");
    // In range but coupled: the shelf-life rule reports instead.
    await expect(
      asOwner.mutation(api.catalog.products.create, fullArgs({ shelfLifeDays: 5000 })),
    ).rejects.toThrow(TRACKING_RULES.shelfLifeNeedsExpiry);
    expect(await auditRows(t)).toHaveLength(0);
  });
});

/* ------------------------------------------------------ variants */

describe("variants:update track-flag guards (PH1-12)", () => {
  async function insertVariant(t: T) {
    return await t.run(async (ctx) => {
      const productId = await ctx.db.insert("products", {
        name: "Matrix Host",
        slug: "matrix-host",
        sku: "HOST-1",
        status: "active" as const,
        categoryIds: [],
        serialTracked: false,
        lotTracked: false,
        expiryRequired: false,
        warrantyEligible: false,
        allowBackorder: false,
        createdAt: 1,
        updatedAt: 1,
      });
      const variantId = await ctx.db.insert("variants", {
        productId,
        optionValues: [],
        sku: "HOST-1-BLK",
        createdAt: 1,
        updatedAt: 1,
      });
      return variantId;
    });
  }

  const variantArgs = (id: Id<"variants">, over: Record<string, unknown> = {}) => ({
    id,
    sku: "HOST-1-BLK",
    barcode: "",
    listPrice: null as number | null,
    serialTracked: false,
    lotTracked: false,
    expiryRequired: false,
    warrantyEligible: false,
    allowBackorder: false,
    ...over,
  });

  test("enforces the boolean pairs with the SAME shared messages", async () => {
    const t = setup();
    const asOwner = await ownerTools(t);
    const variantId = await insertVariant(t);

    await expect(
      asOwner.mutation(
        api.catalog.variants.update,
        variantArgs(variantId, { serialTracked: true, lotTracked: true }),
      ),
    ).rejects.toThrow(TRACKING_RULES.serialLot);
    await expect(
      asOwner.mutation(
        api.catalog.variants.update,
        variantArgs(variantId, { expiryRequired: true }),
      ),
    ).rejects.toThrow(TRACKING_RULES.expiryNeedsLot);
    // Nothing recorded, nothing changed — rejects precede the diff.
    expect(await auditRows(t, "variants")).toHaveLength(0);
    const row = await t.run((ctx) => ctx.db.get(variantId));
    // Absent flags read as false (the `?? false` reader contract).
    expect(row?.serialTracked ?? false).toBe(false);
    expect(row?.lotTracked ?? false).toBe(false);

    // A valid flip goes through (variants carry no numeric terms, so the
    // months/shelf rules can't apply here).
    await asOwner.mutation(
      api.catalog.variants.update,
      variantArgs(variantId, { serialTracked: true }),
    );
    expect(await auditRows(t, "variants")).toHaveLength(1);
    const edited = await t.run((ctx) => ctx.db.get(variantId));
    expect(edited).toMatchObject({ serialTracked: true, lotTracked: false });
  });
});
