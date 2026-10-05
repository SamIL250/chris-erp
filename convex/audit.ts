import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requirePermission } from "./_lib/permissions";
import { query } from "./_generated/server";

/**
 * Audit log viewer backend (PH0-26). Every read requires `settings.view`
 * (Owner/Admin/Accountant per docs/permissions.md); the table itself is
 * append-only — there is no update/delete function.
 */

/**
 * Paginated audit entries, newest first, filtered by actor/entity/date.
 * Date bounds ride the `by_time` index; actor/entity narrow afterwards
 * (both are low-cardinality at single-company scale).
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    actorId: v.nullable(v.id("users")),
    entity: v.nullable(v.string()),
    from: v.nullable(v.number()),
    to: v.nullable(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "settings", "view");
    return await ctx.db
      .query("auditLog")
      .withIndex("by_time", (q) => {
        if (args.from !== null && args.to !== null)
          return q.gte("createdAt", args.from).lte("createdAt", args.to);
        if (args.from !== null) return q.gte("createdAt", args.from);
        if (args.to !== null) return q.lte("createdAt", args.to);
        return q;
      })
      .filter((q) => (args.actorId === null ? true : q.eq(q.field("actorId"), args.actorId)))
      .filter((q) => (args.entity === null ? true : q.eq(q.field("entity"), args.entity)))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/** Distinct actors seen in the recent log — feeds the actor filter without
 * needing `users.view` (Accountant can filter the log but not list users).
 * System entries (no actor) are skipped: they can't be selected back out of
 * the log with a `users`-typed filter. */
export const actors = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "view");
    const recent = await ctx.db.query("auditLog").order("desc").take(500);
    const seen = new Map<string, string>();
    for (const entry of recent) {
      if (entry.actorId === undefined) continue;
      if (!seen.has(entry.actorId)) seen.set(entry.actorId, entry.actorLabel ?? "Unknown user");
    }
    return [...seen].map(([id, label]) => ({ id, label }));
  },
});

/** Distinct entity types seen in the recent log — feeds the entity filter
 * (new entities appear as later phases add tables). */
export const entities = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "settings", "view");
    const recent = await ctx.db.query("auditLog").order("desc").take(500);
    return [...new Set(recent.map((entry) => entry.entity))].sort();
  },
});
