import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, type GenericId } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/**
 * Session management (PH0-20).
 *
 * Sessions live in `authSessions` (one per device/sign-in) and are validated
 * by the Convex platform on every request via `convex/auth.config.ts`, so
 * deleting a session kills that device immediately — the signed JWT alone is
 * no longer accepted.
 */
export const revokeOtherSessions = action({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Not authenticated");
    }
    // Subject format: `<userId>|<sessionId>` (see TOKEN_SUB_CLAIM_DIVIDER in
    // @convex-dev/auth) — keep the caller's own session, delete the rest.
    const identity = await ctx.auth.getUserIdentity();
    const sessionId = identity?.subject.split("|")[1];
    await ctx.runMutation(internal.auth.store, {
      args: {
        type: "invalidateSessions",
        userId,
        ...(sessionId ? { except: [sessionId as GenericId<"authSessions">] } : {}),
      },
    });
    return { ok: true };
  },
});
