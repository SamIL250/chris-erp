import { ConvexError, v } from "convex/values";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Attribute sets (PH1-04): named groups of definitions (`attributeIds`,
 * display order) that categories opt into via `categoryIds` — products in
 * those categories inherit the union of every covering set's attributes.
 * The resolver that turns "category → effective attributes" lives in
 * `attributes.forCategory`.
 *
 * Rules enforced HERE (never only in UI — docs/permissions.md rule 1):
 * - name 1-100 (sets are identified by id; names may repeat)
 * - `attributeIds`: deduped, every id must still exist (a definition
 *   deleted while referenced is blocked on the definitions side)
 * - `categoryIds`: deduped, every id must still exist
 * - update is full-form (omitted id lists clear — same convention as the
 *   category/definition editors); no-op saves record nothing
 *
 * Permissions per matrix (PH0-21): view → catalog.view, create →
 * catalog.create (owner/admin/sales), edits → catalog.edit (same),
 * delete → catalog.delete (owner/admin only). Every write is audited.
 * No delete reference check is needed: assignment lives here, so removing
 * a set removes its assignments with it.
 *
 * `list` returns the whole collection in name order (by_name) — bounded
 * config data like categories/definitions.
 */

const MAX_NAME = 100;

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    throw new ConvexError(`Set name must be between 1 and ${MAX_NAME} characters.`);
  }
  return name;
}

/** First occurrence wins; order otherwise preserved. */
function dedupe<T extends string>(ids: T[]): T[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function requireDefinitions(
  ctx: MutationCtx,
  ids: Id<"attributeDefinitions">[],
): Promise<Id<"attributeDefinitions">[]> {
  const unique = dedupe(ids);
  for (const id of unique) {
    if ((await ctx.db.get(id)) === null) {
      throw new ConvexError("One of those attributes no longer exists.");
    }
  }
  return unique;
}

async function requireCategories(
  ctx: MutationCtx,
  ids: Id<"categories">[],
): Promise<Id<"categories">[]> {
  const unique = dedupe(ids);
  for (const id of unique) {
    if ((await ctx.db.get(id)) === null) {
      throw new ConvexError("One of those categories no longer exists.");
    }
  }
  return unique;
}

/** All sets in name order (also the inheritance-resolution order). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog", "view");
    return await ctx.db.query("attributeSets").withIndex("by_name").order("asc").collect();
  },
});

export const create = auditedMutation({
  entity: "attributeSets",
  action: "create",
  args: {
    name: v.string(),
    attributeIds: v.optional(v.array(v.id("attributeDefinitions"))),
    categoryIds: v.optional(v.array(v.id("categories"))),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "create");
    const name = normalizeName(args.name);
    const attributeIds = await requireDefinitions(ctx, args.attributeIds ?? []);
    const categoryIds = await requireCategories(ctx, args.categoryIds ?? []);

    const now = Date.now();
    const id = await ctx.db.insert("attributeSets", {
      name,
      attributeIds,
      categoryIds,
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: { id },
      audit: { entityId: id, after: { name, attributeIds, categoryIds } },
    };
  },
});

export const update = auditedMutation({
  entity: "attributeSets",
  action: "update",
  args: {
    id: v.id("attributeSets"),
    name: v.string(),
    attributeIds: v.optional(v.array(v.id("attributeDefinitions"))),
    categoryIds: v.optional(v.array(v.id("categories"))),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This attribute set no longer exists.");
    }

    const name = normalizeName(args.name);
    const attributeIds = await requireDefinitions(ctx, args.attributeIds ?? []);
    const categoryIds = await requireCategories(ctx, args.categoryIds ?? []);

    const before = { name: row.name, attributeIds: row.attributeIds, categoryIds: row.categoryIds };
    const after = { name, attributeIds, categoryIds };
    const sameList = (a: string[], b: string[]) =>
      a.length === b.length && a.every((id, index) => id === b[index]);
    const changed =
      before.name !== after.name ||
      !sameList(before.attributeIds, after.attributeIds) ||
      !sameList(before.categoryIds, after.categoryIds);
    if (!changed) {
      return { result: undefined, audit: undefined };
    }

    await ctx.db.patch(args.id, { name, attributeIds, categoryIds, updatedAt: Date.now() });
    return { result: undefined, audit: { entityId: args.id, before, after } };
  },
});

export const remove = auditedMutation({
  entity: "attributeSets",
  action: "delete",
  args: { id: v.id("attributeSets") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "delete");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This attribute set no longer exists.");
    }
    await ctx.db.delete(args.id);
    return {
      result: undefined,
      audit: {
        entityId: args.id,
        before: { name: row.name, attributeIds: row.attributeIds, categoryIds: row.categoryIds },
      },
    };
  },
});
