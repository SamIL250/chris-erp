import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import { requirePermission } from "./_lib/permissions";
import { mutation, query } from "./_generated/server";

/**
 * File storage (PH0-27): Convex storage for bytes + the `files` registry
 * for metadata. The client uploads in three steps —
 *
 *   1. `generateUploadUrl` → short-lived POST URL (any signed-in user)
 *   2. `fetch(url, { method: "POST", body: file })` → `{ storageId }`
 *   3. `saveFile` → registry row + signed read URL
 *
 * Signed URLs (`ctx.storage.getUrl`) expire, so callers persist the
 * `fileId`/`storageId`, never the URL — `files:getUrl` and `users:me`
 * re-resolve them on read.
 *
 * Permission note: saving/removing a file is self-scoped (you must be the
 * uploader); the mutation that ATTACHES a file to a domain document enforces
 * that document's permission (e.g. the company logo needs `settings.edit`).
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024; // server ceiling; UI limits are smaller

/** Step 1: a URL the browser can POST the file to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) {
      throw new ConvexError("Not authenticated");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 3: register an uploaded blob and return its id + signed read URL. */
export const saveFile = auditedMutation({
  entity: "files",
  action: "create",
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    kind: v.string(),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Not authenticated");
    }
    const name = args.name.trim();
    if (name.length < 1 || name.length > 255) {
      throw new ConvexError("File name must be between 1 and 255 characters.");
    }
    if (args.size < 1 || args.size > MAX_FILE_BYTES) {
      throw new ConvexError("File must be between 1 byte and 25 MB.");
    }
    if (args.mimeType.trim().length < 1) {
      throw new ConvexError("File type is missing.");
    }
    // A storage id that was never uploaded (or was deleted) resolves to null.
    const url = await ctx.storage.getUrl(args.storageId);
    if (url === null) {
      throw new ConvexError("That upload is no longer available — try again.");
    }

    const fileId = await ctx.db.insert("files", {
      storageId: args.storageId,
      name,
      mimeType: args.mimeType,
      size: args.size,
      kind: args.kind,
      entityId: args.entityId,
      uploadedBy: userId,
      createdAt: Date.now(),
    });
    return {
      result: { fileId, url },
      audit: { entityId: fileId, after: { name, kind: args.kind, size: args.size } },
    };
  },
});

/**
 * Signed read URL for a file (expires — re-query as needed). Authenticated
 * callers only; public storefront images get their own query in Phase 1.
 */
export const getUrl = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    if ((await getAuthUserId(ctx)) === null) {
      throw new ConvexError("Not authenticated");
    }
    const file = await ctx.db.get(args.fileId);
    if (file === null) return null;
    return await ctx.storage.getUrl(file.storageId);
  },
});

/** Delete a file (bytes + registry row). Uploader, or `settings.edit`. */
export const remove = auditedMutation({
  entity: "files",
  action: "delete",
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Not authenticated");
    }
    const file = await ctx.db.get(args.fileId);
    if (file === null) {
      throw new ConvexError("This file no longer exists.");
    }
    if (file.uploadedBy !== userId) {
      await requirePermission(ctx, "settings", "edit");
    }
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete(file._id);
    return {
      result: undefined,
      audit: { entityId: file._id, before: { name: file.name, kind: file.kind } },
    };
  },
});
