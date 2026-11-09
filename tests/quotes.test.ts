import { inflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { quotePdf } from "../lib/quotePdf";
import { priceDay, priceDayLabel } from "../lib/pricing";
import { quoteLapsed, quoteStatusError, taxOnLine, validityError } from "../lib/quotes";
import { setup } from "./setup";

/**
 * PH2-11 — a quote prices a line, adds tax, takes a discount, and
 * converts once into a draft order that keeps those prices.
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

describe("quote rules", () => {
  test("tax, validity, and the status list", () => {
    expect(
      taxOnLine({ unitPrice: 100, qty: 2, decimalPlaces: 2, rateBps: 2000, inclusive: false }),
    ).toEqual({
      lineAmount: 200,
      net: 200,
      tax: 40,
      gross: 240,
    });
    expect(
      taxOnLine({ unitPrice: 100, qty: 1, decimalPlaces: 2, rateBps: 2000, inclusive: true }),
    ).toEqual({
      lineAmount: 100,
      net: 83.33,
      tax: 16.67,
      gross: 100,
    });
    expect(
      taxOnLine({ unitPrice: 50, qty: 1, decimalPlaces: 2, rateBps: 0, inclusive: false }),
    ).toMatchObject({
      tax: 0,
      gross: 50,
    });
    const day = Date.parse("2020-06-15T00:00:00.000Z");
    expect(validityError(day, day)).toBeNull();
    expect(validityError(day, day - 86_400_000)).toMatch(/before its date/);
    expect(quoteLapsed(day, day + 86_400_000)).toBe(true);
    expect(quoteLapsed(day, day)).toBe(false);
    expect(quoteStatusError("draft", "accepted")).toMatch(/can't be marked/);
    expect(quoteStatusError("draft", "sent")).toBeNull();
    expect(quoteStatusError("sent", "accepted")).toBeNull();
    expect(quoteStatusError("accepted", "rejected")).toMatch(/can't be marked/);
  });

  test("the PDF names the quote", async () => {
    const bytes = await quotePdf({
      companyName: "Chris",
      docNumber: "QT-0001",
      status: "draft",
      customerName: "Acme",
      customerCode: "ACME",
      currency: "GBP",
      decimalPlaces: 2,
      quoteDate: "2020-06-15",
      validUntil: "2020-07-15",
      notes: "Morning delivery",
      billTo: "12 High Street, Leeds",
      shipTo: null,
      lines: [
        {
          description: "Bench",
          sku: "BENCH",
          qty: 2,
          unitPrice: 80,
          net: 160,
          tax: 32,
          gross: 192,
        },
      ],
      net: 160,
      tax: 32,
      gross: 192,
    });
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
      const body = match[1] ?? "";
      try {
        return inflateSync(Buffer.from(body, "latin1")).toString("latin1");
      } catch {
        return body;
      }
    });
    const text = streams
      .join("\n")
      .replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
    expect(text).toContain("QT-0001");
    expect(text).toContain("192.00 GBP");
    expect(text).toContain("Morning delivery");
  });
});

describe("quotes", () => {
  test("a line, a discount, tax, and one order that keeps the price", async () => {
    const t = setup();
    const sales = await asUser(t, "ada@example.com", "sales");
    const other = await asUser(t, "ben@example.com", "sales");
    const warehouse = await asUser(t, "wh@example.com", "warehouse");
    const today = priceDay(Date.now());
    if (today === null) throw new Error("today");
    const validUntil = priceDayLabel(today + 30 * 86_400_000);

    const world = await t.run(async (ctx) => {
      await ctx.db.insert("sequences", {
        name: "quote",
        prefix: "QT-",
        next: 1,
        padding: 4,
        updatedAt: 1,
      });
      await ctx.db.insert("sequences", {
        name: "salesOrder",
        prefix: "SO-",
        next: 1,
        padding: 4,
        updatedAt: 1,
      });
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
      const rateId = await ctx.db.insert("taxRates", {
        name: "VAT 20%",
        rateBps: 2000,
        inclusive: false,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const taxGroupId = await ctx.db.insert("taxGroups", {
        name: "UK VAT",
        isDefault: true,
        rates: { standard: rateId },
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const customerId = await ctx.db.insert("customers", {
        code: "ACME",
        name: "Acme",
        status: "active" as const,
        paymentTermsDays: 14,
        currency: "GBP",
        taxGroupId,
        createdAt: 1,
        updatedAt: 1,
      });
      const closedId = await ctx.db.insert("customers", {
        code: "CLOSED",
        name: "Closed",
        status: "closed" as const,
        paymentTermsDays: 0,
        currency: "GBP",
        createdAt: 1,
        updatedAt: 1,
      });
      const productId = await ctx.db.insert("products", {
        name: "Bench",
        slug: "bench",
        sku: "BENCH",
        status: "active" as const,
        categoryIds: [],
        listPrice: 100,
        taxCategory: "standard" as const,
        createdAt: 1,
        updatedAt: 1,
      });
      const bareId = await ctx.db.insert("products", {
        name: "Bare",
        slug: "bare",
        sku: "BARE",
        status: "active" as const,
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      });
      return { customerId, closedId, productId, bareId };
    });

    await expect(
      warehouse.mutation(api.sales.quotes.create, {
        customerId: world.customerId,
        validUntil,
        notes: null,
      }),
    ).rejects.toThrow(/permission to create sales/);
    await expect(
      sales.mutation(api.sales.quotes.create, {
        customerId: world.closedId,
        validUntil,
        notes: null,
      }),
    ).rejects.toThrow(/closed/);
    await expect(
      sales.mutation(api.sales.quotes.create, {
        customerId: world.customerId,
        validUntil: priceDayLabel(today - 86_400_000),
        notes: null,
      }),
    ).rejects.toThrow(/before its date/);

    const quoteId = await sales.mutation(api.sales.quotes.create, {
      customerId: world.customerId,
      validUntil,
      notes: "  Morning delivery  ",
    });
    expect(await sales.query(api.sales.quotes.get, { quoteId })).toMatchObject({
      companyName: "Chris",
      quote: {
        docNumber: "QT-0001",
        status: "draft",
        notes: "Morning delivery",
        paymentTermsDays: 14,
      },
      totals: { gross: 0 },
    });
    await expect(sales.mutation(api.sales.quotes.send, { quoteId })).rejects.toThrow(/Add a line/);
    await expect(
      sales.mutation(api.sales.quotes.addLine, {
        quoteId,
        productId: world.bareId,
        variantId: null,
        qty: 1,
      }),
    ).rejects.toThrow(/no price/);

    const lineId = await sales.mutation(api.sales.quotes.addLine, {
      quoteId,
      productId: world.productId,
      variantId: null,
      qty: 2,
    });
    expect(await sales.query(api.sales.quotes.get, { quoteId })).toMatchObject({
      lines: [{ unitPrice: 100, net: 200, tax: 40, gross: 240, discountPercent: 0 }],
      totals: { net: 200, tax: 40, gross: 240 },
    });

    await sales.mutation(api.sales.quotes.setDiscount, {
      lineId,
      discountPercent: 10,
      reason: "Repeat order",
    });
    expect(await sales.query(api.sales.quotes.get, { quoteId })).toMatchObject({
      lines: [{ unitPrice: 90, discountPercent: 10, overrideStatus: "applied", gross: 216 }],
    });

    await sales.mutation(api.sales.quotes.setDiscount, {
      lineId,
      discountPercent: 20,
      reason: "Matching a competitor",
    });
    expect(await sales.query(api.sales.quotes.get, { quoteId })).toMatchObject({
      lines: [{ unitPrice: 100, discountPercent: 20, overrideStatus: "pending", gross: 240 }],
    });
    await expect(sales.mutation(api.sales.quotes.send, { quoteId })).rejects.toThrow(/waiting/);

    const pending = await sales.query(api.sales.priceOverrides.listPending, {});
    expect(pending).toHaveLength(1);
    const overrideId = pending[0]?._id;
    if (overrideId === undefined) throw new Error("pending");
    await expect(
      sales.mutation(api.sales.priceOverrides.confirm, {
        overrideId,
        decision: "approve",
        note: null,
      }),
    ).rejects.toThrow(/Someone else/);
    await other.mutation(api.sales.priceOverrides.confirm, {
      overrideId,
      decision: "approve",
      note: null,
    });
    expect(await sales.query(api.sales.quotes.get, { quoteId })).toMatchObject({
      lines: [
        {
          unitPrice: 80,
          discountPercent: 20,
          overrideStatus: "approved",
          net: 160,
          tax: 32,
          gross: 192,
        },
      ],
      totals: { gross: 192 },
    });

    await sales.mutation(api.sales.quotes.send, { quoteId });
    await expect(
      sales.mutation(api.sales.quotes.addLine, {
        quoteId,
        productId: world.productId,
        variantId: null,
        qty: 1,
      }),
    ).rejects.toThrow(/draft/);
    await expect(sales.mutation(api.sales.quotes.convert, { quoteId })).rejects.toThrow(/Accept/);
    await sales.mutation(api.sales.quotes.accept, { quoteId });
    const orderId = await sales.mutation(api.sales.quotes.convert, { quoteId });
    await expect(sales.mutation(api.sales.quotes.convert, { quoteId })).rejects.toThrow(
      /already has an order/,
    );
    expect(await sales.query(api.sales.orders.get, { salesOrderId: orderId })).toMatchObject({
      order: { docNumber: "SO-0001", status: "draft", quoteNumber: "QT-0001", channel: "manual" },
      lines: [{ unitPrice: 80, qty: 2, net: 160, tax: 32, gross: 192 }],
      totals: { gross: 192 },
    });

    const statement = await sales.query(api.sales.customers.statement, {
      customerId: world.customerId,
    });
    expect(statement?.balance).toBe(0);
    expect(statement?.documents).toEqual([
      expect.objectContaining({ kind: "salesOrder", number: "SO-0001", amount: 192 }),
      expect.objectContaining({ kind: "quote", number: "QT-0001", amount: 192 }),
    ]);

    const lapsedId = await sales.mutation(api.sales.quotes.create, {
      customerId: world.customerId,
      validUntil,
      notes: null,
    });
    await sales.mutation(api.sales.quotes.addLine, {
      quoteId: lapsedId,
      productId: world.productId,
      variantId: null,
      qty: 1,
    });
    await expect(sales.mutation(api.sales.quotes.expire, { quoteId: lapsedId })).rejects.toThrow(
      /still valid/,
    );
    await t.run((ctx) => ctx.db.patch(lapsedId, { validUntil: today - 86_400_000 }));
    await expect(sales.mutation(api.sales.quotes.send, { quoteId: lapsedId })).rejects.toThrow(
      /expired/,
    );
    await sales.mutation(api.sales.quotes.expire, { quoteId: lapsedId });
    expect(await sales.query(api.sales.quotes.get, { quoteId: lapsedId })).toMatchObject({
      quote: { status: "expired" },
    });
    await expect(sales.mutation(api.sales.quotes.expire, { quoteId: lapsedId })).rejects.toThrow(
      /can't be marked/,
    );
  });
});
