import { ConvexError, v } from "convex/values";
import {
  customerGroupNameError,
  customerGroupNameKey,
  normalizeCustomerGroupName,
} from "../../lib/customers";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Customer groups (PH2-02). One tier per company. Group prices are
 * their own rows (PH2-06). Sales opens a group. Warehouse may rename
 * or retire one, the same way it may edit a customer. Accountant reads.
 * There is no delete: deactivate the tier. Customers already on an
 * inactive tier stay there until someone moves them.
 */

type ReadCtx = QueryCtx | MutationCtx;

async function requireGroup(ctx: ReadCtx, groupId: Id<"customerGroups">) {
  const group = await ctx.db.get(groupId);
  if (group === null) throw new ConvexError("Customer group not found.");
  return group;
}

async function customersIn(ctx: ReadCtx, groupId: Id<"customerGroups">) {
  return await ctx.db
    .query("customers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
}

function parsedName(raw: string) {
  const message = customerGroupNameError(raw);
  if (message !== null) throw new ConvexError(message);
  const name = normalizeCustomerGroupName(raw);
  return { name, nameKey: customerGroupNameKey(name) };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const rows = await ctx.db.query("customerGroups").collect();
    const withCounts = await Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        name: row.name,
        active: row.active,
        customerCount: (await customersIn(ctx, row._id)).length,
      })),
    );
    return withCounts.sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
  },
});

export const get = query({
  args: { groupId: v.id("customerGroups") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const group = await ctx.db.get(args.groupId);
    if (group === null) return null;
    const customers = (await customersIn(ctx, group._id))
      .map((row) => ({
        _id: row._id,
        code: row.code,
        name: row.name,
        status: row.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
    return {
      group: {
        _id: group._id,
        name: group.name,
        active: group.active,
        updatedAt: group.updatedAt,
      },
      customers,
    };
  },
});

export const create = auditedMutation({
  entity: "customerGroups",
  action: "create",
  args: { name: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const { name, nameKey } = parsedName(args.name);
    const clash = await ctx.db
      .query("customerGroups")
      .withIndex("by_name_key", (q) => q.eq("nameKey", nameKey))
      .unique();
    if (clash !== null) {
      throw new ConvexError(`A customer group named ${name} already exists.`);
    }
    const now = Date.now();
    const id = await ctx.db.insert("customerGroups", {
      name,
      nameKey,
      active: args.active,
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: id,
      audit: { entityId: id, after: { name, active: args.active } },
    };
  },
});

export const update = auditedMutation({
  entity: "customerGroups",
  action: "update",
  args: { groupId: v.id("customerGroups"), name: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const existing = await requireGroup(ctx, args.groupId);
    const { name, nameKey } = parsedName(args.name);
    const clash = await ctx.db
      .query("customerGroups")
      .withIndex("by_name_key", (q) => q.eq("nameKey", nameKey))
      .unique();
    if (clash !== null && clash._id !== existing._id) {
      throw new ConvexError(`A customer group named ${name} already exists.`);
    }
    const before = { name: existing.name, active: existing.active };
    await ctx.db.replace(existing._id, {
      name,
      nameKey,
      active: args.active,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    return {
      result: existing._id,
      audit: { entityId: existing._id, before, after: { name, active: args.active } },
    };
  },
});
