import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * The signed-in user's own profile (null when unauthenticated).
 * Used by the admin shell (avatar/name) and the profile settings page.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db.get(userId);
  },
});

/** Update the signed-in user's own profile (PH0-18). */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    const name = args.name.trim();
    if (name.length < 1 || name.length > 100) {
      throw new ConvexError("Name must be between 1 and 100 characters");
    }
    await ctx.db.patch(userId, { name, updatedAt: Date.now() });
  },
});

/**
 * Admin: all user profiles for the users table (PH0-19), newest first.
 * TODO(PH0-23): scope by permission (users.view) once RBAC lands.
 */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const viewerId = await getAuthUserId(ctx);
    if (viewerId === null) {
      throw new Error("Not authenticated");
    }
    return await ctx.db.query("users").order("desc").paginate(args.paginationOpts);
  },
});
