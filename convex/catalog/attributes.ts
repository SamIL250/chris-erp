import { ConvexError, v } from "convex/values";
import { orderApplicableAttributes } from "../../lib/attributes";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Attribute definitions (PH1-03): name + type (text, number, select,
 * multi_select, boolean, date) + optional unit — the spec vocabulary PH1-04
 * groups into sets and PH1-07 renders on the product editor.
 *
 * Shape rules enforced HERE (never only in UI — docs/permissions.md rule 1):
 * - name 1-100 (duplicates allowed, like category names — identity is the id)
 * - `unit` only on `number` attributes (trimmed, ≤ 50 chars, "" → none)
 * - `options` only on `select`/`multi_select` (≥ 1 after trimming blanks,
 *   each ≤ 100 chars, deduped case-insensitively, admin order preserved);
 *   supplying options for other types is an error — explicit beats silently
 *   dropped data
 * - update is full-form (omitted unit/options clear, same convention as the
 *   category editor); type changes are blocked while product value rows
 *   exist (PH1-07 guard — they'd be stranded in their old typed column):
 *   clear the values first, explicitly
 *
 * Permissions per matrix (PH0-21): view → catalog.view (everyone), create →
 * catalog.create (owner/admin/sales), edits → catalog.edit (same), delete →
 * catalog.delete (owner/admin only). Every write is audited; no-op saves
 * record nothing (PH0-30 pattern).
 *
 * `list` returns the whole collection in name order (by_name index) —
 * bounded config data like categories/sequences/taxRates.
 *
 * Delete reference checks: sets since PH1-04, product value references
 * since PH1-07 (`applicableAttributes` / `valuesFor` below).
 */

const MAX_NAME = 100;
const MAX_UNIT = 50;
const MAX_OPTION = 100;
const MAX_OPTIONS = 100;

/** Types whose value comes from a choice list. */
const SELECT_TYPES = new Set(["select", "multi_select"]);

type Attribute = Doc<"attributeDefinitions">;
type AttributeType = Attribute["type"];

/**
 * Normalize + validate the type-dependent parts of a definition.
 * Returns the stored `{ unit, options }` or throws a user-facing error.
 */
function normalizeShape(
  type: AttributeType,
  unitArg: string | undefined,
  optionsArg: string[] | undefined,
): { unit: string | undefined; options: string[] } {
  let unit: string | undefined;
  if (unitArg !== undefined) {
    const trimmed = unitArg.trim();
    if (trimmed.length > 0) {
      if (type !== "number") {
        throw new ConvexError("A unit can only be set on Number attributes.");
      }
      if (trimmed.length > MAX_UNIT) {
        throw new ConvexError(`Unit must be ${MAX_UNIT} characters or fewer.`);
      }
      unit = trimmed;
    }
  }

  const options: string[] = [];
  if (optionsArg !== undefined) {
    if (optionsArg.length > MAX_OPTIONS) {
      throw new ConvexError(`An attribute can have at most ${MAX_OPTIONS} options.`);
    }
    const seen = new Set<string>();
    for (const raw of optionsArg) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue; // blanks are a form artifact
      if (trimmed.length > MAX_OPTION) {
        throw new ConvexError(`Each option must be ${MAX_OPTION} characters or fewer.`);
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue; // case-insensitive dedupe, first wins
      seen.add(key);
      options.push(trimmed);
    }
  }

  if (SELECT_TYPES.has(type)) {
    if (options.length === 0) {
      throw new ConvexError("Select and Multi-select attributes need at least one option.");
    }
  } else if (options.length > 0) {
    throw new ConvexError("Only Select and Multi-select attributes take options.");
  }
  return { unit, options };
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    throw new ConvexError(`Attribute name must be between 1 and ${MAX_NAME} characters.`);
  }
  return name;
}

async function loadAll(ctx: MutationCtx): Promise<Attribute[]> {
  return await ctx.db.query("attributeDefinitions").collect();
}

/** Definitions in name order — the admin list's stable display order. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog", "view");
    return await ctx.db.query("attributeDefinitions").withIndex("by_name").order("asc").collect();
  },
});

/**
 * Value rows referencing a definition. All four `by_attribute_*` indexes
 * share `attributeId` as their prefix, and a row missing a typed column is
 * still indexed under that column's null key (PH1-06 finding) — so one
 * prefix scan on `by_attribute_text` sees EVERY row for the attribute no
 * matter which typed column holds its value.
 */
async function valuesFor(ctx: QueryCtx | MutationCtx, attributeId: Id<"attributeDefinitions">) {
  return await ctx.db
    .query("attributeValues")
    .withIndex("by_attribute_text", (q) => q.eq("attributeId", attributeId))
    .collect();
}

/** Distinct products carrying a value for this definition. */
async function countValueProducts(
  ctx: QueryCtx | MutationCtx,
  attributeId: Id<"attributeDefinitions">,
): Promise<number> {
  const rows = await valuesFor(ctx, attributeId);
  return new Set(rows.map((row) => row.productId)).size;
}

/**
 * Distinct products whose VARIANTS reference a definition (PH1-09) — as a
 * pinned option value on a `variants` row, or as a variant axis on the
 * product row itself. Kept inline (not imported from `variants.ts`) so
 * module imports stay one-way: `variants.ts` already imports
 * `applicableAttributes` from here. Bounded admin-frequency scans, like the
 * value checks below.
 */
async function countVariantProducts(
  ctx: QueryCtx | MutationCtx,
  attributeId: Id<"attributeDefinitions">,
): Promise<number> {
  const used = new Set<string>();
  const variants = await ctx.db.query("variants").collect();
  for (const row of variants) {
    if (row.optionValues.some((entry) => entry.attributeId === attributeId)) {
      used.add(row.productId);
    }
  }
  const products = await ctx.db.query("products").collect();
  for (const row of products) {
    if ((row.variantAxisIds ?? []).includes(attributeId)) used.add(row._id);
  }
  return used.size;
}

/**
 * Definitions applicable to a product (PH1-07): the same ordering rule as
 * `forCategory`, widened to the union of every set covering ANY of the
 * product's categories plus the product's own `attributeSetIds` picks.
 * Shared by `products.get` (the editor loader) and the product mutations
 * (value validation), built on the pure `lib/attributes.ts` ordering the
 * client form mirrors — so what the editor renders and what the mutation
 * accepts can't disagree.
 */
export async function applicableAttributes(
  ctx: QueryCtx | MutationCtx,
  args: { categoryIds: Id<"categories">[]; attributeSetIds: Id<"attributeSets">[] },
): Promise<Doc<"attributeDefinitions">[]> {
  const sets = await ctx.db.query("attributeSets").withIndex("by_name").order("asc").collect();
  const definitions = await ctx.db
    .query("attributeDefinitions")
    .withIndex("by_name")
    .order("asc")
    .collect();
  return orderApplicableAttributes(sets, definitions, args);
}

/**
 * Effective attributes for products in `categoryId` (PH1-04 inheritance,
 * consumed by the PH1-07 product editor and spec tables): the union of
 * every set covering the category — set name order first, then each set's
 * own attribute order, deduplicated (first occurrence wins). Definitions
 * are returned as full rows so the caller can render inputs directly.
 */
export const forCategory = query({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "view");
    if ((await ctx.db.get(args.categoryId)) === null) {
      throw new ConvexError("This category no longer exists.");
    }
    return await applicableAttributes(ctx, {
      categoryIds: [args.categoryId],
      attributeSetIds: [],
    });
  },
});

export const create = auditedMutation({
  entity: "attributeDefinitions",
  action: "create",
  args: {
    name: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("number"),
      v.literal("select"),
      v.literal("multi_select"),
      v.literal("boolean"),
      v.literal("date"),
    ),
    unit: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "create");
    const name = normalizeName(args.name);
    const { unit, options } = normalizeShape(args.type, args.unit, args.options);

    const now = Date.now();
    const id = await ctx.db.insert("attributeDefinitions", {
      name,
      type: args.type,
      unit,
      options,
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: { id },
      audit: { entityId: id, after: { name, type: args.type, unit, options } },
    };
  },
});

export const update = auditedMutation({
  entity: "attributeDefinitions",
  action: "update",
  args: {
    id: v.id("attributeDefinitions"),
    name: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("number"),
      v.literal("select"),
      v.literal("multi_select"),
      v.literal("boolean"),
      v.literal("date"),
    ),
    unit: v.optional(v.string()),
    options: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const all = await loadAll(ctx);
    const row = all.find((candidate) => candidate._id === args.id);
    if (row === undefined) {
      throw new ConvexError("This attribute no longer exists.");
    }
    // PH1-07's type-change guard (deferred here from PH1-04): a type change
    // would strand stored value rows in their old typed column — a valueText
    // row under a now-`number` definition renders (and validates) as garbage.
    // Explicit beats silently dropped data: clear the values first.
    if (args.type !== row.type) {
      const used = await countValueProducts(ctx, args.id);
      if (used > 0) {
        throw new ConvexError(
          `This attribute is used by ${used} product${used === 1 ? "" : "s"} — clear those values before changing its type.`,
        );
      }
    }

    const name = normalizeName(args.name);
    const { unit, options } = normalizeShape(args.type, args.unit, args.options);

    // PH1-09's variant guard (same shape as the value guard above): a type
    // change would strand variant axes and option pins on a definition that
    // no longer expresses them.
    if (args.type !== row.type) {
      const used = await countVariantProducts(ctx, args.id);
      if (used > 0) {
        throw new ConvexError(
          `This attribute is used in variants on ${used} product${used === 1 ? "" : "s"} — remove the variant setup there first.`,
        );
      }
    }
    // PH1-09's option guard: dropping an option strands the variants pinned
    // to it (their combination can never validate again). Explicit beats a
    // silently orphaned matrix — update or remove those variants first.
    if (SELECT_TYPES.has(args.type)) {
      const removedOptions = row.options.filter(
        (option) => !options.some((next) => next.toLowerCase() === option.toLowerCase()),
      );
      if (removedOptions.length > 0) {
        const variants = await ctx.db.query("variants").collect();
        for (const option of removedOptions) {
          const users = variants.filter((variant) =>
            variant.optionValues.some(
              (entry) =>
                entry.attributeId === args.id && entry.value.toLowerCase() === option.toLowerCase(),
            ),
          );
          if (users.length > 0) {
            throw new ConvexError(
              `Option "${option}" is used by ${users.length} variant${users.length === 1 ? "" : "s"} — update or remove those variants first.`,
            );
          }
        }
      }
    }

    const before = { name: row.name, type: row.type, unit: row.unit, options: row.options };
    const after = { name, type: args.type, unit, options };
    const changed =
      before.name !== after.name ||
      before.type !== after.type ||
      before.unit !== after.unit ||
      before.options.length !== after.options.length ||
      before.options.some((option, index) => option !== after.options[index]);
    if (!changed) {
      return { result: undefined, audit: undefined };
    }

    await ctx.db.patch(args.id, {
      name,
      type: args.type,
      unit,
      options,
      updatedAt: Date.now(),
    });
    return { result: undefined, audit: { entityId: args.id, before, after } };
  },
});

export const remove = auditedMutation({
  entity: "attributeDefinitions",
  action: "delete",
  args: { id: v.id("attributeDefinitions") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "delete");
    const all = await loadAll(ctx);
    const row = all.find((candidate) => candidate._id === args.id);
    if (row === undefined) {
      throw new ConvexError("This attribute no longer exists.");
    }
    // PH1-04's reference check: definitions group into sets.
    const sets = await ctx.db.query("attributeSets").collect();
    const usedBy = sets.filter((set) => set.attributeIds.includes(args.id));
    if (usedBy.length > 0) {
      const count = usedBy.length;
      throw new ConvexError(
        `This attribute is used by ${count} attribute set${count === 1 ? "" : "s"} — remove it there first.`,
      );
    }
    // PH1-07's value check: product values reference the definition. Clear
    // them from the product editor first (delete would strand audit-less rows
    // behind a definition that can never validate them again).
    const valueProducts = await countValueProducts(ctx, args.id);
    if (valueProducts > 0) {
      throw new ConvexError(
        `This attribute is used by ${valueProducts} product${valueProducts === 1 ? "" : "s"} — remove those values on the product first.`,
      );
    }
    // PH1-09's variant check: variant axes and option pins reference the
    // definition (same reasoning — removing it would orphan a matrix).
    const variantProducts = await countVariantProducts(ctx, args.id);
    if (variantProducts > 0) {
      throw new ConvexError(
        `This attribute is used in variants on ${variantProducts} product${variantProducts === 1 ? "" : "s"} — remove the variant setup there first.`,
      );
    }
    await ctx.db.delete(args.id);
    return {
      result: undefined,
      audit: {
        entityId: args.id,
        before: { name: row.name, type: row.type, unit: row.unit, options: row.options },
      },
    };
  },
});
