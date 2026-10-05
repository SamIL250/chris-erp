import type { DataModelFromSchemaDefinition, GenericMutationCtx } from "convex/server";
import { ConvexError, type GenericId as Id } from "convex/values";
import { randomHex, sha256Hex } from "../../lib/crypto";
import { sendEmail } from "../../lib/emails";
import type schema from "../schema";
import { grantRole, isRoleKey, requireRole } from "./permissions";

/** Invite links are valid for 7 days. */
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type MutationCtx = GenericMutationCtx<DataModelFromSchemaDefinition<typeof schema>>;

export interface InviteOutcome {
  userId: Id<"users">;
  email: string;
  url: string;
  sent: boolean;
  /** Profile status before this invite — present only on re-invites. */
  previousStatus?: string;
}

/**
 * Create (or re-send) an invitation for an email address (PH0-19).
 *
 * Shared by `invites.create` (PH0-19, audited + permission-checked there) and
 * the seed script (PH0-34). Callers are responsible for their own
 * `requirePermission`/`requireRole` gate FIRST (docs/permissions.md rule 2);
 * this helper re-checks Owner for role grants on its own (rule 4).
 *
 * - Creates the `users` profile with `status: "invited"` up front, so the
 *   users table shows pending members immediately.
 * - Emails a single-use code; accepting it (password sign-up carrying the
 *   code, see `convex/auth.ts` → `createOrUpdateUser`) flips the profile to
 *   `active`. Without a Resend key the link is returned for the caller.
 * - Re-inviting revokes outstanding codes so only the newest link works.
 * - `role`: optional role granted with the invite (Owner-only to pass).
 */
export async function inviteUser(
  ctx: MutationCtx,
  args: { email: string; name?: string; role?: string; inviterId: Id<"users"> },
): Promise<InviteOutcome> {
  const { inviterId } = args;

  const email = args.email.toLowerCase().trim();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ConvexError("Enter a valid email address");
  }
  const name = args.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 100)) {
    throw new ConvexError("Name must be between 1 and 100 characters");
  }
  if (args.role !== undefined && !isRoleKey(args.role)) {
    throw new ConvexError("Unknown role.");
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
  let userId: Id<"users">;
  let previousStatus: string | undefined;
  if (existing !== undefined && existing.status === "active") {
    throw new ConvexError("This person is already a member.");
  } else if (existing !== undefined && existing.status === "disabled") {
    throw new ConvexError("This account is disabled — re-enable it instead of inviting.");
  } else if (existing !== undefined) {
    // Re-invite: refresh the invitation and patch the admin-provided name.
    userId = existing._id;
    previousStatus = existing.status;
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

  // Role grant (PH0-22): assigned at invite time so the users table shows
  // it immediately; the invitee can't sign in until they accept anyway.
  // Omitting `role` never touches an existing assignment (rule 4: Admin
  // must not be able to clear someone's role via re-invite).
  if (args.role !== undefined) {
    await requireRole(ctx, inviterId, "owner");
    await grantRole(ctx, { userId, roleKey: args.role, grantedBy: inviterId });
  }

  const code = randomHex(32);
  await ctx.db.insert("invites", {
    email,
    userId,
    codeHash: await sha256Hex(code),
    expiresAt: now + INVITE_TTL_MS,
    invitedBy: inviterId,
    role: args.role,
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

  return { userId, email, url, sent, previousStatus };
}
