import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  MAX_PRICE,
  breakQtyError,
  priceDayFromInput,
  priceError,
  priceListNameError,
  promotionRangeError,
} from "../lib/pricing";
import { setup } from "./setup";

/**
 * PH2-06 — stored prices. A base list, group prices, customer prices,
 * quantity breaks on one of those rows, and a dated promotion. Which
 * row a sale uses is PH2-07. The manager screens are PH2-09.
 * `linePreview` is the sales-line total and margin.
 */

type T = ReturnType<typeof setup>;

const DAY = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

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

async function seedCurrency(t: T, code: string, active: boolean) {
  await t.run((ctx) =>
    ctx.db.insert("currencies", {
      code,
      name: code,
      decimalPlaces: 2,
      active,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedProduct(t: T, sku: string, status: "draft" | "active" | "archived" = "active") {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: sku,
      slug: sku.toLowerCase(),
      sku,
      status,
      categoryIds: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedVariant(t: T, productId: Id<"products">, sku: string) {
  return await t.run((ctx) =>
    ctx.db.insert("variants", {
      productId,
      optionValues: [],
      sku,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedGroup(t: T, name: string, active: boolean) {
  return await t.run((ctx) =>
    ctx.db.insert("customerGroups", {
      name,
      nameKey: name.toLowerCase(),
      active,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function seedCustomer(t: T, code: string, status: "active" | "onHold" | "closed") {
  return await t.run((ctx) =>
    ctx.db.insert("customers", {
      code,
      name: code,
      status,
      paymentTermsDays: 0,
      currency: "GBP",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("price rules", () => {
  test("a stored price, a break quantity, a list name, and a window", () => {
    expect(priceError(0)).toBeNull();
    expect(priceError(MAX_PRICE)).toBeNull();
    expect(priceError(-1)).toMatch(/negative/);
    expect(priceError(Number.POSITIVE_INFINITY)).toMatch(/finite/);
    expect(priceError(MAX_PRICE + 0.01)).toMatch(/or less/);
    expect(breakQtyError(1)).toMatch(/starts at 2/);
    expect(breakQtyError(2.5)).toMatch(/whole number/);
    expect(breakQtyError(2)).toBeNull();
    expect(priceListNameError("  ")).toMatch(/required/);
    expect(priceListNameError("Standard")).toBeNull();
    expect(promotionRangeError(DAY("2020-01-02"), DAY("2020-01-01"))).toMatch(/before/);
    expect(promotionRangeError(1, DAY("2020-01-01"))).toMatch(/start date/);
    expect(promotionRangeError(DAY("2020-01-01"), DAY("2020-01-01"))).toBeNull();
    expect(priceDayFromInput("2020-02-31")).toMatchObject({ error: expect.stringMatching(/date/) });
    expect(priceDayFromInput("2020-06-15")).toEqual({ ms: DAY("2020-06-15") });
  });
});

describe("price lists", () => {
  test("lists, tiers, breaks, and a dated promotion", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const accountant = await asRole(t, "accountant");
    const owner = await asRole(t, "owner");
    const strangerId = await seedUser(t, "none@example.com");
    const stranger = t.withIdentity({ subject: `${strangerId}|session-1` });
    await seedCurrency(t, "GBP", true);
    await seedCurrency(t, "USD", true);
    await seedCurrency(t, "EUR", false);
    const draftId = await seedProduct(t, "DRAFT", "draft");
    const liveId = await seedProduct(t, "LIVE");
    const variantId = await seedVariant(t, liveId, "LIVE-RED");
    const otherVariantId = await seedVariant(t, draftId, "DRAFT-RED");
    const wholesaleId = await seedGroup(t, "Wholesale", true);
    const retiredId = await seedGroup(t, "Retired", false);
    const heldId = await seedCustomer(t, "HELD", "onHold");
    const closedId = await seedCustomer(t, "CLOSED", "closed");

    await expect(
      t.mutation(api.sales.prices.createList, { name: "Standard", currency: "GBP", isBase: false }),
    ).rejects.toThrow(/Not authenticated/);
    await expect(
      stranger.mutation(api.sales.prices.createList, {
        name: "Standard",
        currency: "GBP",
        isBase: false,
      }),
    ).rejects.toThrow(/permission to create sales/);
    await expect(
      warehouse.mutation(api.sales.prices.createList, {
        name: "Standard",
        currency: "GBP",
        isBase: false,
      }),
    ).rejects.toThrow(/permission to create sales/);
    await expect(
      accountant.mutation(api.sales.prices.createList, {
        name: "Standard",
        currency: "GBP",
        isBase: false,
      }),
    ).rejects.toThrow(/permission to create sales/);

    const standardId = await sales.mutation(api.sales.prices.createList, {
      name: "  Standard  ",
      currency: "gbp",
      isBase: false,
    });
    const created = await sales.query(api.sales.prices.getList, { listId: standardId });
    expect(created?.list).toMatchObject({
      name: "Standard",
      currency: "GBP",
      isBase: true,
      active: true,
    });
    await sales.mutation(api.sales.prices.updateList, {
      listId: standardId,
      name: "Standard",
      active: true,
      isBase: false,
    });
    expect((await sales.query(api.sales.prices.getList, { listId: standardId }))?.list.isBase).toBe(
      true,
    );

    await expect(
      sales.mutation(api.sales.prices.createList, {
        name: "standard",
        currency: "GBP",
        isBase: false,
      }),
    ).rejects.toThrow(/already exists/);
    await expect(
      sales.mutation(api.sales.prices.createList, {
        name: "Export",
        currency: "EUR",
        isBase: false,
      }),
    ).rejects.toThrow(/inactive/);

    await sales.mutation(api.sales.prices.updateList, {
      listId: standardId,
      name: "Standard",
      currency: "USD",
      active: true,
      isBase: true,
    });
    expect(
      (await sales.query(api.sales.prices.getList, { listId: standardId }))?.list.currency,
    ).toBe("USD");

    const priceId = await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: standardId,
      productId: draftId,
      variantId: null,
      price: 0,
    });
    await expect(
      sales.mutation(api.sales.prices.updateList, {
        listId: standardId,
        name: "Standard",
        currency: "GBP",
        active: true,
        isBase: true,
      }),
    ).rejects.toThrow(/Currency stays/);
    await expect(
      sales.mutation(api.sales.prices.setListPrice, {
        priceListId: standardId,
        productId: liveId,
        variantId: otherVariantId,
        price: 10,
      }),
    ).rejects.toThrow(/not on this product/);

    const variantPriceId = await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: standardId,
      productId: liveId,
      variantId,
      price: 10,
    });
    const again = await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: standardId,
      productId: liveId,
      variantId,
      price: 12,
    });
    expect(again).toBe(variantPriceId);

    await expect(
      sales.mutation(api.sales.prices.setBreak, {
        target: { scope: "list", priceId },
        minQty: 1,
        price: 8,
      }),
    ).rejects.toThrow(/starts at 2/);
    const removedId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("priceListPrices", {
        priceListId: standardId,
        productId: liveId,
        price: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      sales.mutation(api.sales.prices.setBreak, {
        target: { scope: "list", priceId: removedId },
        minQty: 2,
        price: 8,
      }),
    ).rejects.toThrow(/no longer exists/);

    const breakId = await sales.mutation(api.sales.prices.setBreak, {
      target: { scope: "list", priceId: variantPriceId },
      minQty: 2,
      price: 8,
    });
    const updatedBreak = await sales.mutation(api.sales.prices.setBreak, {
      target: { scope: "list", priceId: variantPriceId },
      minQty: 2,
      price: 7,
    });
    expect(updatedBreak).toBe(breakId);
    const withBreak = await sales.query(api.sales.prices.getList, { listId: standardId });
    const variantRow = withBreak?.prices.find((row) => row._id === variantPriceId);
    expect(variantRow?.breaks).toEqual([{ _id: breakId, minQty: 2, price: 7 }]);
    expect(variantRow?.variantSku).toBe("LIVE-RED");

    await sales.mutation(api.sales.prices.removeListPrice, { priceId: variantPriceId });
    const afterRemove = await sales.query(api.sales.prices.getList, { listId: standardId });
    expect(afterRemove?.prices.map((row) => row._id)).toEqual([priceId]);
    expect(await t.run((ctx) => ctx.db.query("quantityBreaks").collect())).toHaveLength(0);

    await sales.mutation(api.sales.prices.updateList, {
      listId: standardId,
      name: "Standard",
      active: false,
      isBase: true,
    });
    await expect(
      sales.mutation(api.sales.prices.setListPrice, {
        priceListId: standardId,
        productId: liveId,
        variantId: null,
        price: 5,
      }),
    ).rejects.toThrow(/inactive/);

    const exportId = await sales.mutation(api.sales.prices.createList, {
      name: "Export",
      currency: "GBP",
      isBase: true,
    });
    const lists = await warehouse.query(api.sales.prices.listLists, {});
    expect(lists.find((row) => row._id === exportId)?.isBase).toBe(true);
    expect(lists.find((row) => row._id === standardId)?.isBase).toBe(false);
    await sales.mutation(api.sales.prices.updateList, {
      listId: exportId,
      name: "Export",
      active: true,
      isBase: false,
    });
    expect((await sales.query(api.sales.prices.getList, { listId: standardId }))?.list.isBase).toBe(
      true,
    );
    expect((await sales.query(api.sales.prices.getList, { listId: exportId }))?.list.isBase).toBe(
      false,
    );
    await sales.mutation(api.sales.prices.updateList, {
      listId: exportId,
      name: "Export",
      active: true,
      isBase: true,
    });
    await sales.mutation(api.sales.prices.updateList, {
      listId: exportId,
      name: "Export",
      active: false,
      isBase: true,
    });
    expect((await sales.query(api.sales.prices.getList, { listId: standardId }))?.list.isBase).toBe(
      true,
    );
    expect((await sales.query(api.sales.prices.getList, { listId: exportId }))?.list.isBase).toBe(
      false,
    );
    await sales.mutation(api.sales.prices.updateList, {
      listId: exportId,
      name: "Export",
      active: true,
      isBase: false,
    });

    await expect(
      sales.mutation(api.sales.prices.setGroupPrice, {
        groupId: retiredId,
        productId: liveId,
        variantId: null,
        currency: "GBP",
        price: 4,
      }),
    ).rejects.toThrow(/inactive/);
    const groupPriceId = await sales.mutation(api.sales.prices.setGroupPrice, {
      groupId: wholesaleId,
      productId: liveId,
      variantId: null,
      currency: "GBP",
      price: 9,
    });
    await sales.mutation(api.sales.prices.setBreak, {
      target: { scope: "group", priceId: groupPriceId },
      minQty: 5,
      price: 6,
    });
    const groupView = await accountant.query(api.sales.prices.listGroupPrices, {
      groupId: wholesaleId,
    });
    expect(groupView?.prices).toHaveLength(1);
    expect(groupView?.prices[0]?.breaks[0]?.minQty).toBe(5);

    await expect(
      sales.mutation(api.sales.prices.setCustomerPrice, {
        customerId: closedId,
        productId: liveId,
        variantId: null,
        currency: "GBP",
        price: 3,
      }),
    ).rejects.toThrow(/closed/);
    const customerPriceId = await sales.mutation(api.sales.prices.setCustomerPrice, {
      customerId: heldId,
      productId: liveId,
      variantId: null,
      currency: "GBP",
      price: 11,
    });
    const customerView = await sales.query(api.sales.prices.listCustomerPrices, {
      customerId: heldId,
    });
    expect(customerView?.prices[0]?.price).toBe(11);

    await expect(
      sales.mutation(api.sales.prices.createPromotion, {
        name: "Spring",
        startsOn: DAY("2020-06-02"),
        endsOn: DAY("2020-06-01"),
        active: true,
        priceListId: exportId,
      }),
    ).rejects.toThrow(/before/);
    await expect(
      sales.mutation(api.sales.prices.createPromotion, {
        name: "Old",
        startsOn: DAY("2020-01-01"),
        endsOn: DAY("2020-01-31"),
        active: true,
        priceListId: standardId,
      }),
    ).rejects.toThrow(/inactive/);
    const springId = await sales.mutation(api.sales.prices.createPromotion, {
      name: "Spring",
      startsOn: DAY("2020-01-01"),
      endsOn: DAY("2020-01-31"),
      active: true,
      priceListId: exportId,
    });
    const summerId = await sales.mutation(api.sales.prices.createPromotion, {
      name: "Summer",
      startsOn: DAY("2020-01-01"),
      endsOn: DAY("2020-01-31"),
      active: true,
      priceListId: null,
    });
    expect(summerId).not.toBe(springId);
    await sales.mutation(api.sales.prices.updateList, {
      listId: exportId,
      name: "Export",
      active: false,
      isBase: false,
    });
    await sales.mutation(api.sales.prices.updatePromotion, {
      promotionId: springId,
      name: "Spring sale",
      startsOn: DAY("2020-01-01"),
      endsOn: DAY("2020-01-31"),
      active: true,
      priceListId: exportId,
    });
    await sales.mutation(api.sales.prices.updatePromotion, {
      promotionId: springId,
      name: "Spring sale",
      startsOn: DAY("2020-01-01"),
      endsOn: DAY("2020-01-31"),
      active: false,
      priceListId: null,
    });
    const promotions = await sales.query(api.sales.prices.listPromotions, {});
    expect(promotions.find((row) => row._id === springId)).toMatchObject({
      name: "Spring sale",
      active: false,
      priceListId: null,
    });

    await owner.mutation(api.catalog.variants.remove, { id: variantId });
    await sales.mutation(api.sales.prices.updateList, {
      listId: exportId,
      name: "Export",
      active: true,
      isBase: false,
    });
    const freshVariantId = await seedVariant(t, liveId, "LIVE-BLUE");
    await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: exportId,
      productId: liveId,
      variantId: null,
      price: 4,
    });
    const bluePriceId = await sales.mutation(api.sales.prices.setListPrice, {
      priceListId: exportId,
      productId: liveId,
      variantId: freshVariantId,
      price: 5,
    });
    await sales.mutation(api.sales.prices.setBreak, {
      target: { scope: "list", priceId: bluePriceId },
      minQty: 3,
      price: 2,
    });
    await sales.mutation(api.catalog.variants.remove, { id: freshVariantId });
    const afterVariant = await sales.query(api.sales.prices.getList, { listId: exportId });
    expect(afterVariant?.prices.map((row) => row.variantId)).toEqual([null]);

    await owner.mutation(api.catalog.products.remove, { id: liveId });
    const afterProduct = await sales.query(api.sales.prices.getList, { listId: exportId });
    expect(afterProduct?.prices).toEqual([]);
    const groupAfter = await sales.query(api.sales.prices.listGroupPrices, {
      groupId: wholesaleId,
    });
    expect(groupAfter?.prices).toEqual([]);
    const customerAfter = await sales.query(api.sales.prices.listCustomerPrices, {
      customerId: heldId,
    });
    expect(customerAfter?.prices).toEqual([]);
    expect(customerPriceId).toBeTruthy();

    const audits = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audits.some((row) => row.entity === "priceLists" && row.action === "create")).toBe(true);
    expect(audits.some((row) => row.entity === "quantityBreaks" && row.action === "set")).toBe(
      true,
    );
    const createdAudit = audits.find(
      (row) => row.entity === "priceLists" && row.action === "create",
    );
    expect(createdAudit?.before).toBeUndefined();
  });
});

describe("sales line preview", () => {
  test("the line total and the margin follow the price that won", async () => {
    const t = setup();
    const sales = await asRole(t, "sales");
    const warehouse = await asRole(t, "warehouse");
    const strangerId = await seedUser(t, "none-preview@example.com");
    const stranger = t.withIdentity({ subject: `${strangerId}|session-1` });
    await seedCurrency(t, "GBP", true);
    await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Chris",
        baseCurrency: "GBP",
        active: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Bench",
        slug: "bench",
        sku: "BENCH",
        status: "active" as const,
        categoryIds: [],
        listPrice: 100,
        costPrice: 40,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const customerId = await seedCustomer(t, "ACME", "active");
    const args = {
      customerId,
      productId,
      variantId: null,
      qty: 2,
      date: DAY("2026-11-08"),
      currency: "gbp",
    };
    await expect(stranger.query(api.sales.prices.linePreview, args)).rejects.toThrow(
      /permission to view sales/,
    );
    expect(await sales.query(api.sales.prices.currencyChoices, {})).toMatchObject({
      baseCurrency: "GBP",
      currencies: [{ code: "GBP", decimalPlaces: 2, active: true }],
    });
    expect(await sales.query(api.sales.prices.linePreview, args)).toMatchObject({
      unitPrice: 100,
      source: "catalog",
      currency: "GBP",
      decimalPlaces: 2,
      qty: 2,
      lineAmount: 200,
      costPrice: 40,
      marginPercent: 60,
    });

    const priceId = await sales.mutation(api.sales.prices.setCustomerPrice, {
      customerId,
      productId,
      variantId: null,
      currency: "GBP",
      price: 80,
    });
    await sales.mutation(api.sales.prices.setBreak, {
      target: { scope: "customer", priceId },
      minQty: 5,
      price: 50,
    });
    expect(await warehouse.query(api.sales.prices.linePreview, { ...args, qty: 5 })).toMatchObject({
      unitPrice: 50,
      source: "customer",
      breakId: expect.any(String),
      lineAmount: 250,
      marginPercent: 20,
    });
    expect(await sales.query(api.sales.prices.linePreview, { ...args, qty: 1 })).toMatchObject({
      unitPrice: 80,
      source: "customer",
      breakId: null,
      lineAmount: 80,
      marginPercent: 50,
    });
  });
});
