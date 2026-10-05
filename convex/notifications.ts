import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";

/**
 * Notification center (PH0-28): everyone reads their own — no RBAC beyond a
 * session. `notify()` (convex/_lib/notifications.ts) writes; this module
 * lists, counts, and marks read. Unread = `readAt` undefined, filtered after
 * the `by_user_time` index (optional fields stay out of indexes, PH0-24).
 */

async function requireSession(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Not authenticated");
  }
  return userId;
}

/** Newest first for the signed-in user. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx);
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/**
 * Bell badge. Bounded at 1000 — the UI renders "999+" anyway, and a single
 * company's per-user notification volume is well under that.
 */
export const countUnread = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSession(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("readAt"), undefined))
      .take(1000);
    return unread.length;
  },
});

/** Mark specific rows read — rows belonging to others are ignored. */
export const markRead = mutation({
  args: { ids: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const userId = await requireSession(ctx);
    const now = Date.now();
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (row !== null && row.userId === userId && row.readAt === undefined) {
        await ctx.db.patch(id, { readAt: now });
      }
    }
  },
});

/** "Mark all as read" — batched so it never blocks on volume. */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSession(ctx);
    const now = Date.now();
    for (;;) {
      const batch = await ctx.db
        .query("notifications")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("readAt"), undefined))
        .take(100);
      if (batch.length === 0) break;
      for (const row of batch) {
        await ctx.db.patch(row._id, { readAt: now });
      }
    }
  },
});
