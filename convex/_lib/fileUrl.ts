import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Resolve a `files` row's delivery URL (PH1-13): Cloudinary rows carry a
 * permanent URL (they don't expire); legacy Convex-storage rows re-mint
 * their signed URL on read — which is why callers persist the `fileId`,
 * never a URL.
 */
export async function resolveFileUrl(
  ctx: QueryCtx | MutationCtx,
  file: Doc<"files">,
): Promise<string | null> {
  if (file.url !== undefined) return file.url;
  if (file.storageId !== undefined) return await ctx.storage.getUrl(file.storageId);
  return null;
}
