import { ConvexError, v } from "convex/values";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { query, type MutationCtx } from "../_generated/server";
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
 *   category editor); type changes are free-form while no product values
 *   exist yet — once PH1-07 stores values, narrowing types may need a guard
 *
 * Permissions per matrix (PH0-21): view → catalog.view (everyone), create →
 * catalog.create (owner/admin/sales), edits → catalog.edit (same), delete →
 * catalog.delete (owner/admin only). Every write is audited; no-op saves
 * record nothing (PH0-30 pattern).
 *
 * `list` returns the whole collection in name order (by_name index) —
 * bounded config data like categories/sequences/taxRates.
 *
 * Delete reference check: blocking deletes while an attribute sits in a set
 * arrives with PH1-04 (the `attributeSets` table doesn't exist yet); product
 * value references follow with PH1-07.
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
    const sets = await ctx.db.query("attributeSets").withIndex("by_name").order("asc").collect();

    const ordered: Id<"attributeDefinitions">[] = [];
    const seen = new Set<string>();
    for (const set of sets) {
      if (!set.categoryIds.includes(args.categoryId)) continue;
      for (const id of set.attributeIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        ordered.push(id);
      }
    }
    const rows = await Promise.all(ordered.map((id) => ctx.db.get(id)));
    return rows.filter((row): row is Doc<"attributeDefinitions"> => row !== null);
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

    const name = normalizeName(args.name);
    const { unit, options } = normalizeShape(args.type, args.unit, args.options);

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
    // PH1-04's reference check: definitions group into sets. Product value
    // references follow with PH1-07 (no value storage exists yet).
    const sets = await ctx.db.query("attributeSets").collect();
    const usedBy = sets.filter((set) => set.attributeIds.includes(args.id));
    if (usedBy.length > 0) {
      const count = usedBy.length;
      throw new ConvexError(
        `This attribute is used by ${count} attribute set${count === 1 ? "" : "s"} — remove it there first.`,
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
