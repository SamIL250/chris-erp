import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import {
  effectiveRoleKeys,
  grantRole,
  isRoleKey,
  requirePermission,
  requireRole,
  roleKeysForUsers,
  SYSTEM_ROLES,
  type RoleKey,
} from "./_lib/permissions";
import { query } from "./_generated/server";

/**
 * The signed-in user's own profile (null when unauthenticated), plus the
 * resolved roles for display (PH0-22). Used by the admin shell (avatar/name)
 * and the profile settings page.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null) return null;
    // Uploaded photo (PH0-27) wins over the provider's image — signed URLs
    // expire, so resolve fresh on every read instead of persisting one.
    let image = user.image;
    if (user.avatarFileId !== undefined) {
      const file = await ctx.db.get(user.avatarFileId);
      const url = file !== null ? await ctx.storage.getUrl(file.storageId) : null;
      image = url ?? user.image;
    }
    const keys = await effectiveRoleKeys(ctx, userId);
    return {
      ...user,
      image,
      roles: keys.map((key) => ({
        key,
        name: SYSTEM_ROLES.find((role) => role.key === key)?.name ?? key,
      })),
    };
  },
});

/**
 * Update the signed-in user's own profile (PH0-18).
 * Self-scoped by design — no `requirePermission` (docs/permissions.md rule 2
 * exempts own-profile/own-session actions; you can always edit yourself).
 */
export const updateProfile = auditedMutation({
  entity: "users",
  action: "update",
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    const existing = await ctx.db.get(userId);
    const name = args.name.trim();
    if (name.length < 1 || name.length > 100) {
      throw new ConvexError("Name must be between 1 and 100 characters");
    }
    await ctx.db.patch(userId, { name, updatedAt: Date.now() });
    return {
      result: undefined,
      // No-op saves aren't worth an entry (PH0-26).
      audit:
        name === existing?.name
          ? undefined
          : { entityId: userId, before: { name: existing?.name }, after: { name } },
    };
  },
});

/**
 * Admin: all user profiles for the users table (PH0-19), newest first,
 * each with its assigned role keys (PH0-22) for the badge column.
 */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "users", "view");
    const page = await ctx.db.query("users").order("desc").paginate(args.paginationOpts);
    const roleKeysByUser = await roleKeysForUsers(
      ctx,
      page.page.map((user) => user._id),
    );
    return {
      ...page,
      page: page.page.map((user) => ({
        ...user,
        roleKeys: roleKeysByUser.get(user._id as string) ?? [],
      })),
    };
  },
});

/**
 * Grant, change, or clear a user's role (PH0-22).
 * - `users.edit` permission (Admin+), and — per docs/permissions.md rule 4 —
 *   only an Owner may grant or change roles at all.
 * - You can't change your own role (prevents self-lockout).
 * - `roleKey: null` clears the assignment (the user then has no permissions).
 * - Audited as `roleChange` with before/after role keys (PH0-26).
 */
/**
 * Set (or clear) your own profile photo (PH0-27). Self-scoped like
 * `updateProfile` — no permission check beyond being signed in; the file must
 * be yours and saved as kind `avatar`. Pass `null` to clear.
 */
export const setAvatar = auditedMutation({
  entity: "users",
  action: "update",
  args: { fileId: v.nullable(v.id("files")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    if (args.fileId !== null) {
      const file = await ctx.db.get(args.fileId);
      if (file === null) {
        throw new ConvexError("That file no longer exists.");
      }
      if (file.uploadedBy !== userId) {
        throw new ConvexError("That file isn't yours to use as a photo.");
      }
      if (file.kind !== "avatar") {
        throw new ConvexError("That file wasn't uploaded as a profile photo.");
      }
    }
    const existing = await ctx.db.get(userId);
    await ctx.db.patch(userId, {
      avatarFileId: args.fileId ?? undefined,
      updatedAt: Date.now(),
    });
    return {
      result: undefined,
      audit: {
        entityId: userId,
        before: { avatar: existing?.avatarFileId ?? null },
        after: { avatar: args.fileId },
      },
    };
  },
});

export const assignRole = auditedMutation({
  entity: "users",
  action: "roleChange",
  args: { userId: v.id("users"), roleKey: v.nullable(v.string()) },
  handler: async (ctx, args) => {
    const callerId = await requirePermission(ctx, "users", "edit");
    await requireRole(ctx, callerId, "owner");

    if (args.userId === callerId) {
      throw new ConvexError("You can't change your own role.");
    }
    const target = await ctx.db.get(args.userId);
    if (target === null) {
      throw new ConvexError("This user no longer exists.");
    }
    if (args.roleKey !== null && !isRoleKey(args.roleKey)) {
      throw new ConvexError("Unknown role.");
    }

    const before = await effectiveRoleKeys(ctx, args.userId);
    await grantRole(ctx, {
      userId: args.userId,
      roleKey: args.roleKey as RoleKey | null,
      grantedBy: callerId,
    });
    const after = await effectiveRoleKeys(ctx, args.userId);
    return {
      result: undefined,
      audit: { entityId: args.userId, before: { roles: before }, after: { roles: after } },
    };
  },
});
