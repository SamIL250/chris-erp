import { v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import { inviteUser } from "./_lib/invites";
import { requirePermission } from "./_lib/permissions";

/**
 * Create (or re-send) an invitation for an email address (PH0-19).
 *
 * The flow itself lives in `_lib/invites.ts` (`inviteUser`, shared with the
 * seed script PH0-34); this wrapper is the permission gate (users.create) and
 * the audit entry (PH0-26). `role` (PH0-22) is granted Owner-only inside the
 * helper — Admin can invite without a role and an Owner assigns one later.
 */
export const create = auditedMutation({
  entity: "users",
  action: "invite",
  args: { email: v.string(), name: v.optional(v.string()), role: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const inviterId = await requirePermission(ctx, "users", "create");

    const invite = await inviteUser(ctx, {
      email: args.email,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.role !== undefined ? { role: args.role } : {}),
      inviterId,
    });

    // Dev fallback (no Resend key): hand the link back so the UI can show it.
    return {
      result: { sent: invite.sent, ...(invite.sent ? {} : { url: invite.url }) },
      audit: {
        entityId: invite.userId,
        // Re-invite: the profile existed — record what it was.
        ...(invite.previousStatus !== undefined
          ? { before: { status: invite.previousStatus } }
          : {}),
        after: {
          status: "invited",
          email: invite.email,
          ...(args.role !== undefined ? { role: args.role } : {}),
        },
      },
    };
  },
});
