import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  OVERRIDE_THRESHOLD_PERCENT,
  chargedUnitPrice,
  discountPercentError,
  overrideReasonError,
  priceOverride,
} from "../lib/priceOverrides";
import { setup } from "./setup";

/**
 * PH2-08 — a manual price or a discount on a document line. Above the
 * threshold a second person confirms it. The line tables arrive later.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      name: email,
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

async function asUser(t: T, email: string, roleKey: string) {
  const userId = await seedUser(t, email);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

const ref = {
  documentKind: "quote" as const,
  documentId: "quote-1",
  lineId: "line-1",
};
const line = { ...ref, currency: "GBP", resolvedUnitPrice: 10 };

describe("price override rules", () => {
  test("a discount above 10% needs a second person", () => {
    expect(OVERRIDE_THRESHOLD_PERCENT).toBe(10);
    expect(overrideReasonError("  ")).toMatch(/required/);
    expect(discountPercentError(0)).toMatch(/greater than zero/);
    expect(discountPercentError(101)).toMatch(/100%/);
    expect(
      priceOverride({
        resolvedUnitPrice: 10,
        decimalPlaces: 2,
        mode: "discount",
        discountPercent: 10,
      }),
    ).toMatchObject({ unitPrice: 9, discountPercent: 10, needsApproval: false });
    expect(
      priceOverride({
        resolvedUnitPrice: 10,
        decimalPlaces: 2,
        mode: "discount",
        discountPercent: 15,
      }),
    ).toMatchObject({ unitPrice: 8.5, discountPercent: 15, needsApproval: true });
    expect(
      priceOverride({
        resolvedUnitPrice: 10,
        decimalPlaces: 2,
        mode: "price",
        manualPrice: 12,
      }),
    ).toMatchObject({ unitPrice: 12, discountPercent: 0, needsApproval: false });
    expect(
      priceOverride({
        resolvedUnitPrice: 10,
        decimalPlaces: 2,
        mode: "price",
        manualPrice: 0,
      }),
    ).toMatchObject({ unitPrice: 0, discountPercent: 100, needsApproval: true });
    expect(
      priceOverride({
        resolvedUnitPrice: null,
        decimalPlaces: 2,
        mode: "price",
        manualPrice: 4,
      }),
    ).toMatchObject({ unitPrice: 4, discountPercent: null, needsApproval: true });
    expect(
      priceOverride({
        resolvedUnitPrice: null,
        decimalPlaces: 2,
        mode: "discount",
        discountPercent: 5,
      }),
    ).toMatchObject({ error: "There's no price to discount." });
    expect(
      priceOverride({
        resolvedUnitPrice: 10,
        decimalPlaces: 2,
        mode: "price",
        manualPrice: 10,
      }),
    ).toMatchObject({ error: "That price matches the resolved price." });

    expect(chargedUnitPrice({ status: "pending", unitPrice: 8, resolvedUnitPrice: 10 })).toBe(10);
    expect(chargedUnitPrice({ status: "approved", unitPrice: 8, resolvedUnitPrice: 10 })).toBe(8);
    expect(chargedUnitPrice({ status: "rejected", unitPrice: 8, resolvedUnitPrice: 10 })).toBe(10);
    expect(chargedUnitPrice({ status: "applied", unitPrice: 9, resolvedUnitPrice: 10 })).toBe(9);
    expect(
      chargedUnitPrice({ status: "pending", unitPrice: 4, resolvedUnitPrice: null }),
    ).toBeNull();
  });
});

describe("price overrides", () => {
  test("a second person confirms a discount past the threshold", async () => {
    const t = setup();
    const sales = await asUser(t, "ada@example.com", "sales");
    const other = await asUser(t, "ben@example.com", "sales");
    const warehouse = await asUser(t, "wh@example.com", "warehouse");
    const accountant = await asUser(t, "ac@example.com", "accountant");
    await t.run((ctx) =>
      ctx.db.insert("currencies", {
        code: "GBP",
        name: "Pound",
        decimalPlaces: 2,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    const propose = {
      ...line,
      change: { mode: "discount" as const, discountPercent: 5 },
      reason: "  Repeat order  ",
    };
    await expect(t.mutation(api.sales.priceOverrides.propose, propose)).rejects.toThrow(
      /Not authenticated/,
    );
    await expect(warehouse.mutation(api.sales.priceOverrides.propose, propose)).rejects.toThrow(
      /permission to create sales/,
    );
    await expect(
      sales.mutation(api.sales.priceOverrides.propose, { ...propose, reason: "  " }),
    ).rejects.toThrow(/required/);

    const smallId = await sales.mutation(api.sales.priceOverrides.propose, propose);
    const small = await accountant.query(api.sales.priceOverrides.get, ref);
    expect(small).toMatchObject({
      _id: smallId,
      status: "applied",
      needsApproval: false,
      unitPrice: 9.5,
      chargedUnitPrice: 9.5,
      reason: "Repeat order",
    });
    await expect(
      other.mutation(api.sales.priceOverrides.confirm, {
        overrideId: smallId,
        decision: "approve",
        note: null,
      }),
    ).rejects.toThrow(/doesn't need approval/);

    const pendingId = await sales.mutation(api.sales.priceOverrides.propose, {
      ...line,
      change: { mode: "discount", discountPercent: 20 },
      reason: "Matching a competitor",
    });
    expect(pendingId).toBe(smallId);
    expect(await sales.query(api.sales.priceOverrides.get, ref)).toMatchObject({
      status: "pending",
      needsApproval: true,
      unitPrice: 8,
      chargedUnitPrice: 10,
      requestedDiscountPercent: 20,
    });
    expect(await warehouse.query(api.sales.priceOverrides.listPending, {})).toHaveLength(1);
    await expect(
      sales.mutation(api.sales.priceOverrides.confirm, {
        overrideId: pendingId,
        decision: "approve",
        note: null,
      }),
    ).rejects.toThrow(/Someone else/);
    await expect(
      warehouse.mutation(api.sales.priceOverrides.confirm, {
        overrideId: pendingId,
        decision: "approve",
        note: null,
      }),
    ).rejects.toThrow(/permission to approve sales/);
    await expect(
      other.mutation(api.sales.priceOverrides.confirm, {
        overrideId: pendingId,
        decision: "reject",
        note: null,
      }),
    ).rejects.toThrow(/required/);

    await other.mutation(api.sales.priceOverrides.confirm, {
      overrideId: pendingId,
      decision: "approve",
      note: "Agreed",
    });
    expect(await sales.query(api.sales.priceOverrides.get, ref)).toMatchObject({
      status: "approved",
      needsApproval: true,
      chargedUnitPrice: 8,
      decisionNote: "Agreed",
    });
    expect(await sales.query(api.sales.priceOverrides.listPending, {})).toEqual([]);
    await expect(
      other.mutation(api.sales.priceOverrides.confirm, {
        overrideId: pendingId,
        decision: "approve",
        note: null,
      }),
    ).rejects.toThrow(/already confirmed/);

    const againId = await sales.mutation(api.sales.priceOverrides.propose, {
      ...line,
      change: { mode: "price", manualPrice: 0 },
      reason: "Goodwill",
    });
    expect(againId).toBe(pendingId);
    expect(await sales.query(api.sales.priceOverrides.get, ref)).toMatchObject({
      status: "pending",
      mode: "price",
      unitPrice: 0,
      chargedUnitPrice: 10,
      manualPrice: 0,
      requestedDiscountPercent: null,
    });
    await other.mutation(api.sales.priceOverrides.confirm, {
      overrideId: againId,
      decision: "reject",
      note: "Too far",
    });
    expect(await sales.query(api.sales.priceOverrides.get, ref)).toMatchObject({
      status: "rejected",
      chargedUnitPrice: 10,
      decisionNote: "Too far",
    });

    await sales.mutation(api.sales.priceOverrides.propose, {
      ...line,
      lineId: "line-2",
      resolvedUnitPrice: null,
      change: { mode: "price", manualPrice: 10.126 },
      reason: "No list price",
    });
    expect(
      await sales.query(api.sales.priceOverrides.get, { ...ref, lineId: "line-2" }),
    ).toMatchObject({
      status: "pending",
      unitPrice: 10.13,
      chargedUnitPrice: null,
      needsApproval: true,
    });
    expect(
      await sales.query(api.sales.priceOverrides.get, { ...ref, lineId: "missing" }),
    ).toBeNull();
  });
});
