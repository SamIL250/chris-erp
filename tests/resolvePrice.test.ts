import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  lineAmount,
  priceDay,
  resolvePrice,
  resolveQtyError,
  roundUnitPrice,
  type PriceCandidate,
  type PriceListCandidate,
  type PromotionCandidate,
  type ResolvePriceInput,
} from "../lib/pricing";
import { setup } from "./setup";

/**
 * PH2-07 — one price. Customer, then group, then list. A quantity
 * break applies only to the row that won. The catalog list price is
 * the last fallback, and only in the company currency.
 */

type T = ReturnType<typeof setup>;

const DAY = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

function price(
  id: string,
  amount: number,
  variantId: string | null = null,
  breaks: PriceCandidate["breaks"] = [],
): PriceCandidate {
  return { id, variantId, price: amount, breaks };
}

function list(
  id: string,
  prices: PriceCandidate[],
  extra: Partial<PriceListCandidate> = {},
): PriceListCandidate {
  return {
    id,
    currency: "GBP",
    active: true,
    isBase: false,
    createdAt: 1,
    prices,
    ...extra,
  };
}

function promotion(
  id: string,
  priceListId: string,
  startsOn: string,
  endsOn: string,
  createdAt: number,
): PromotionCandidate {
  return {
    id,
    priceListId,
    startsOn: DAY(startsOn),
    endsOn: DAY(endsOn),
    active: true,
    createdAt,
  };
}

function input(extra: Partial<ResolvePriceInput> = {}): ResolvePriceInput {
  return {
    qty: 1,
    date: DAY("2020-06-15"),
    currency: "GBP",
    decimalPlaces: 2,
    variantId: null,
    customerPrices: [],
    groupPrices: [],
    lists: [],
    promotions: [],
    catalog: { variantPrice: null, productPrice: null, baseCurrency: "GBP" },
    ...extra,
  };
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

async function asRole(t: T, roleKey: string) {
  const userId = await seedUser(t, `${roleKey}@example.com`);
  await grant(t, userId, roleKey);
  return t.withIdentity({ subject: `${userId}|session-1` });
}

describe("resolvePrice rules", () => {
  test("rounds the unit, then the line, to the currency's places", () => {
    expect(roundUnitPrice(10.126, 2)).toBe(10.13);
    expect(roundUnitPrice(10.124, 2)).toBe(10.12);
    expect(roundUnitPrice(10.125, 2)).toBe(10.13);
    expect(roundUnitPrice(10.5, 0)).toBe(11);
    expect(roundUnitPrice(0, 2)).toBe(0);
    expect(lineAmount(10.01, 1.5, 2)).toBe(15.02);
    expect(resolveQtyError(0)).toMatch(/greater than zero/);
    expect(resolveQtyError(Number.POSITIVE_INFINITY)).toMatch(/finite/);
    expect(resolveQtyError(2)).toBeNull();
    expect(priceDay(Date.parse("2020-06-15T12:00:00.000Z"))).toBe(DAY("2020-06-15"));
    expect(priceDay(Number.NaN)).toBeNull();
  });

  test("customer, then group, then list, then the catalog price", () => {
    const base = list("base", [price("list", 5)], { isBase: true });
    expect(
      resolvePrice(
        input({
          customerPrices: [price("customer", 20)],
          groupPrices: [price("group", 10)],
          lists: [base],
          catalog: { variantPrice: null, productPrice: 100, baseCurrency: "GBP" },
        }),
      ),
    ).toMatchObject({ unitPrice: 20, source: "customer", breakId: null });

    expect(resolvePrice(input({ groupPrices: [price("group", 10)], lists: [base] }))).toMatchObject(
      { unitPrice: 10, source: "group" },
    );

    expect(resolvePrice(input({ lists: [base] }))).toMatchObject({
      unitPrice: 5,
      source: "list",
      priceListId: "base",
      promotionId: null,
    });

    expect(
      resolvePrice(
        input({ catalog: { variantPrice: null, productPrice: 100, baseCurrency: "GBP" } }),
      ),
    ).toMatchObject({ unitPrice: 100, source: "catalog" });

    expect(
      resolvePrice(
        input({
          currency: "USD",
          catalog: { variantPrice: null, productPrice: 100, baseCurrency: "GBP" },
        }),
      ),
    ).toMatchObject({ unitPrice: null, source: null });
  });

  test("a variant price beats the product price inside the winning tier", () => {
    expect(
      resolvePrice(
        input({
          variantId: "red",
          customerPrices: [price("product", 9), price("red", 7, "red")],
          groupPrices: [price("group-red", 4, "red")],
        }),
      ),
    ).toMatchObject({ unitPrice: 7, source: "customer" });

    expect(
      resolvePrice(
        input({
          variantId: "red",
          customerPrices: [price("product", 9)],
          groupPrices: [price("group-red", 4, "red")],
        }),
      ),
    ).toMatchObject({ unitPrice: 9, source: "customer" });

    expect(
      resolvePrice(
        input({
          variantId: "blue",
          customerPrices: [price("red", 7, "red")],
          groupPrices: [price("group-blue", 4, "blue")],
        }),
      ),
    ).toMatchObject({ unitPrice: 4, source: "group" });
  });

  test("zero wins, and a break applies only on the winning row", () => {
    const customer = price("customer", 20, null, [
      { id: "b2", minQty: 2, price: 18 },
      { id: "b10", minQty: 10, price: 12 },
    ]);
    const base = list(
      "base",
      [price("list", 5, null, [{ id: "list-break", minQty: 2, price: 1 }])],
      { isBase: true },
    );

    expect(
      resolvePrice(input({ qty: 1, customerPrices: [customer], lists: [base] })),
    ).toMatchObject({
      unitPrice: 20,
      source: "customer",
      breakId: null,
    });
    expect(
      resolvePrice(input({ qty: 4, customerPrices: [customer], lists: [base] })),
    ).toMatchObject({
      unitPrice: 18,
      breakId: "b2",
    });
    expect(
      resolvePrice(input({ qty: 10, customerPrices: [customer], lists: [base] })),
    ).toMatchObject({
      unitPrice: 12,
      breakId: "b10",
    });
    expect(
      resolvePrice(input({ customerPrices: [price("free", 0)], lists: [base] })),
    ).toMatchObject({
      unitPrice: 0,
      source: "customer",
    });
  });

  test("the latest covering promotion wins, then the base list", () => {
    const spring = list("spring", [price("spring-price", 5)]);
    const summer = list("summer", [price("summer-price", 9)]);
    const empty = list("empty", []);
    const base = list("base", [price("base-price", 8)], { isBase: true, createdAt: 1 });
    const promotions = [
      promotion("spring", "spring", "2020-06-01", "2020-06-30", 1),
      promotion("summer", "summer", "2020-06-10", "2020-06-30", 2),
      promotion("hollow", "empty", "2020-06-20", "2020-06-30", 3),
    ];
    const lists = [spring, summer, empty, base];

    expect(resolvePrice(input({ date: DAY("2020-06-15"), lists, promotions }))).toMatchObject({
      unitPrice: 9,
      source: "list",
      priceListId: "summer",
      promotionId: "summer",
    });
    expect(
      resolvePrice(input({ date: Date.parse("2020-06-15T18:00:00.000Z"), lists, promotions })),
    ).toMatchObject({ promotionId: "summer" });
    expect(resolvePrice(input({ date: DAY("2020-06-05"), lists, promotions }))).toMatchObject({
      unitPrice: 5,
      promotionId: "spring",
    });
    expect(resolvePrice(input({ date: DAY("2020-06-25"), lists, promotions }))).toMatchObject({
      unitPrice: 9,
      promotionId: "summer",
    });
    expect(resolvePrice(input({ date: DAY("2020-07-01"), lists, promotions }))).toMatchObject({
      unitPrice: 8,
      priceListId: "base",
      promotionId: null,
    });

    const tied = [
      promotion("first", "spring", "2020-06-01", "2020-06-30", 1),
      promotion("second", "summer", "2020-06-01", "2020-06-30", 2),
    ];
    expect(resolvePrice(input({ lists, promotions: tied }))).toMatchObject({
      unitPrice: 9,
      promotionId: "second",
    });

    expect(
      resolvePrice(
        input({
          lists: [list("spring", [price("spring-price", 5)], { active: false }), base],
          promotions: [promotion("spring", "spring", "2020-06-01", "2020-06-30", 1)],
        }),
      ),
    ).toMatchObject({ unitPrice: 8, promotionId: null });
  });

  test("the catalog fallback uses the variant price only in the base currency", () => {
    expect(
      resolvePrice(
        input({
          variantId: "red",
          catalog: { variantPrice: 0, productPrice: 100, baseCurrency: "GBP" },
        }),
      ),
    ).toMatchObject({ unitPrice: 0, source: "catalog" });
    expect(
      resolvePrice(
        input({
          variantId: "red",
          catalog: { variantPrice: null, productPrice: 100, baseCurrency: "GBP" },
        }),
      ),
    ).toMatchObject({ unitPrice: 100, source: "catalog" });
    expect(resolvePrice(input({ qty: 0 }))).toMatchObject({ unitPrice: null, source: null });
  });
});

describe("resolvePrice query", () => {
  test("walks the stored rows and rounds to the currency", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    const stranger = t.withIdentity({
      subject: `${await seedUser(t, "plain@example.com")}|session-1`,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("currencies", {
        code: "GBP",
        name: "Pound",
        decimalPlaces: 2,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("currencies", {
        code: "JPY",
        name: "Yen",
        decimalPlaces: 0,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("currencies", {
        code: "USD",
        name: "Dollar",
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
    });
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Bench",
        slug: "bench",
        sku: "BENCH",
        status: "active" as const,
        categoryIds: [],
        listPrice: 100,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const variantId = await t.run((ctx) =>
      ctx.db.insert("variants", {
        productId,
        optionValues: [],
        sku: "BENCH-RED",
        listPrice: 90,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const blueId = await t.run((ctx) =>
      ctx.db.insert("variants", {
        productId,
        optionValues: [],
        sku: "BENCH-BLUE",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const otherProductId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Other",
        slug: "other",
        sku: "OTHER",
        status: "draft" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const foreignVariantId = await t.run((ctx) =>
      ctx.db.insert("variants", {
        productId: otherProductId,
        optionValues: [],
        sku: "OTHER-RED",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const groupId = await t.run((ctx) =>
      ctx.db.insert("customerGroups", {
        name: "Wholesale",
        nameKey: "wholesale",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const customerId = await t.run((ctx) =>
      ctx.db.insert("customers", {
        code: "ACME",
        name: "Acme",
        status: "onHold" as const,
        paymentTermsDays: 0,
        currency: "GBP",
        groupId,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const closedId = await t.run((ctx) =>
      ctx.db.insert("customers", {
        code: "CLOSED",
        name: "Closed",
        status: "closed" as const,
        paymentTermsDays: 0,
        currency: "GBP",
        groupId,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    const ask = {
      customerId,
      productId,
      variantId,
      qty: 1,
      date: DAY("2020-06-15"),
      currency: "GBP",
    };
    await expect(t.query(api.sales.prices.resolvePrice, ask)).rejects.toThrow(/Not authenticated/);
    await expect(stranger.query(api.sales.prices.resolvePrice, ask)).rejects.toThrow(
      /permission to view sales/,
    );

    const standardId = await sales.mutation(api.sales.prices.createList, {
      name: "Standard",
      currency: "GBP",
      isBase: true,
    });
    const springListId = await sales.mutation(api.sales.prices.createList, {
      name: "Spring",
      currency: "GBP",
      isBase: false,
    });
    const summerListId = await sales.mutation(api.sales.prices.createList, {
      name: "Summer",
      currency: "GBP",
      isBase: false,
    });
    await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: standardId,
      productId,
      variantId: null,
      price: 50,
    });
    const variantPriceId = await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: standardId,
      productId,
      variantId,
      price: 40,
    });
    await sales.mutation(api.sales.prices.setBreak, {
      target: { scope: "list", priceId: variantPriceId },
      minQty: 2,
      price: 30,
    });
    await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: springListId,
      productId,
      variantId,
      price: 5,
    });
    await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: summerListId,
      productId,
      variantId,
      price: 9,
    });
    await sales.mutation(api.sales.prices.setGroupPrice, {
      groupId,
      productId,
      variantId: null,
      currency: "GBP",
      price: 20,
    });
    const customerPriceId = await sales.mutation(api.sales.prices.setCustomerPrice, {
      customerId,
      productId,
      variantId: null,
      currency: "GBP",
      price: 10.126,
    });
    await sales.mutation(api.sales.prices.setBreak, {
      target: { scope: "customer", priceId: customerPriceId },
      minQty: 5,
      price: 8,
    });
    await sales.mutation(api.sales.prices.setCustomerPrice, {
      customerId,
      productId,
      variantId: null,
      currency: "JPY",
      price: 10.6,
    });

    expect(await warehouse.query(api.sales.prices.resolvePrice, ask)).toMatchObject({
      unitPrice: 10.13,
      source: "customer",
      currency: "GBP",
      decimalPlaces: 2,
      breakId: null,
    });
    expect(await accountant.query(api.sales.prices.resolvePrice, { ...ask, qty: 5 })).toMatchObject(
      {
        unitPrice: 8,
        source: "customer",
      },
    );
    expect(
      await sales.query(api.sales.prices.resolvePrice, { ...ask, currency: "jpy" }),
    ).toMatchObject({
      unitPrice: 11,
      source: "customer",
      currency: "JPY",
      decimalPlaces: 0,
    });
    expect(
      await sales.query(api.sales.prices.resolvePrice, { ...ask, customerId: closedId }),
    ).toMatchObject({
      unitPrice: 20,
      source: "group",
    });

    await sales.mutation(api.sales.prices.removeCustomerPrice, { priceId: customerPriceId });
    await t.run((ctx) => ctx.db.patch(groupId, { active: false }));
    expect(await sales.query(api.sales.prices.resolvePrice, ask)).toMatchObject({
      unitPrice: 20,
      source: "group",
    });

    const groupPrices = await sales.query(api.sales.prices.listGroupPrices, { groupId });
    const groupPriceId = groupPrices?.prices[0]?._id;
    if (groupPriceId === undefined) throw new Error("group price missing");
    await sales.mutation(api.sales.prices.removeGroupPrice, { priceId: groupPriceId });
    expect(await sales.query(api.sales.prices.resolvePrice, ask)).toMatchObject({
      unitPrice: 40,
      source: "list",
      priceListId: standardId,
      promotionId: null,
    });
    expect(await sales.query(api.sales.prices.resolvePrice, { ...ask, qty: 2 })).toMatchObject({
      unitPrice: 30,
      source: "list",
    });

    const springId = await sales.mutation(api.sales.prices.createPromotion, {
      name: "Spring",
      startsOn: DAY("2020-06-01"),
      endsOn: DAY("2020-06-30"),
      active: true,
      priceListId: springListId,
    });
    const summerId = await sales.mutation(api.sales.prices.createPromotion, {
      name: "Summer",
      startsOn: DAY("2020-06-10"),
      endsOn: DAY("2020-06-30"),
      active: true,
      priceListId: summerListId,
    });
    expect(await sales.query(api.sales.prices.resolvePrice, ask)).toMatchObject({
      unitPrice: 9,
      priceListId: summerListId,
      promotionId: summerId,
    });
    expect(
      await sales.query(api.sales.prices.resolvePrice, { ...ask, date: DAY("2020-06-05") }),
    ).toMatchObject({ unitPrice: 5, promotionId: springId });
    expect(
      await sales.query(api.sales.prices.resolvePrice, { ...ask, date: DAY("2020-07-01") }),
    ).toMatchObject({ unitPrice: 40, priceListId: standardId, promotionId: null });

    await sales.mutation(api.sales.prices.updateList, {
      listId: summerListId,
      name: "Summer",
      active: false,
      isBase: false,
    });
    expect(await sales.query(api.sales.prices.resolvePrice, ask)).toMatchObject({
      unitPrice: 5,
      promotionId: springId,
    });

    await sales.mutation(api.sales.prices.removeListPrice, { priceId: variantPriceId });
    const listed = await sales.query(api.sales.prices.getList, { listId: standardId });
    const productPriceId = listed?.prices.find((row) => row.variantId === null)?._id;
    if (productPriceId === undefined) throw new Error("product price missing");
    await sales.mutation(api.sales.prices.removeListPrice, { priceId: productPriceId });
    const springListed = await sales.query(api.sales.prices.getList, { listId: springListId });
    const springPriceId = springListed?.prices[0]?._id;
    if (springPriceId === undefined) throw new Error("spring price missing");
    await sales.mutation(api.sales.prices.removeListPrice, { priceId: springPriceId });
    expect(await sales.query(api.sales.prices.resolvePrice, ask)).toMatchObject({
      unitPrice: 90,
      source: "catalog",
    });
    expect(
      await sales.query(api.sales.prices.resolvePrice, { ...ask, currency: "USD" }),
    ).toMatchObject({
      unitPrice: null,
      source: null,
    });

    await expect(sales.query(api.sales.prices.resolvePrice, { ...ask, qty: 0 })).rejects.toThrow(
      /greater than zero/,
    );
    await expect(
      sales.query(api.sales.prices.resolvePrice, { ...ask, currency: "NOPE" }),
    ).rejects.toThrow(/Currency not found/);
    await expect(
      sales.query(api.sales.prices.resolvePrice, { ...ask, variantId: blueId }),
    ).resolves.toMatchObject({ unitPrice: 100, source: "catalog" });
    await expect(
      sales.query(api.sales.prices.resolvePrice, { ...ask, variantId: foreignVariantId }),
    ).rejects.toThrow(/not on this product/);
  });
});
