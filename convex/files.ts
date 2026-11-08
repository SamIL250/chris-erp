import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  CLOUDINARY_NOT_CONFIGURED,
  cloudinaryUploadUrl,
  isOurCloudinaryUrl,
  parseCloudinaryUrl,
  signParams,
} from "../lib/cloudinary";
import { auditedMutation } from "./_lib/audit";
import { resolveFileUrl } from "./_lib/fileUrl";
import { requirePermission } from "./_lib/permissions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, query } from "./_generated/server";

/**
 * File storage (PH0-27 → PH1-13): the `files` registry holds metadata +
 * ownership; the BYTES live in Cloudinary (signed direct upload) with
 * legacy Convex-storage rows still resolving. The current flow —
 *
 *   1. `generateCloudinarySignature` (action) → signature + upload endpoint
 *      (any signed-in user; needs `CLOUDINARY_URL` on the deployment)
 *   2. the browser POSTs the file straight to Cloudinary → `{ secure_url, public_id }`
 *   3. `saveCloudinary` → registry row + permanent URL
 *
 * Permission note: saving/removing a file is self-scoped (you must be the
 * uploader); the mutation that ATTACHES a file to a domain document enforces
 * that document's permission (e.g. a product image needs `catalog.edit`).
 * Removal deletes the ROW first, then schedules best-effort Cloudinary
 * cleanup — mutations can't fetch, the internal action can, and it no-ops
 * without the env so tests never touch the network.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024; // server ceiling; UI limits are smaller
const UPLOAD_FOLDER = "chris-erp";

/** Step 1: sign + endpoint the browser needs to upload directly. */
export const generateCloudinarySignature = action({
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) {
      throw new ConvexError("Not authenticated");
    }
    const config = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
    if (config === null) throw new ConvexError(CLOUDINARY_NOT_CONFIGURED);
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder: UPLOAD_FOLDER, timestamp };
    return {
      cloudName: config.cloudName,
      apiKey: config.apiKey,
      uploadUrl: cloudinaryUploadUrl(config.cloudName),
      folder: UPLOAD_FOLDER,
      timestamp,
      signature: await signParams(params, config.apiSecret),
    };
  },
});

/** Step 3: register a Cloudinary upload and return its permanent URL. */
export const saveCloudinary = auditedMutation({
  entity: "files",
  action: "create",
  args: {
    url: v.string(),
    publicId: v.string(),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    kind: v.string(),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Not authenticated");
    const config = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
    if (config === null) throw new ConvexError(CLOUDINARY_NOT_CONFIGURED);
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
    const publicId = args.publicId.trim();
    if (publicId.length < 1 || publicId.length > 255) {
      throw new ConvexError("The upload came back without an asset id — try again.");
    }
    // The registration must point at OUR cloud — otherwise an authenticated
    // caller could attach arbitrary remote URLs as if they were uploads.
    if (!isOurCloudinaryUrl(args.url, config.cloudName)) {
      throw new ConvexError("That image didn't upload to this app's storage.");
    }

    const fileId = await ctx.db.insert("files", {
      cloudinaryPublicId: publicId,
      url: args.url,
      name,
      mimeType: args.mimeType,
      size: args.size,
      kind: args.kind,
      entityId: args.entityId,
      uploadedBy: userId,
      createdAt: Date.now(),
    });
    return {
      result: { fileId, url: args.url },
      audit: { entityId: fileId, after: { name, kind: args.kind, size: args.size } },
    };
  },
});

/**
 * Delivery URL for a file. Authenticated callers only; the public
 * storefront gets its own query in Phase 4.
 */
export const getUrl = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    if ((await getAuthUserId(ctx)) === null) {
      throw new ConvexError("Not authenticated");
    }
    const file = await ctx.db.get(args.fileId);
    if (file === null) return null;
    return await resolveFileUrl(ctx, file);
  },
});

/** Batch delivery URLs for the editor's previews — order preserved. */
export const urls = query({
  args: { fileIds: v.array(v.id("files")) },
  handler: async (ctx, args) => {
    if ((await getAuthUserId(ctx)) === null) {
      throw new ConvexError("Not authenticated");
    }
    const out: { fileId: Id<"files">; url: string | null }[] = [];
    for (const fileId of args.fileIds) {
      const file = await ctx.db.get(fileId);
      out.push({ fileId, url: file === null ? null : await resolveFileUrl(ctx, file) });
    }
    return out;
  },
});

/** Delete a file (row + bytes). Uploader, or `settings.edit`. */
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
    if (file.cloudinaryPublicId !== undefined) {
      // Row first, then best-effort asset cleanup (see module note).
      await ctx.scheduler.runAfter(0, internal.files.deleteCloudinaryAsset, {
        publicId: file.cloudinaryPublicId,
      });
    } else if (file.storageId !== undefined) {
      await ctx.storage.delete(file.storageId);
    }
    await ctx.db.delete(file._id);
    return {
      result: undefined,
      audit: { entityId: file._id, before: { name: file.name, kind: file.kind } },
    };
  },
});

/**
 * Best-effort Cloudinary asset delete, scheduled by `remove` AFTER the row
 * is gone.404 = already deleted is success; anything else just logs (an
 * orphaned asset never breaks the app). No env (tests) = no network call.
 */
export const deleteCloudinaryAsset = internalAction({
  args: { publicId: v.string() },
  handler: async (_ctx, args) => {
    const config = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
    if (config === null) return;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signParams({ public_id: args.publicId, timestamp }, config.apiSecret);
    const url =
      `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/upload` +
      `?public_id=${encodeURIComponent(args.publicId)}&timestamp=${timestamp}` +
      `&api_key=${config.apiKey}&signature=${signature}`;
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        console.log(`Cloudinary cleanup failed (${res.status}) for ${args.publicId}`);
      }
    } catch {
      console.log(`Cloudinary cleanup unreachable for ${args.publicId}`);
    }
  },
});
