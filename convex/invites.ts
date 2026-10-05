import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { randomHex, sha256Hex } from "../lib/crypto";
import { sendEmail } from "../lib/emails";
import { mutation } from "./_generated/server";

/** Invite links are valid for 7 days. */
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Create (or re-send) an invitation for an email address (PH0-19).
 *
 * - Creates the `users` profile with `status: "invited"` up front, so the
 *   users table shows pending members immediately.
 * - Emails a single-use code; accepting it (password sign-up carrying the
 *   code, see `convex/auth.ts` → `createOrUpdateUser`) flips the profile to
 *   `active`. Without a Resend key the link is returned for the UI to show.
 * - Re-inviting revokes outstanding codes so only the newest link works.
 *
 * TODO(PH0-23): gate by permission (users.manage) once RBAC lands.
 */
export const create = mutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const inviterId = await getAuthUserId(ctx);
    if (inviterId === null) {
      throw new ConvexError("Not authenticated");
    }

    const email = args.email.toLowerCase().trim();
    if (!EMAIL_PATTERN.test(email)) {
      throw new ConvexError("Enter a valid email address");
    }
    const name = args.name?.trim();
    if (name !== undefined && (name.length < 1 || name.length > 100)) {
      throw new ConvexError("Name must be between 1 and 100 characters");
    }

    const matches = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(2);
    if (matches.length > 1) {
      throw new ConvexError(
        "Multiple accounts already use this email — resolve the duplicates first.",
      );
    }

    const now = Date.now();
    const existing = matches[0];
    let userId;
    if (existing !== undefined && existing.status === "active") {
      throw new ConvexError("This person is already a member.");
    } else if (existing !== undefined && existing.status === "disabled") {
      throw new ConvexError("This account is disabled — re-enable it instead of inviting.");
    } else if (existing !== undefined) {
      // Re-invite: refresh the invitation and patch the admin-provided name.
      userId = existing._id;
      await ctx.db.patch(userId, {
        ...(name !== undefined ? { name } : {}),
        invitedBy: inviterId,
        invitedAt: now,
        updatedAt: now,
      });
    } else {
      userId = await ctx.db.insert("users", {
        email,
        ...(name !== undefined ? { name } : {}),
        status: "invited",
        invitedBy: inviterId,
        invitedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Only the newest link should work: revoke outstanding codes first.
    const outstanding = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(20);
    for (const invite of outstanding) {
      if (invite.acceptedAt === undefined && invite.revokedAt === undefined) {
        await ctx.db.patch(invite._id, { revokedAt: now });
      }
    }

    const code = randomHex(32);
    await ctx.db.insert("invites", {
      email,
      userId,
      codeHash: await sha256Hex(code),
      expiresAt: now + INVITE_TTL_MS,
      invitedBy: inviterId,
      createdAt: now,
    });

    const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const url = `${siteUrl}/invite?email=${encodeURIComponent(email)}&code=${code}`;
    const sent = await sendEmail({
      to: email,
      subject: "You're invited to Chris ERP",
      text:
        `You've been invited to join Chris ERP.\n\n` +
        `Set your name and password by opening this link:\n${url}\n\n` +
        `The link expires in 7 days and can only be used once. ` +
        `If you didn't expect this, you can ignore this email.`,
    });

    // Dev fallback (no Resend key): hand the link back so the UI can show it.
    return { sent, ...(sent ? {} : { url }) };
  },
});
