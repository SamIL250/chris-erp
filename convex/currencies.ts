import { ConvexError, v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import { requirePermission } from "./_lib/permissions";
import { query, type QueryCtx } from "./_generated/server";

/**
 * Currency settings (PH0-31): the currency catalog, the active base
 * currency (`organizations.baseCurrency` — single source of truth), and
 * manually maintained exchange-rate history (append-only — one row per
 * observation, latest wins by `effectiveAt`; API feeds add rows later, they
 * never rewrite).
 *
 * Reads need settings.view; adding currencies needs settings.create; base
 * currency and rates need settings.edit. Everything is audited.
 */

const CODE_PATTERN = /^[A-Z]{3}$/;

async function findOrganization(ctx: QueryCtx) {
  return await ctx.db
    .query("organizations")
    .withIndex("by_active", (q) => q.eq("active", true))
    .unique();
}

async function loadCurrency(ctx: QueryCtx, code: string) {
  return await ctx.db
    .query("currencies")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

/** Currency catalog + the active base currency (null until set). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "view");
    const rows = await ctx.db.query("currencies").collect();
    const org = await findOrganization(ctx);
    return {
      currencies: rows.sort((a, b) => a.code.localeCompare(b.code)),
      base: org?.baseCurrency ?? null,
    };
  },
});

/** Add a currency to the catalog (ISO 4217 code). */
export const create = auditedMutation({
  entity: "currencies",
  action: "create",
  args: {
    code: v.string(),
    name: v.string(),
    symbol: v.optional(v.string()),
    decimalPlaces: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "create");
    const code = args.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new ConvexError("Currency code must be 3 letters (ISO 4217, e.g. USD).");
    }
    const name = args.name.trim();
    if (name.length < 1 || name.length > 100) {
      throw new ConvexError("Currency name must be between 1 and 100 characters.");
    }
    if (!Number.isInteger(args.decimalPlaces) || args.decimalPlaces < 0 || args.decimalPlaces > 6) {
      throw new ConvexError("Decimal places must be a whole number between 0 and 6.");
    }
    if ((await loadCurrency(ctx, code)) !== null) {
      throw new ConvexError(`A currency with code ${code} already exists.`);
    }

    const symbol = args.symbol?.trim() || undefined;
    const currencyId = await ctx.db.insert("currencies", {
      code,
      name,
      symbol,
      decimalPlaces: args.decimalPlaces,
      active: args.active,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      result: undefined,
      audit: {
        entityId: currencyId,
        // Key named `currency`, not `code` — the audit redactor masks bare
        // `code` keys (PH0-26) and a currency code isn't a secret.
        after: { currency: code, name, decimalPlaces: args.decimalPlaces, active: args.active },
      },
    };
  },
});

/** Switch the company's base currency (org row must exist first). */
export const updateBase = auditedMutation({
  entity: "organizations",
  action: "updateBase",
  args: { code: v.string() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "edit");
    const org = await findOrganization(ctx);
    if (org === null) {
      throw new ConvexError("Save your company details first (Settings → Company).");
    }
    const code = args.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new ConvexError("Currency code must be 3 letters (ISO 4217, e.g. USD).");
    }
    if ((await loadCurrency(ctx, code)) === null) {
      throw new ConvexError(`No currency with code ${code} — add it first.`);
    }
    if (org.baseCurrency === code) {
      return { result: undefined, audit: undefined };
    }
    await ctx.db.patch(org._id, { baseCurrency: code, updatedAt: Date.now() });
    return {
      result: undefined,
      audit: {
        entityId: org._id,
        before: { baseCurrency: org.baseCurrency },
        after: { baseCurrency: code },
      },
    };
  },
});

/** Rate history, newest observation first. */
export const rates = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "view");
    const rows = await ctx.db.query("exchangeRates").collect();
    return rows.sort(
      (a, b) =>
        b.effectiveAt - a.effectiveAt ||
        b.createdAt - a.createdAt ||
        b._creationTime - a._creationTime,
    );
  },
});

/** Record a manual observation — append-only (PH0-24's contract). */
export const addRate = auditedMutation({
  entity: "exchangeRates",
  action: "create",
  args: { baseCurrency: v.string(), quoteCurrency: v.string(), rate: v.number() },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "settings", "edit");
    const baseCurrency = args.baseCurrency.trim().toUpperCase();
    const quoteCurrency = args.quoteCurrency.trim().toUpperCase();
    if (!CODE_PATTERN.test(baseCurrency) || !CODE_PATTERN.test(quoteCurrency)) {
      throw new ConvexError("Currency codes must be 3 letters (ISO 4217, e.g. USD).");
    }
    if (baseCurrency === quoteCurrency) {
      throw new ConvexError("Base and quote currencies must differ.");
    }
    if (!Number.isFinite(args.rate) || args.rate <= 0 || args.rate > 1e12) {
      throw new ConvexError("Rate must be a positive number.");
    }
    for (const code of [baseCurrency, quoteCurrency]) {
      if ((await loadCurrency(ctx, code)) === null) {
        throw new ConvexError(`No currency with code ${code} — add it first.`);
      }
    }

    const now = Date.now();
    const rateId = await ctx.db.insert("exchangeRates", {
      baseCurrency,
      quoteCurrency,
      rate: args.rate,
      source: "manual",
      effectiveAt: now,
      createdBy: actorId,
      createdAt: now,
    });
    return {
      result: undefined,
      audit: {
        entityId: rateId,
        after: { pair: `${baseCurrency}/${quoteCurrency}`, rate: args.rate, source: "manual" },
      },
    };
  },
});
