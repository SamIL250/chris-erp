import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * PH2-10 — the pricing matrix. Every customer tier, quantity band, and
 * override outcome is one cell. CI runs this file with the rest of the
 * suite (`npm test` in .github/workflows/ci.yml). A cell that drifts
 * fails the build.
 *
 * Tiers, cheapest last: a customer price, then that customer's group,
 * then the base list, then the catalog list price. A dated promotion
 * from last year points at a one-pound list and must not win. A
 * quantity break applies only to the winning row: 5 and 7 take the
 * break at 5, and 10 takes the break at 10. A lower tier's cheaper
 * break does not leak upward.
 *
 * The line charges the resolved unit until an override is applied or
 * approved. A discount of 10% applies immediately. A discount of 20%
 * waits, and a rejection puts the resolved unit back. With no resolved
 * price, a percent off is refused and a typed price waits.
 */

type T = ReturnType<typeof setup>;

const DAY = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
const WHEN = DAY("2020-06-15");

const QTYS = [1, 5, 7, 10] as const;
type Qty = (typeof QTYS)[number];

type Units = Record<Qty, number | null>;

type Tier = {
  key: "customer" | "group" | "list" | "catalog" | "none";
  customer: "contract" | "member" | "walkin";
  product: "contracted" | "catalog" | "bare";
  source: "customer" | "group" | "list" | "catalog" | null;
  /** Qty 7 stays on the break that starts at 5. Catalog and a miss have no break. */
  units: Units;
  breakHit: Record<Qty, boolean>;
};

const TIERS: Tier[] = [
  {
    key: "customer",
    customer: "contract",
    product: "contracted",
    source: "customer",
    units: { 1: 100, 5: 80, 7: 80, 10: 60 },
    breakHit: { 1: false, 5: true, 7: true, 10: true },
  },
  {
    key: "group",
    customer: "member",
    product: "contracted",
    source: "group",
    units: { 1: 70, 5: 55, 7: 55, 10: 40 },
    breakHit: { 1: false, 5: true, 7: true, 10: true },
  },
  {
    key: "list",
    customer: "walkin",
    product: "contracted",
    source: "list",
    units: { 1: 50, 5: 35, 7: 35, 10: 25 },
    breakHit: { 1: false, 5: true, 7: true, 10: true },
  },
  {
    key: "catalog",
    customer: "contract",
    product: "catalog",
    source: "catalog",
    units: { 1: 20, 5: 20, 7: 20, 10: 20 },
    breakHit: { 1: false, 5: false, 7: false, 10: false },
  },
  {
    key: "none",
    customer: "contract",
    product: "bare",
    source: null,
    units: { 1: null, 5: null, 7: null, 10: null },
    breakHit: { 1: false, 5: false, 7: false, 10: false },
  },
];

/** A percent off, in cents, half away from zero. These units land on a cent. */
function percentOff(unit: number, percent: 10 | 20): number {
  const cents = Math.round(unit * 100);
  return Math.round((cents * (100 - percent)) / 100) / 100;
}

function lineTotal(unit: number, qty: number): number {
  return Math.round(unit * qty * 100) / 100;
}

type Cell =
  | { kind: "open" }
  | {
      kind: "discount";
      unit: number;
      percent: 10 | 20;
      then: "applied" | "pending" | "approved" | "rejected";
    }
  | { kind: "raise"; unit: number }
  | { kind: "unpriced-discount" }
  | { kind: "unpriced-typed"; then: "pending" | "approved" | "rejected" };

function cellsFor(unit: number | null): Cell[] {
  if (unit === null) {
    return [
      { kind: "open" },
      { kind: "unpriced-discount" },
      { kind: "unpriced-typed", then: "pending" },
      { kind: "unpriced-typed", then: "approved" },
      { kind: "unpriced-typed", then: "rejected" },
    ];
  }
  return [
    { kind: "open" },
    { kind: "discount", unit, percent: 10, then: "applied" },
    { kind: "discount", unit, percent: 20, then: "pending" },
    { kind: "discount", unit, percent: 20, then: "approved" },
    { kind: "discount", unit, percent: 20, then: "rejected" },
    { kind: "raise", unit },
  ];
}

function cellName(cell: Cell): string {
  switch (cell.kind) {
    case "open":
      return "open";
    case "discount":
      return `discount ${cell.percent} ${cell.then}`;
    case "raise":
      return "raise";
    case "unpriced-discount":
      return "discount refused";
    case "unpriced-typed":
      return `typed ${cell.then}`;
    default: {
      const unreachable: never = cell;
      return unreachable;
    }
  }
}

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

async function asRole(t: T, roleKey: string, email: string) {
  const userId = await seedUser(t, email);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

describe("pricing matrix", () => {
  test("the percent-off figures the matrix charges", () => {
    expect(percentOff(60, 10)).toBe(54);
    expect(percentOff(80, 20)).toBe(64);
    expect(percentOff(55, 10)).toBe(49.5);
    expect(percentOff(35, 20)).toBe(28);
    expect(percentOff(25, 10)).toBe(22.5);
    expect(percentOff(20, 20)).toBe(16);
  });

  test("customer, group, list, and catalog, across breaks and overrides", async () => {
    const t = setup();
    const sales = await asRole(t, "sales", "ada@example.com");
    const other = await asRole(t, "sales", "ben@example.com");

    const world = await t.run(async (ctx) => {
      await ctx.db.insert("currencies", {
        code: "GBP",
        name: "Pound",
        decimalPlaces: 2,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizations", {
        name: "Chris",
        baseCurrency: "GBP",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const contracted = await ctx.db.insert("products", {
        name: "Contracted",
        slug: "contracted",
        sku: "MATRIX-1",
        status: "active" as const,
        categoryIds: [],
        listPrice: 20,
        createdAt: 1,
        updatedAt: 1,
      });
      const catalog = await ctx.db.insert("products", {
        name: "Catalog only",
        slug: "catalog-only",
        sku: "MATRIX-2",
        status: "active" as const,
        categoryIds: [],
        listPrice: 20,
        createdAt: 1,
        updatedAt: 1,
      });
      const bare = await ctx.db.insert("products", {
        name: "Unpriced",
        slug: "unpriced",
        sku: "MATRIX-3",
        status: "active" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      });
      const groupId = await ctx.db.insert("customerGroups", {
        name: "Wholesale",
        nameKey: "wholesale",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const contract = await ctx.db.insert("customers", {
        code: "CONTRACT",
        name: "Contract Co",
        status: "active" as const,
        paymentTermsDays: 0,
        currency: "GBP",
        groupId,
        createdAt: 1,
        updatedAt: 1,
      });
      const member = await ctx.db.insert("customers", {
        code: "MEMBER",
        name: "Member Co",
        status: "active" as const,
        paymentTermsDays: 0,
        currency: "GBP",
        groupId,
        createdAt: 1,
        updatedAt: 1,
      });
      const walkin = await ctx.db.insert("customers", {
        code: "WALKIN",
        name: "Walk-in",
        status: "active" as const,
        paymentTermsDays: 0,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      });

      const baseId = await ctx.db.insert("priceLists", {
        name: "Standard",
        nameKey: "standard",
        currency: "GBP",
        active: true,
        isBase: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const decoyId = await ctx.db.insert("priceLists", {
        name: "Last year",
        nameKey: "last year",
        currency: "GBP",
        active: true,
        isBase: false,
        createdAt: 2,
        updatedAt: 2,
      });
      const listPriceId = await ctx.db.insert("priceListPrices", {
        priceListId: baseId,
        productId: contracted,
        price: 50,
        createdAt: 1,
        updatedAt: 1,
      });
      const decoyPriceId = await ctx.db.insert("priceListPrices", {
        priceListId: decoyId,
        productId: contracted,
        price: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const groupPriceId = await ctx.db.insert("customerGroupPrices", {
        customerGroupId: groupId,
        productId: contracted,
        currency: "GBP",
        price: 70,
        createdAt: 1,
        updatedAt: 1,
      });
      const customerPriceId = await ctx.db.insert("customerPrices", {
        customerId: contract,
        productId: contracted,
        currency: "GBP",
        price: 100,
        createdAt: 1,
        updatedAt: 1,
      });

      const breaks: {
        scope: "list" | "group" | "customer";
        parent: "list" | "decoy" | "group" | "customer";
        minQty: number;
        price: number;
      }[] = [
        { scope: "list", parent: "list", minQty: 5, price: 35 },
        { scope: "list", parent: "list", minQty: 10, price: 25 },
        { scope: "list", parent: "decoy", minQty: 5, price: 0.5 },
        { scope: "group", parent: "group", minQty: 5, price: 55 },
        { scope: "group", parent: "group", minQty: 10, price: 40 },
        { scope: "customer", parent: "customer", minQty: 5, price: 80 },
        { scope: "customer", parent: "customer", minQty: 10, price: 60 },
      ];
      for (const item of breaks) {
        const parent =
          item.parent === "list"
            ? { priceListPriceId: listPriceId }
            : item.parent === "decoy"
              ? { priceListPriceId: decoyPriceId }
              : item.parent === "group"
                ? { customerGroupPriceId: groupPriceId }
                : { customerPriceId };
        await ctx.db.insert("quantityBreaks", {
          scope: item.scope,
          productId: contracted,
          minQty: item.minQty,
          price: item.price,
          createdAt: 1,
          updatedAt: 1,
          ...parent,
        });
      }
      await ctx.db.insert("promotions", {
        name: "Last year",
        nameKey: "last year",
        startsOn: DAY("2019-01-01"),
        endsOn: DAY("2019-12-31"),
        active: true,
        priceListId: decoyId,
        createdAt: 1,
        updatedAt: 1,
      });

      return { contracted, catalog, bare, contract, member, walkin };
    });

    const customers = {
      contract: world.contract,
      member: world.member,
      walkin: world.walkin,
    };
    const products = {
      contracted: world.contracted,
      catalog: world.catalog,
      bare: world.bare,
    };

    const failures: string[] = [];
    let count = 0;

    for (const tier of TIERS) {
      for (const qty of QTYS) {
        const unit = tier.units[qty];
        const label = `${tier.key} qty ${qty}`;
        const ask = {
          customerId: customers[tier.customer],
          productId: products[tier.product],
          variantId: null,
          qty,
          date: WHEN,
          currency: "GBP",
        };
        try {
          const resolved = await sales.query(api.sales.prices.resolvePrice, ask);
          const preview = await sales.query(api.sales.prices.linePreview, ask);
          expect(resolved.unitPrice).toBe(unit);
          expect(resolved.source).toBe(tier.source);
          expect(resolved.promotionId).toBeNull();
          if (tier.source === "list") expect(typeof resolved.priceListId).toBe("string");
          else expect(resolved.priceListId).toBeNull();
          if (tier.breakHit[qty]) expect(typeof resolved.breakId).toBe("string");
          else expect(resolved.breakId).toBeNull();
          expect(preview.unitPrice).toBe(unit);
          expect(preview.source).toBe(tier.source);
          expect(preview.lineAmount).toBe(unit === null ? null : lineTotal(unit, qty));
          expect(resolved.unitPrice).not.toBe(1);
        } catch (error) {
          failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }

        for (const cell of cellsFor(unit)) {
          count += 1;
          const name = `${label} / ${cellName(cell)}`;
          const lineId = `${tier.key}-${qty}-${cell.kind}-${"then" in cell ? cell.then : ""}-${"percent" in cell ? cell.percent : ""}`;
          try {
            await runCell({ sales, other, cell, lineId });
          } catch (error) {
            failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        try {
          const again = await sales.query(api.sales.prices.resolvePrice, ask);
          expect(again.unitPrice).toBe(unit);
          expect(again.source).toBe(tier.source);
        } catch (error) {
          failures.push(
            `${label} after overrides: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    expect(count).toBe(4 * 4 * 6 + 4 * 5);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

type Sales = Awaited<ReturnType<typeof asRole>>;

async function runCell(args: { sales: Sales; other: Sales; cell: Cell; lineId: string }) {
  const { sales, other, cell, lineId } = args;
  switch (cell.kind) {
    case "open":
      return;
    case "unpriced-discount": {
      await expect(
        sales.mutation(api.sales.priceOverrides.propose, {
          documentKind: "quote",
          documentId: "matrix",
          lineId,
          currency: "GBP",
          resolvedUnitPrice: null,
          change: { mode: "discount", discountPercent: 10 },
          reason: "Matrix",
        }),
      ).rejects.toThrow(/no price to discount/);
      return;
    }
    case "unpriced-typed": {
      const overrideId = await sales.mutation(api.sales.priceOverrides.propose, {
        documentKind: "quote",
        documentId: "matrix",
        lineId,
        currency: "GBP",
        resolvedUnitPrice: null,
        change: { mode: "price", manualPrice: 15 },
        reason: "Matrix",
      });
      expect(await sales.query(api.sales.priceOverrides.get, ref(lineId))).toMatchObject({
        status: "pending",
        needsApproval: true,
        unitPrice: 15,
        chargedUnitPrice: null,
        resolvedUnitPrice: null,
      });
      await finish(other, overrideId, lineId, cell.then, null, 15);
      return;
    }
    case "discount": {
      const overrideId = await sales.mutation(api.sales.priceOverrides.propose, {
        documentKind: "quote",
        documentId: "matrix",
        lineId,
        currency: "GBP",
        resolvedUnitPrice: cell.unit,
        change: { mode: "discount", discountPercent: cell.percent },
        reason: "Matrix",
      });
      const offered = percentOff(cell.unit, cell.percent);
      const held = cell.then === "applied" ? offered : cell.unit;
      expect(await sales.query(api.sales.priceOverrides.get, ref(lineId))).toMatchObject({
        status: cell.then === "applied" ? "applied" : "pending",
        needsApproval: cell.percent > 10,
        unitPrice: offered,
        chargedUnitPrice: held,
        discountPercent: cell.percent,
      });
      if (cell.then === "applied") {
        await expect(
          other.mutation(api.sales.priceOverrides.confirm, {
            overrideId,
            decision: "approve",
            note: null,
          }),
        ).rejects.toThrow(/doesn't need approval/);
        return;
      }
      await finish(other, overrideId, lineId, cell.then, cell.unit, offered);
      return;
    }
    case "raise": {
      const raised = cell.unit + 10;
      const overrideId = await sales.mutation(api.sales.priceOverrides.propose, {
        documentKind: "quote",
        documentId: "matrix",
        lineId,
        currency: "GBP",
        resolvedUnitPrice: cell.unit,
        change: { mode: "price", manualPrice: raised },
        reason: "Matrix",
      });
      expect(await sales.query(api.sales.priceOverrides.get, ref(lineId))).toMatchObject({
        status: "applied",
        needsApproval: false,
        unitPrice: raised,
        chargedUnitPrice: raised,
        discountPercent: 0,
      });
      await expect(
        other.mutation(api.sales.priceOverrides.confirm, {
          overrideId,
          decision: "approve",
          note: null,
        }),
      ).rejects.toThrow(/doesn't need approval/);
      return;
    }
    default: {
      const unreachable: never = cell;
      throw new Error(unreachable);
    }
  }
}

function ref(lineId: string) {
  return { documentKind: "quote" as const, documentId: "matrix", lineId };
}

async function finish(
  other: Sales,
  overrideId: Id<"priceOverrides">,
  lineId: string,
  then: "pending" | "approved" | "rejected",
  resolved: number | null,
  offered: number,
) {
  switch (then) {
    case "pending":
      return;
    case "approved":
      await other.mutation(api.sales.priceOverrides.confirm, {
        overrideId,
        decision: "approve",
        note: null,
      });
      expect(await other.query(api.sales.priceOverrides.get, ref(lineId))).toMatchObject({
        status: "approved",
        chargedUnitPrice: offered,
      });
      return;
    case "rejected":
      await other.mutation(api.sales.priceOverrides.confirm, {
        overrideId,
        decision: "reject",
        note: "Too deep",
      });
      expect(await other.query(api.sales.priceOverrides.get, ref(lineId))).toMatchObject({
        status: "rejected",
        chargedUnitPrice: resolved,
      });
      return;
    default: {
      const unreachable: never = then;
      throw new Error(unreachable);
    }
  }
}
