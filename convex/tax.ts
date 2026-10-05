import { ConvexError, v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import { requirePermission } from "./_lib/permissions";
import { query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Tax engine configuration (PH0-32):
 *
 * - `taxRates` — name/short label, integer basis points (19.5% → 1950, exact
 *   money math), inclusive (quoted prices already contain it), active.
 * - `taxGroups` — name + one rate slot per product tax category
 *   (standard/reduced/zero). Customers get a group in Phase 2; `exempt` is
 *   category-level on the product itself (no rate involved — PH0-24).
 *
 * Rates are never hard-deleted (groups and posted documents reference them)
 * — deactivate instead. Reads need settings.view; creates need
 * settings.create; edits need settings.edit. Everything is audited.
 */

/** The fixed product tax categories a group maps to a rate. */
const TAX_CATEGORIES = ["standard", "reduced", "zero"] as const;

type GroupRates = {
  standard?: Id<"taxRates">;
  reduced?: Id<"taxRates">;
  zero?: Id<"taxRates">;
};

const ratesValidator = v.object({
  standard: v.optional(v.id("taxRates")),
  reduced: v.optional(v.id("taxRates")),
  zero: v.optional(v.id("taxRates")),
});

async function validateRateInput(name: string, rateBps: number) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new ConvexError("Rate name must be between 1 and 100 characters.");
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
    throw new ConvexError("Rate must be 0-100% (0-10000 basis points).");
  }
  return trimmed;
}

async function validateRateIds(ctx: MutationCtx, rates: GroupRates) {
  for (const category of TAX_CATEGORIES) {
    const id = rates[category];
    if (id !== undefined && (await ctx.db.get(id)) === null) {
      throw new ConvexError(`The selected ${category} rate no longer exists.`);
    }
  }
}

/** Demote every other default group; returns the ids it flipped off. */
async function demoteOtherDefaults(ctx: MutationCtx, keepId?: Id<"taxGroups">) {
  const others = await ctx.db
    .query("taxGroups")
    .withIndex("by_active", (q) => q.eq("active", true))
    .collect();
  const demoted: Id<"taxGroups">[] = [];
  for (const group of others) {
    if (group.isDefault && group._id !== keepId) {
      await ctx.db.patch(group._id, { isDefault: false, updatedAt: Date.now() });
      demoted.push(group._id);
    }
  }
  return demoted;
}

/** Tax rates, name-sorted. */
export const rates = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "view");
    const rows = await ctx.db.query("taxRates").collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Tax groups, name-sorted (rate ids resolved client-side against `rates`). */
export const groups = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "view");
    const rows = await ctx.db.query("taxGroups").collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createRate = auditedMutation({
  entity: "taxRates",
  action: "create",
  args: {
    name: v.string(),
    code: v.optional(v.string()),
    rateBps: v.number(),
    inclusive: v.boolean(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "create");
    const name = await validateRateInput(args.name, args.rateBps);
    const code = args.code?.trim() || undefined;
    const rateId = await ctx.db.insert("taxRates", {
      name,
      code,
      rateBps: args.rateBps,
      inclusive: args.inclusive,
      active: args.active,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      result: undefined,
      // Key `label`, not `code` — the audit redactor masks bare `code` keys
      // (PH0-26) and a tax code is not a secret.
      audit: {
        entityId: rateId,
        after: { name, label: code, rateBps: args.rateBps, inclusive: args.inclusive },
      },
    };
  },
});

export const updateRate = auditedMutation({
  entity: "taxRates",
  action: "update",
  args: {
    id: v.id("taxRates"),
    name: v.string(),
    code: v.optional(v.string()),
    rateBps: v.number(),
    inclusive: v.boolean(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This tax rate no longer exists.");
    }
    const name = await validateRateInput(args.name, args.rateBps);
    const code = args.code?.trim() || undefined;

    const before = {
      name: row.name,
      label: row.code,
      rateBps: row.rateBps,
      inclusive: row.inclusive,
      active: row.active,
    };
    const after = {
      name,
      label: code,
      rateBps: args.rateBps,
      inclusive: args.inclusive,
      active: args.active,
    };
    const changed =
      before.name !== after.name ||
      before.label !== after.label ||
      before.rateBps !== after.rateBps ||
      before.inclusive !== after.inclusive ||
      before.active !== after.active;
    if (changed) {
      await ctx.db.patch(args.id, {
        name,
        code,
        rateBps: args.rateBps,
        inclusive: args.inclusive,
        active: args.active,
        updatedAt: Date.now(),
      });
    }
    return {
      result: undefined,
      audit: changed ? { entityId: args.id, before, after } : undefined,
    };
  },
});

export const createGroup = auditedMutation({
  entity: "taxGroups",
  action: "create",
  args: {
    name: v.string(),
    isDefault: v.boolean(),
    rates: ratesValidator,
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "create");
    const name = args.name.trim();
    if (name.length < 1 || name.length > 100) {
      throw new ConvexError("Group name must be between 1 and 100 characters.");
    }
    await validateRateIds(ctx, args.rates);

    const groupId = await ctx.db.insert("taxGroups", {
      name,
      isDefault: args.isDefault,
      rates: args.rates,
      active: args.active,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Exactly one default (PH0-24's isDefault) — record anyone demoted.
    const demotedDefaultIds = args.isDefault ? await demoteOtherDefaults(ctx, groupId) : [];
    return {
      result: undefined,
      audit: {
        entityId: groupId,
        after: {
          name,
          isDefault: args.isDefault,
          active: args.active,
          ...args.rates,
          demotedDefaultIds,
        },
      },
    };
  },
});

export const updateGroup = auditedMutation({
  entity: "taxGroups",
  action: "update",
  args: {
    id: v.id("taxGroups"),
    name: v.string(),
    isDefault: v.boolean(),
    rates: ratesValidator,
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This tax group no longer exists.");
    }
    const name = args.name.trim();
    if (name.length < 1 || name.length > 100) {
      throw new ConvexError("Group name must be between 1 and 100 characters.");
    }
    await validateRateIds(ctx, args.rates);

    const before = {
      name: row.name,
      isDefault: row.isDefault,
      active: row.active,
      ...row.rates,
    };
    const after = {
      name,
      isDefault: args.isDefault,
      active: args.active,
      ...args.rates,
    };
    const changed =
      before.name !== after.name ||
      before.isDefault !== after.isDefault ||
      before.active !== after.active ||
      before.standard !== after.standard ||
      before.reduced !== after.reduced ||
      before.zero !== after.zero;

    const demotedDefaultIds =
      changed && args.isDefault && !row.isDefault ? await demoteOtherDefaults(ctx, row._id) : [];

    if (changed) {
      await ctx.db.patch(args.id, {
        name,
        isDefault: args.isDefault,
        rates: args.rates,
        active: args.active,
        updatedAt: Date.now(),
      });
    }
    return {
      result: undefined,
      audit:
        changed || demotedDefaultIds.length > 0
          ? { entityId: args.id, before, after: { ...after, demotedDefaultIds } }
          : undefined,
    };
  },
});
