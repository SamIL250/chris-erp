import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
      throw new Error("Name must be between 1 and 100 characters");
    }
    await ctx.db.patch(userId, { name, updatedAt: Date.now() });
  },
});
