import { ConvexError, v } from "convex/values";
import {
  normalizeWarehouseAddress,
  normalizeWarehouseCode,
  normalizeWarehouseName,
  warehouseCodeError,
  warehouseNameError,
} from "../../lib/warehouses";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Warehouses (PH1-16): the locations stock will be counted against.
 *
 * One row is the default — the place a receipt lands when the document
 * doesn't name a warehouse. The first warehouse is always that default.
 * Making another the default clears the previous one in the same
 * transaction. The default cannot be deactivated or stripped of the flag
 * until a different warehouse takes it. Inactive rows stay listed so later
 * ledger history can still name them.
 */

type WarehouseDoc = Doc<"warehouses">;

function snapshot(row: {
  code: string;
  name: string;
  address?: string;
  isDefault: boolean;
  active: boolean;
}) {
  return {
    code: row.code,
    name: row.name,
    address: row.address,
    isDefault: row.isDefault,
    active: row.active,
  };
}

function parseFields(args: { code: string; name: string; address?: string }) {
  const codeError = warehouseCodeError(args.code);
  if (codeError !== null) throw new ConvexError(codeError);
  const nameError = warehouseNameError(args.name);
  if (nameError !== null) throw new ConvexError(nameError);
  const address = normalizeWarehouseAddress(args.address);
  if ("error" in address) throw new ConvexError(address.error);
  return {
    code: normalizeWarehouseCode(args.code),
    name: normalizeWarehouseName(args.name),
    address: address.address,
  };
}

/** Drop the default flag on every warehouse except `keep`. */
async function clearOtherDefaults(ctx: MutationCtx, keep: Id<"warehouses">, now: number) {
  const rows = await ctx.db.query("warehouses").collect();
  for (const row of rows) {
    if (row._id !== keep && row.isDefault) {
      await ctx.db.patch(row._id, { isDefault: false, updatedAt: now });
    }
  }
}

/** Default first, then active before inactive, then name. */
function compareWarehouses(a: WarehouseDoc, b: WarehouseDoc): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (a.active !== b.active) return a.active ? -1 : 1;
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a._id.localeCompare(b._id);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "inventory", "view");
    const rows = await ctx.db.query("warehouses").collect();
    return rows.sort(compareWarehouses);
  },
});

const WAREHOUSE_ARGS = {
  code: v.string(),
  name: v.string(),
  address: v.optional(v.string()),
  isDefault: v.boolean(),
  active: v.boolean(),
};

export const create = auditedMutation({
  entity: "warehouses",
  action: "create",
  args: WAREHOUSE_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "create");
    const fields = parseFields(args);
    const existing = await ctx.db
      .query("warehouses")
      .withIndex("by_code", (q) => q.eq("code", fields.code))
      .unique();
    if (existing !== null) {
      throw new ConvexError(`A warehouse with code ${fields.code} already exists.`);
    }
    const others = await ctx.db.query("warehouses").collect();
    // The first warehouse is the default and active whether or not the
    // form asked — there is nothing else to receive stock.
    const isFirst = others.length === 0;
    const isDefault = isFirst || args.isDefault;
    const active = isFirst || args.active;
    if (isDefault && !active) {
      throw new ConvexError("An inactive warehouse can't be the default.");
    }

    const now = Date.now();
    const id = await ctx.db.insert("warehouses", {
      code: fields.code,
      name: fields.name,
      ...(fields.address !== undefined ? { address: fields.address } : {}),
      isDefault,
      active,
      createdAt: now,
      updatedAt: now,
    });
    if (isDefault) await clearOtherDefaults(ctx, id, now);

    const stored = { ...fields, isDefault, active };
    return { result: { id }, audit: { entityId: id, after: snapshot(stored) } };
  },
});

export const update = auditedMutation({
  entity: "warehouses",
  action: "update",
  args: { id: v.id("warehouses"), ...WAREHOUSE_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) throw new ConvexError("This warehouse no longer exists.");

    const fields = parseFields(args);
    const clash = await ctx.db
      .query("warehouses")
      .withIndex("by_code", (q) => q.eq("code", fields.code))
      .unique();
    if (clash !== null && clash._id !== row._id) {
      throw new ConvexError(`A warehouse with code ${fields.code} already exists.`);
    }
    if (row.isDefault && !args.isDefault) {
      throw new ConvexError("Choose another warehouse as the default first.");
    }
    if (row.isDefault && !args.active) {
      throw new ConvexError(
        "The default warehouse has to stay active. Choose another default first.",
      );
    }
    if (!args.active && args.isDefault) {
      throw new ConvexError("An inactive warehouse can't be the default.");
    }

    const next = { ...fields, isDefault: args.isDefault, active: args.active };
    const changed =
      next.code !== row.code ||
      next.name !== row.name ||
      next.address !== row.address ||
      next.isDefault !== row.isDefault ||
      next.active !== row.active;
    if (!changed) return { result: undefined, audit: undefined };

    const now = Date.now();
    await ctx.db.replace(row._id, {
      code: next.code,
      name: next.name,
      ...(next.address !== undefined ? { address: next.address } : {}),
      isDefault: next.isDefault,
      active: next.active,
      createdAt: row.createdAt,
      updatedAt: now,
    });
    if (next.isDefault) await clearOtherDefaults(ctx, row._id, now);

    return {
      result: undefined,
      audit: { entityId: row._id, before: snapshot(row), after: snapshot(next) },
    };
  },
});

export const remove = auditedMutation({
  entity: "warehouses",
  action: "delete",
  args: { id: v.id("warehouses") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "inventory", "delete");
    const row = await ctx.db.get(args.id);
    if (row === null) throw new ConvexError("This warehouse no longer exists.");

    const others = (await ctx.db.query("warehouses").collect()).filter(
      (item) => item._id !== row._id,
    );
    if (row.isDefault && others.length > 0) {
      throw new ConvexError("Choose another warehouse as the default before removing this one.");
    }

    await ctx.db.delete(row._id);
    return { result: undefined, audit: { entityId: row._id, before: snapshot(row) } };
  },
});
