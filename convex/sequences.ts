import { ConvexError, v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import { requirePermission } from "./_lib/permissions";
import { DEFAULT_SEQUENCES, ensureDefaultSequences } from "./_lib/sequences";
import { query } from "./_generated/server";

/**
 * Document numbering settings (PH0-30): view the sequences, edit prefix and
 * padding, preview the next number. `next` is issuance-managed — it only
 * grows as documents are created (PH0-25's contract), so this UI never
 * writes it.
 *
 * `list` needs settings.view; `ensureDefaults` and `update` need
 * settings.edit and are audited.
 */

/** Canonical order first, then any custom sequences alphabetically. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "view");
    const rows = await ctx.db.query("sequences").collect();
    const order = new Map(DEFAULT_SEQUENCES.map((entry, index) => [entry.name, index]));
    return rows.sort((a, b) => {
      const byOrder = (order.get(a.name) ?? 1000) - (order.get(b.name) ?? 1000);
      return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name);
    });
  },
});

/** Create the canonical sequences that don't exist yet (empty-state button). */
export const ensureDefaults = auditedMutation({
  entity: "sequences",
  action: "create",
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "create");
    const before = (await ctx.db.query("sequences").collect()).length;
    await ensureDefaultSequences(ctx);
    const created = (await ctx.db.query("sequences").collect()).length - before;
    return {
      result: undefined,
      audit:
        created > 0
          ? { entityId: "defaults", after: { created, total: DEFAULT_SEQUENCES.length } }
          : undefined,
    };
  },
});

/** Edit one sequence's prefix/padding (audited with before/after). */
export const update = auditedMutation({
  entity: "sequences",
  action: "update",
  args: { id: v.id("sequences"), prefix: v.string(), padding: v.number() },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "edit");
    const row = await ctx.db.get(args.id);
    if (row === null) {
      throw new ConvexError("This sequence no longer exists.");
    }
    const prefix = args.prefix.trim().toUpperCase();
    if (!/^[A-Z0-9-]{1,10}$/.test(prefix)) {
      throw new ConvexError("Prefix must be 1-10 characters (A-Z, 0-9, or -).");
    }
    if (!Number.isInteger(args.padding) || args.padding < 1 || args.padding > 6) {
      throw new ConvexError("Padding must be a whole number between 1 and 6.");
    }

    const changed = prefix !== row.prefix || args.padding !== row.padding;
    if (changed) {
      await ctx.db.patch(row._id, { prefix, padding: args.padding, updatedAt: Date.now() });
    }
    return {
      result: undefined,
      audit: changed
        ? {
            entityId: row._id,
            before: { prefix: row.prefix, padding: row.padding, next: row.next },
            after: { prefix, padding: args.padding, next: row.next },
          }
        : undefined,
    };
  },
});
