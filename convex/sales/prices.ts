import { ConvexError, v } from "convex/values";
import {
  breakQtyError,
  lineAmount,
  marginPercent,
  normalizePriceName,
  priceDay,
  priceError,
  priceListNameError,
  priceListNameKey,
  promotionNameError,
  promotionRangeError,
  resolvePrice as resolvePriceFromRows,
  resolveQtyError,
  type PriceCandidate,
  type ResolvedPrice,
} from "../../lib/pricing";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Stored prices (PH2-06). A base list, a price per product on that
 * list, a group price, a customer price, a quantity break hanging off
 * one of those rows, and a dated promotion that may name a list.
 *
 * Reads are `sales.view`. Every write is `sales.create`, including a
 * change or a removal, so a warehouse user's `sales.edit` (fulfillment)
 * cannot change a price. There is no delete of a list or a promotion:
 * deactivate it. `resolvePrice` (PH2-07) is the read that picks the row.
 * The manager screens are the pricing pages (PH2-09).
 */

type ReadCtx = QueryCtx | MutationCtx;
type VariantId = Id<"variants"> | null;

const breakTarget = v.union(
  v.object({ scope: v.literal("list"), priceId: v.id("priceListPrices") }),
  v.object({ scope: v.literal("group"), priceId: v.id("customerGroupPrices") }),
  v.object({ scope: v.literal("customer"), priceId: v.id("customerPrices") }),
);

function assertPrice(price: number) {
  const message = priceError(price);
  if (message !== null) throw new ConvexError(message);
}

function parsedListName(raw: string) {
  const message = priceListNameError(raw);
  if (message !== null) throw new ConvexError(message);
  const name = normalizePriceName(raw);
  return { name, nameKey: priceListNameKey(name) };
}

function parsedPromotionName(raw: string) {
  const message = promotionNameError(raw);
  if (message !== null) throw new ConvexError(message);
  const name = normalizePriceName(raw);
  return { name, nameKey: priceListNameKey(name) };
}

function assertRange(startsOn: number, endsOn: number) {
  const message = promotionRangeError(startsOn, endsOn);
  if (message !== null) throw new ConvexError(message);
}

function assertBreakQty(qty: number) {
  const message = breakQtyError(qty);
  if (message !== null) throw new ConvexError(message);
}

function sameVariant(row: { variantId?: Id<"variants"> }, variantId: VariantId) {
  return (row.variantId ?? null) === variantId;
}

function variantFields(
  variantId: VariantId,
): { variantId: Id<"variants"> } | Record<string, never> {
  return variantId === null ? {} : { variantId };
}

async function requireCurrency(ctx: ReadCtx, code: string) {
  const normalized = code.trim().toUpperCase();
  const currency = await ctx.db
    .query("currencies")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
  if (currency === null) throw new ConvexError("Currency not found.");
  if (!currency.active) throw new ConvexError("That currency is inactive.");
  return normalized;
}

async function requireSellable(ctx: ReadCtx, productId: Id<"products">, variantId: VariantId) {
  const product = await ctx.db.get(productId);
  if (product === null) throw new ConvexError("Product not found.");
  if (variantId === null) return;
  const variant = await ctx.db.get(variantId);
  if (variant === null) throw new ConvexError("Variant not found.");
  if (variant.productId !== productId) {
    throw new ConvexError("That variant is not on this product.");
  }
}

async function listByName(ctx: ReadCtx, nameKey: string) {
  return await ctx.db
    .query("priceLists")
    .withIndex("by_name_key", (q) => q.eq("nameKey", nameKey))
    .unique();
}

function oldestOther<T extends { _id: string; createdAt: number }>(rows: T[], selfId: string) {
  const others = rows.filter((row) => row._id !== selfId);
  others.sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
  return others[0] ?? null;
}

async function describeProduct(ctx: ReadCtx, productId: Id<"products">, variantId: VariantId) {
  const product = await ctx.db.get(productId);
  const variant = variantId === null ? null : await ctx.db.get(variantId);
  return {
    productName: product?.name ?? "",
    sku: variant?.sku ?? product?.sku ?? "",
    variantSku: variant?.sku ?? null,
    variantId,
  };
}

type ListedBreak = { _id: Id<"quantityBreaks">; minQty: number; price: number };

function listedBreaks(rows: Doc<"quantityBreaks">[]): ListedBreak[] {
  return rows
    .map((row) => ({ _id: row._id, minQty: row.minQty, price: row.price }))
    .sort((a, b) => a.minQty - b.minQty || a._id.localeCompare(b._id));
}

async function breaksForListPrice(ctx: ReadCtx, priceId: Id<"priceListPrices">) {
  return listedBreaks(
    await ctx.db
      .query("quantityBreaks")
      .withIndex("by_list_price", (q) => q.eq("priceListPriceId", priceId))
      .collect(),
  );
}

async function breaksForGroupPrice(ctx: ReadCtx, priceId: Id<"customerGroupPrices">) {
  return listedBreaks(
    await ctx.db
      .query("quantityBreaks")
      .withIndex("by_group_price", (q) => q.eq("customerGroupPriceId", priceId))
      .collect(),
  );
}

async function breaksForCustomerPrice(ctx: ReadCtx, priceId: Id<"customerPrices">) {
  return listedBreaks(
    await ctx.db
      .query("quantityBreaks")
      .withIndex("by_customer_price", (q) => q.eq("customerPriceId", priceId))
      .collect(),
  );
}

export const listLists = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const lists = await ctx.db.query("priceLists").collect();
    const withCounts = await Promise.all(
      lists.map(async (list) => ({
        _id: list._id,
        name: list.name,
        currency: list.currency,
        active: list.active,
        isBase: list.isBase,
        priceCount: (
          await ctx.db
            .query("priceListPrices")
            .withIndex("by_list", (q) => q.eq("priceListId", list._id))
            .collect()
        ).length,
      })),
    );
    return withCounts.sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
  },
});

export const getList = query({
  args: { listId: v.id("priceLists") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const list = await ctx.db.get(args.listId);
    if (list === null) return null;
    const rows = await ctx.db
      .query("priceListPrices")
      .withIndex("by_list", (q) => q.eq("priceListId", list._id))
      .collect();
    const prices = await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        productId: row.productId,
        price: row.price,
        ...(await describeProduct(ctx, row.productId, row.variantId ?? null)),
        breaks: await breaksForListPrice(ctx, row._id),
      })),
    );
    prices.sort((a, b) => a.sku.localeCompare(b.sku) || a._id.localeCompare(b._id));
    return {
      list: {
        _id: list._id,
        name: list.name,
        currency: list.currency,
        active: list.active,
        isBase: list.isBase,
        updatedAt: list.updatedAt,
      },
      prices,
    };
  },
});

export const createList = auditedMutation({
  entity: "priceLists",
  action: "create",
  args: {
    name: v.string(),
    currency: v.string(),
    isBase: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const { name, nameKey } = parsedListName(args.name);
    const currency = await requireCurrency(ctx, args.currency);
    const taken = await listByName(ctx, nameKey);
    if (taken !== null) throw new ConvexError(`A price list named ${name} already exists.`);
    const existing = await ctx.db.query("priceLists").collect();
    const isBase = existing.length === 0 || args.isBase;
    const now = Date.now();
    if (isBase) {
      for (const row of existing) {
        if (row.isBase) await ctx.db.patch(row._id, { isBase: false, updatedAt: now });
      }
    }
    const listId = await ctx.db.insert("priceLists", {
      name,
      nameKey,
      currency,
      active: true,
      isBase,
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: listId,
      audit: { entityId: listId, after: { name, currency, isBase, active: true } },
    };
  },
});

export const updateList = auditedMutation({
  entity: "priceLists",
  action: "update",
  args: {
    listId: v.id("priceLists"),
    name: v.string(),
    currency: v.optional(v.string()),
    active: v.boolean(),
    isBase: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const list = await ctx.db.get(args.listId);
    if (list === null) throw new ConvexError("Price list not found.");
    const { name, nameKey } = parsedListName(args.name);
    const taken = await listByName(ctx, nameKey);
    if (taken !== null && taken._id !== list._id) {
      throw new ConvexError(`A price list named ${name} already exists.`);
    }
    let currency = list.currency;
    if (args.currency !== undefined) {
      const next = await requireCurrency(ctx, args.currency);
      if (next !== list.currency) {
        const prices = await ctx.db
          .query("priceListPrices")
          .withIndex("by_list", (q) => q.eq("priceListId", list._id))
          .collect();
        if (prices.length > 0) throw new ConvexError("This list has prices. Currency stays.");
        currency = next;
      }
    }
    const all = await ctx.db.query("priceLists").collect();
    let isBase = list.isBase;
    const now = Date.now();
    // An inactive list cannot hold the base when another list exists.
    // The only list stays the base, including after it is deactivated.
    if (args.isBase && args.active) {
      isBase = true;
      for (const row of all) {
        if (row._id !== list._id && row.isBase) {
          await ctx.db.patch(row._id, { isBase: false, updatedAt: now });
        }
      }
    } else if (list.isBase) {
      const heir = oldestOther(all, list._id);
      if (heir === null) {
        isBase = true;
      } else {
        isBase = false;
        await ctx.db.patch(heir._id, { isBase: true, updatedAt: now });
      }
    }
    await ctx.db.patch(list._id, {
      name,
      nameKey,
      currency,
      active: args.active,
      isBase,
      updatedAt: now,
    });
    return {
      result: list._id,
      audit: {
        entityId: list._id,
        before: {
          name: list.name,
          currency: list.currency,
          active: list.active,
          isBase: list.isBase,
        },
        after: { name, currency, active: args.active, isBase },
      },
    };
  },
});

export const setListPrice = auditedMutation({
  entity: "priceListPrices",
  action: "set",
  args: {
    priceListId: v.id("priceLists"),
    productId: v.id("products"),
    variantId: v.union(v.id("variants"), v.null()),
    price: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const list = await ctx.db.get(args.priceListId);
    if (list === null) throw new ConvexError("Price list not found.");
    if (!list.active) throw new ConvexError("That price list is inactive.");
    await requireSellable(ctx, args.productId, args.variantId);
    assertPrice(args.price);
    const rows = await ctx.db
      .query("priceListPrices")
      .withIndex("by_list_product", (q) =>
        q.eq("priceListId", args.priceListId).eq("productId", args.productId),
      )
      .collect();
    const existing = rows.find((row) => sameVariant(row, args.variantId)) ?? null;
    const now = Date.now();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { price: args.price, updatedAt: now });
      return {
        result: existing._id,
        audit: {
          entityId: existing._id,
          before: { price: existing.price },
          after: { price: args.price },
        },
      };
    }
    const priceId = await ctx.db.insert("priceListPrices", {
      priceListId: args.priceListId,
      productId: args.productId,
      price: args.price,
      createdAt: now,
      updatedAt: now,
      ...variantFields(args.variantId),
    });
    return {
      result: priceId,
      audit: {
        entityId: priceId,
        after: { priceListId: args.priceListId, productId: args.productId, price: args.price },
      },
    };
  },
});

export const removeListPrice = auditedMutation({
  entity: "priceListPrices",
  action: "delete",
  args: { priceId: v.id("priceListPrices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await ctx.db.get(args.priceId);
    if (row === null) throw new ConvexError("This price no longer exists.");
    const breaks = await ctx.db
      .query("quantityBreaks")
      .withIndex("by_list_price", (q) => q.eq("priceListPriceId", row._id))
      .collect();
    for (const item of breaks) await ctx.db.delete(item._id);
    await ctx.db.delete(row._id);
    return {
      result: undefined,
      audit: {
        entityId: row._id,
        before: { priceListId: row.priceListId, productId: row.productId, price: row.price },
      },
    };
  },
});

export const listGroupPrices = query({
  args: { groupId: v.id("customerGroups") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const group = await ctx.db.get(args.groupId);
    if (group === null) return null;
    const rows = await ctx.db
      .query("customerGroupPrices")
      .withIndex("by_group", (q) => q.eq("customerGroupId", group._id))
      .collect();
    const prices = await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        productId: row.productId,
        currency: row.currency,
        price: row.price,
        ...(await describeProduct(ctx, row.productId, row.variantId ?? null)),
        breaks: await breaksForGroupPrice(ctx, row._id),
      })),
    );
    prices.sort(
      (a, b) =>
        a.sku.localeCompare(b.sku) ||
        a.currency.localeCompare(b.currency) ||
        a._id.localeCompare(b._id),
    );
    return { group: { _id: group._id, name: group.name, active: group.active }, prices };
  },
});

export const setGroupPrice = auditedMutation({
  entity: "customerGroupPrices",
  action: "set",
  args: {
    groupId: v.id("customerGroups"),
    productId: v.id("products"),
    variantId: v.union(v.id("variants"), v.null()),
    currency: v.string(),
    price: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const group = await ctx.db.get(args.groupId);
    if (group === null) throw new ConvexError("Customer group not found.");
    if (!group.active) throw new ConvexError("That customer group is inactive.");
    await requireSellable(ctx, args.productId, args.variantId);
    const currency = await requireCurrency(ctx, args.currency);
    assertPrice(args.price);
    const rows = await ctx.db
      .query("customerGroupPrices")
      .withIndex("by_group_product", (q) =>
        q.eq("customerGroupId", args.groupId).eq("productId", args.productId),
      )
      .collect();
    const existing =
      rows.find((row) => sameVariant(row, args.variantId) && row.currency === currency) ?? null;
    const now = Date.now();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { price: args.price, updatedAt: now });
      return {
        result: existing._id,
        audit: {
          entityId: existing._id,
          before: { price: existing.price },
          after: { price: args.price },
        },
      };
    }
    const priceId = await ctx.db.insert("customerGroupPrices", {
      customerGroupId: args.groupId,
      productId: args.productId,
      currency,
      price: args.price,
      createdAt: now,
      updatedAt: now,
      ...variantFields(args.variantId),
    });
    return {
      result: priceId,
      audit: {
        entityId: priceId,
        after: { groupId: args.groupId, productId: args.productId, currency, price: args.price },
      },
    };
  },
});

export const removeGroupPrice = auditedMutation({
  entity: "customerGroupPrices",
  action: "delete",
  args: { priceId: v.id("customerGroupPrices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await ctx.db.get(args.priceId);
    if (row === null) throw new ConvexError("This price no longer exists.");
    const breaks = await ctx.db
      .query("quantityBreaks")
      .withIndex("by_group_price", (q) => q.eq("customerGroupPriceId", row._id))
      .collect();
    for (const item of breaks) await ctx.db.delete(item._id);
    await ctx.db.delete(row._id);
    return {
      result: undefined,
      audit: {
        entityId: row._id,
        before: {
          customerGroupId: row.customerGroupId,
          productId: row.productId,
          price: row.price,
        },
      },
    };
  },
});

export const listCustomerPrices = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const customer = await ctx.db.get(args.customerId);
    if (customer === null) return null;
    const rows = await ctx.db
      .query("customerPrices")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const prices = await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        productId: row.productId,
        currency: row.currency,
        price: row.price,
        ...(await describeProduct(ctx, row.productId, row.variantId ?? null)),
        breaks: await breaksForCustomerPrice(ctx, row._id),
      })),
    );
    prices.sort(
      (a, b) =>
        a.sku.localeCompare(b.sku) ||
        a.currency.localeCompare(b.currency) ||
        a._id.localeCompare(b._id),
    );
    return {
      customer: {
        _id: customer._id,
        code: customer.code,
        name: customer.name,
        status: customer.status,
      },
      prices,
    };
  },
});

export const setCustomerPrice = auditedMutation({
  entity: "customerPrices",
  action: "set",
  args: {
    customerId: v.id("customers"),
    productId: v.id("products"),
    variantId: v.union(v.id("variants"), v.null()),
    currency: v.string(),
    price: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const customer = await ctx.db.get(args.customerId);
    if (customer === null) throw new ConvexError("Customer not found.");
    if (customer.status === "closed") throw new ConvexError("That customer is closed.");
    await requireSellable(ctx, args.productId, args.variantId);
    const currency = await requireCurrency(ctx, args.currency);
    assertPrice(args.price);
    const rows = await ctx.db
      .query("customerPrices")
      .withIndex("by_customer_product", (q) =>
        q.eq("customerId", args.customerId).eq("productId", args.productId),
      )
      .collect();
    const existing =
      rows.find((row) => sameVariant(row, args.variantId) && row.currency === currency) ?? null;
    const now = Date.now();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { price: args.price, updatedAt: now });
      return {
        result: existing._id,
        audit: {
          entityId: existing._id,
          before: { price: existing.price },
          after: { price: args.price },
        },
      };
    }
    const priceId = await ctx.db.insert("customerPrices", {
      customerId: args.customerId,
      productId: args.productId,
      currency,
      price: args.price,
      createdAt: now,
      updatedAt: now,
      ...variantFields(args.variantId),
    });
    return {
      result: priceId,
      audit: {
        entityId: priceId,
        after: {
          customerId: args.customerId,
          productId: args.productId,
          currency,
          price: args.price,
        },
      },
    };
  },
});

export const removeCustomerPrice = auditedMutation({
  entity: "customerPrices",
  action: "delete",
  args: { priceId: v.id("customerPrices") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await ctx.db.get(args.priceId);
    if (row === null) throw new ConvexError("This price no longer exists.");
    const breaks = await ctx.db
      .query("quantityBreaks")
      .withIndex("by_customer_price", (q) => q.eq("customerPriceId", row._id))
      .collect();
    for (const item of breaks) await ctx.db.delete(item._id);
    await ctx.db.delete(row._id);
    return {
      result: undefined,
      audit: {
        entityId: row._id,
        before: { customerId: row.customerId, productId: row.productId, price: row.price },
      },
    };
  },
});

export const setBreak = auditedMutation({
  entity: "quantityBreaks",
  action: "set",
  args: { target: breakTarget, minQty: v.number(), price: v.number() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    assertBreakQty(args.minQty);
    assertPrice(args.price);
    const now = Date.now();
    switch (args.target.scope) {
      case "list": {
        const parent = await ctx.db.get(args.target.priceId);
        if (parent === null) throw new ConvexError("This price no longer exists.");
        const list = await ctx.db.get(parent.priceListId);
        if (list === null) throw new ConvexError("Price list not found.");
        if (!list.active) throw new ConvexError("That price list is inactive.");
        const rows = await ctx.db
          .query("quantityBreaks")
          .withIndex("by_list_price", (q) => q.eq("priceListPriceId", parent._id))
          .collect();
        const existing = rows.find((row) => row.minQty === args.minQty) ?? null;
        if (existing !== null) {
          await ctx.db.patch(existing._id, { price: args.price, updatedAt: now });
          return {
            result: existing._id,
            audit: {
              entityId: existing._id,
              before: { price: existing.price, minQty: existing.minQty },
              after: { price: args.price, minQty: args.minQty },
            },
          };
        }
        const breakId = await ctx.db.insert("quantityBreaks", {
          scope: "list",
          priceListPriceId: parent._id,
          productId: parent.productId,
          minQty: args.minQty,
          price: args.price,
          createdAt: now,
          updatedAt: now,
          ...variantFields(parent.variantId ?? null),
        });
        return {
          result: breakId,
          audit: {
            entityId: breakId,
            after: { minQty: args.minQty, price: args.price, scope: "list" },
          },
        };
      }
      case "group": {
        const parent = await ctx.db.get(args.target.priceId);
        if (parent === null) throw new ConvexError("This price no longer exists.");
        const group = await ctx.db.get(parent.customerGroupId);
        if (group === null) throw new ConvexError("Customer group not found.");
        if (!group.active) throw new ConvexError("That customer group is inactive.");
        const rows = await ctx.db
          .query("quantityBreaks")
          .withIndex("by_group_price", (q) => q.eq("customerGroupPriceId", parent._id))
          .collect();
        const existing = rows.find((row) => row.minQty === args.minQty) ?? null;
        if (existing !== null) {
          await ctx.db.patch(existing._id, { price: args.price, updatedAt: now });
          return {
            result: existing._id,
            audit: {
              entityId: existing._id,
              before: { price: existing.price, minQty: existing.minQty },
              after: { price: args.price, minQty: args.minQty },
            },
          };
        }
        const breakId = await ctx.db.insert("quantityBreaks", {
          scope: "group",
          customerGroupPriceId: parent._id,
          productId: parent.productId,
          minQty: args.minQty,
          price: args.price,
          createdAt: now,
          updatedAt: now,
          ...variantFields(parent.variantId ?? null),
        });
        return {
          result: breakId,
          audit: {
            entityId: breakId,
            after: { minQty: args.minQty, price: args.price, scope: "group" },
          },
        };
      }
      case "customer": {
        const parent = await ctx.db.get(args.target.priceId);
        if (parent === null) throw new ConvexError("This price no longer exists.");
        const customer = await ctx.db.get(parent.customerId);
        if (customer === null) throw new ConvexError("Customer not found.");
        if (customer.status === "closed") throw new ConvexError("That customer is closed.");
        const rows = await ctx.db
          .query("quantityBreaks")
          .withIndex("by_customer_price", (q) => q.eq("customerPriceId", parent._id))
          .collect();
        const existing = rows.find((row) => row.minQty === args.minQty) ?? null;
        if (existing !== null) {
          await ctx.db.patch(existing._id, { price: args.price, updatedAt: now });
          return {
            result: existing._id,
            audit: {
              entityId: existing._id,
              before: { price: existing.price, minQty: existing.minQty },
              after: { price: args.price, minQty: args.minQty },
            },
          };
        }
        const breakId = await ctx.db.insert("quantityBreaks", {
          scope: "customer",
          customerPriceId: parent._id,
          productId: parent.productId,
          minQty: args.minQty,
          price: args.price,
          createdAt: now,
          updatedAt: now,
          ...variantFields(parent.variantId ?? null),
        });
        return {
          result: breakId,
          audit: {
            entityId: breakId,
            after: { minQty: args.minQty, price: args.price, scope: "customer" },
          },
        };
      }
      default: {
        const unreachable: never = args.target;
        return unreachable;
      }
    }
  },
});

export const removeBreak = auditedMutation({
  entity: "quantityBreaks",
  action: "delete",
  args: { breakId: v.id("quantityBreaks") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await ctx.db.get(args.breakId);
    if (row === null) throw new ConvexError("This quantity break no longer exists.");
    await ctx.db.delete(row._id);
    return {
      result: undefined,
      audit: {
        entityId: row._id,
        before: { scope: row.scope, minQty: row.minQty, price: row.price },
      },
    };
  },
});

export const listPromotions = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const rows = await ctx.db.query("promotions").collect();
    const listed = await Promise.all(
      rows.map(async (row) => {
        const list = row.priceListId === undefined ? null : await ctx.db.get(row.priceListId);
        return {
          _id: row._id,
          name: row.name,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          active: row.active,
          priceListId: row.priceListId ?? null,
          priceListName: list?.name ?? null,
        };
      }),
    );
    return listed.sort(
      (a, b) =>
        a.startsOn - b.startsOn || a.name.localeCompare(b.name) || a._id.localeCompare(b._id),
    );
  },
});

export const createPromotion = auditedMutation({
  entity: "promotions",
  action: "create",
  args: {
    name: v.string(),
    startsOn: v.number(),
    endsOn: v.number(),
    active: v.boolean(),
    priceListId: v.union(v.id("priceLists"), v.null()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const { name, nameKey } = parsedPromotionName(args.name);
    assertRange(args.startsOn, args.endsOn);
    if (args.priceListId !== null) {
      const list = await ctx.db.get(args.priceListId);
      if (list === null) throw new ConvexError("Price list not found.");
      if (!list.active) throw new ConvexError("That price list is inactive.");
    }
    const now = Date.now();
    const promotionId = await ctx.db.insert("promotions", {
      name,
      nameKey,
      startsOn: args.startsOn,
      endsOn: args.endsOn,
      active: args.active,
      createdAt: now,
      updatedAt: now,
      ...(args.priceListId === null ? {} : { priceListId: args.priceListId }),
    });
    return {
      result: promotionId,
      audit: {
        entityId: promotionId,
        after: { name, startsOn: args.startsOn, endsOn: args.endsOn, active: args.active },
      },
    };
  },
});

export const updatePromotion = auditedMutation({
  entity: "promotions",
  action: "update",
  args: {
    promotionId: v.id("promotions"),
    name: v.string(),
    startsOn: v.number(),
    endsOn: v.number(),
    active: v.boolean(),
    priceListId: v.union(v.id("priceLists"), v.null()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const row = await ctx.db.get(args.promotionId);
    if (row === null) throw new ConvexError("Promotion not found.");
    const { name, nameKey } = parsedPromotionName(args.name);
    assertRange(args.startsOn, args.endsOn);
    const now = Date.now();
    if (args.priceListId !== null && args.priceListId !== row.priceListId) {
      const list = await ctx.db.get(args.priceListId);
      if (list === null) throw new ConvexError("Price list not found.");
      if (!list.active) throw new ConvexError("That price list is inactive.");
    }
    await ctx.db.patch(row._id, {
      name,
      nameKey,
      startsOn: args.startsOn,
      endsOn: args.endsOn,
      active: args.active,
      updatedAt: now,
    });
    if (args.priceListId === null) {
      const current = await ctx.db.get(row._id);
      if (current === null) throw new ConvexError("Promotion not found.");
      await ctx.db.replace(row._id, {
        name: current.name,
        nameKey: current.nameKey,
        startsOn: current.startsOn,
        endsOn: current.endsOn,
        active: current.active,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      });
    } else {
      await ctx.db.patch(row._id, { priceListId: args.priceListId });
    }
    return {
      result: row._id,
      audit: {
        entityId: row._id,
        before: { name: row.name, startsOn: row.startsOn, endsOn: row.endsOn, active: row.active },
        after: { name, startsOn: args.startsOn, endsOn: args.endsOn, active: args.active },
      },
    };
  },
});

/** Product delete drops every stored price and break for that product. */
export async function removePricesForProduct(ctx: MutationCtx, productId: Id<"products">) {
  const listPrices = await ctx.db
    .query("priceListPrices")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of listPrices) await ctx.db.delete(row._id);
  const groupPrices = await ctx.db
    .query("customerGroupPrices")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of groupPrices) await ctx.db.delete(row._id);
  const customerPrices = await ctx.db
    .query("customerPrices")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of customerPrices) await ctx.db.delete(row._id);
  const breaks = await ctx.db
    .query("quantityBreaks")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of breaks) await ctx.db.delete(row._id);
}

/** Variant delete drops the prices and breaks that name that variant. */
export async function removePricesForVariant(
  ctx: MutationCtx,
  productId: Id<"products">,
  variantId: Id<"variants">,
) {
  const listPrices = await ctx.db
    .query("priceListPrices")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of listPrices) {
    if (row.variantId === variantId) await ctx.db.delete(row._id);
  }
  const groupPrices = await ctx.db
    .query("customerGroupPrices")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of groupPrices) {
    if (row.variantId === variantId) await ctx.db.delete(row._id);
  }
  const customerPrices = await ctx.db
    .query("customerPrices")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of customerPrices) {
    if (row.variantId === variantId) await ctx.db.delete(row._id);
  }
  const breaks = await ctx.db
    .query("quantityBreaks")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();
  for (const row of breaks) {
    if (row.variantId === variantId) await ctx.db.delete(row._id);
  }
}

/**
 * Currencies a sales user can price in. Settings access is not required.
 * Inactive codes stay in the list so a stored price can still name them.
 */
export const currencyChoices = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const rows = await ctx.db.query("currencies").collect();
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .unique();
    return {
      baseCurrency: org?.baseCurrency ?? null,
      currencies: rows
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((row) => ({
          code: row.code,
          name: row.name,
          decimalPlaces: row.decimalPlaces,
          active: row.active,
        })),
    };
  },
});

/**
 * What a sales line would charge (PH2-09). Same winner as `resolvePrice`,
 * then the line total and the margin against the product's display cost.
 * A missing cost, or a unit that is not above zero, leaves the margin null.
 * `sales.view`.
 */
export const linePreview = query({
  args: {
    customerId: v.id("customers"),
    productId: v.id("products"),
    variantId: v.union(v.id("variants"), v.null()),
    qty: v.number(),
    date: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const resolved = await resolveStoredPrice(ctx, args);
    const product = await ctx.db.get(args.productId);
    const costPrice = product?.costPrice ?? null;
    const amount =
      resolved.unitPrice === null
        ? null
        : lineAmount(resolved.unitPrice, args.qty, resolved.decimalPlaces);
    const margin =
      resolved.unitPrice === null || costPrice === null
        ? null
        : marginPercent(resolved.unitPrice, costPrice);
    return {
      ...resolved,
      qty: args.qty,
      lineAmount: amount,
      costPrice,
      marginPercent: margin,
    };
  },
});

/**
 * The price a sale uses (PH2-07). `sales.view`. A miss is a null unit
 * price. A missing customer, product, variant, or currency is an error.
 * A closed customer and an inactive group still resolve: this answers
 * the price, not whether the sale is allowed.
 */
export const resolvePrice = query({
  args: {
    customerId: v.id("customers"),
    productId: v.id("products"),
    variantId: v.union(v.id("variants"), v.null()),
    qty: v.number(),
    date: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    return await resolveStoredPrice(ctx, args);
  },
});

export async function resolveStoredPrice(
  ctx: ReadCtx,
  args: {
    customerId: Id<"customers">;
    productId: Id<"products">;
    variantId: Id<"variants"> | null;
    qty: number;
    date: number;
    currency: string;
  },
): Promise<ResolvedPrice & { currency: string; decimalPlaces: number }> {
  const qtyMessage = resolveQtyError(args.qty);
  if (qtyMessage !== null) throw new ConvexError(qtyMessage);
  if (priceDay(args.date) === null) throw new ConvexError("Enter a real date.");

  const currencyCode = args.currency.trim().toUpperCase();
  const currency = await ctx.db
    .query("currencies")
    .withIndex("by_code", (q) => q.eq("code", currencyCode))
    .unique();
  if (currency === null) throw new ConvexError("Currency not found.");
  if (
    !Number.isInteger(currency.decimalPlaces) ||
    currency.decimalPlaces < 0 ||
    currency.decimalPlaces > 6
  ) {
    throw new ConvexError("That currency has no decimal places.");
  }

  const customer = await ctx.db.get(args.customerId);
  if (customer === null) throw new ConvexError("Customer not found.");
  const product = await ctx.db.get(args.productId);
  if (product === null) throw new ConvexError("Product not found.");
  let variantPrice: number | null = null;
  if (args.variantId !== null) {
    const variant = await ctx.db.get(args.variantId);
    if (variant === null) throw new ConvexError("Variant not found.");
    if (variant.productId !== args.productId) {
      throw new ConvexError("That variant is not on this product.");
    }
    variantPrice = variant.listPrice ?? null;
  }

  const breakRows = await ctx.db
    .query("quantityBreaks")
    .withIndex("by_product", (q) => q.eq("productId", args.productId))
    .collect();
  const customerRows = await ctx.db
    .query("customerPrices")
    .withIndex("by_customer_product", (q) =>
      q.eq("customerId", args.customerId).eq("productId", args.productId),
    )
    .collect();
  const groupId = customer.groupId;
  const groupRows =
    groupId === undefined
      ? []
      : await ctx.db
          .query("customerGroupPrices")
          .withIndex("by_group_product", (q) =>
            q.eq("customerGroupId", groupId).eq("productId", args.productId),
          )
          .collect();
  const listRows = await ctx.db
    .query("priceListPrices")
    .withIndex("by_product", (q) => q.eq("productId", args.productId))
    .collect();
  const lists = await ctx.db.query("priceLists").collect();
  const promotions = await ctx.db.query("promotions").collect();
  const org = await ctx.db
    .query("organizations")
    .withIndex("by_active", (q) => q.eq("active", true))
    .unique();

  const resolved = resolvePriceFromRows({
    qty: args.qty,
    date: args.date,
    currency: currencyCode,
    decimalPlaces: currency.decimalPlaces,
    variantId: args.variantId,
    customerPrices: customerRows
      .filter((row) => row.currency === currencyCode)
      .map((row) => candidate(row, breakRows, "customerPriceId")),
    groupPrices: groupRows
      .filter((row) => row.currency === currencyCode)
      .map((row) => candidate(row, breakRows, "customerGroupPriceId")),
    lists: lists.map((list) => ({
      id: list._id,
      currency: list.currency,
      active: list.active,
      isBase: list.isBase,
      createdAt: list.createdAt,
      prices: listRows
        .filter((row) => row.priceListId === list._id)
        .map((row) => candidate(row, breakRows, "priceListPriceId")),
    })),
    promotions: promotions.map((row) => ({
      id: row._id,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      active: row.active,
      priceListId: row.priceListId ?? null,
      createdAt: row.createdAt,
    })),
    catalog: {
      variantPrice,
      productPrice: product.listPrice ?? null,
      baseCurrency: org?.baseCurrency ?? null,
    },
  });
  return { ...resolved, currency: currencyCode, decimalPlaces: currency.decimalPlaces };
}

function candidate(
  row: { _id: string; variantId?: Id<"variants">; price: number },
  breaks: Doc<"quantityBreaks">[],
  field: "customerPriceId" | "customerGroupPriceId" | "priceListPriceId",
): PriceCandidate {
  return {
    id: row._id,
    variantId: row.variantId ?? null,
    price: row.price,
    breaks: breaks
      .filter((item) => item[field] === row._id)
      .map((item) => ({ id: item._id, minQty: item.minQty, price: item.price })),
  };
}
