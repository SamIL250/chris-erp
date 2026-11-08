/**
 * Cloudinary helpers (PH1-13) — file storage moved from Convex storage to
 * Cloudinary with SIGNED DIRECT UPLOADS:
 *
 *   1. the browser asks Convex for a signature (`files:generateCloudinarySignature`)
 *   2. it POSTs the bytes straight to Cloudinary (no proxy through our servers)
 *   3. it registers the returned URL + public id (`files:saveCloudinary`)
 *
 * The API secret never leaves the server — only signatures travel. Web
 * Crypto only (no `node:crypto`), so the SAME code runs in Convex actions,
 * browser bundles, and tests.
 *
 * Signing follows Cloudinary's rule: the upload params (minus `file`,
 * `api_key`, `signature`) sorted alphabetically as `k=v`, joined with "&",
 * secret appended, SHA-1 → hex.
 */

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Verbatim error when the deployment has no `CLOUDINARY_URL`. */
export const CLOUDINARY_NOT_CONFIGURED = "Image storage is not configured.";

/** Parse `cloudinary://api_key:api_secret@cloud_name` — null when unusable. */
export function parseCloudinaryUrl(raw: string | undefined): CloudinaryConfig | null {
  if (raw === undefined || raw.trim() === "") return null;
  const match = raw.trim().match(/^cloudinary:\/\/([^:/@]+):([^@]+)@([^/@]+)$/);
  if (match === null) return null;
  const [, apiKey, apiSecret, cloudName] = match;
  if (apiKey === undefined || apiSecret === undefined || cloudName === undefined) return null;
  return { cloudName, apiKey, apiSecret };
}

/** SHA-1 hex over Cloudinary's sorted param string + the API secret. */
export async function signParams(
  params: Record<string, string | number>,
  apiSecret: string,
): Promise<string> {
  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join("&");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(query + apiSecret));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Browser upload endpoint for a cloud. */
export function cloudinaryUploadUrl(cloudName: string): string {
  return `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
}

/** Permanent delivery URL for an asset (Cloudinary URLs don't expire). */
export function cloudinaryDeliveryUrl(cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;
}

/**
 * Registration guard: a `saveCloudinary` URL must belong to OUR cloud —
 * otherwise an authenticated caller could attach arbitrary remote URLs as
 * if they were uploaded assets.
 */
export function isOurCloudinaryUrl(url: string, cloudName: string): boolean {
  return url.startsWith(`https://res.cloudinary.com/${cloudName}/`);
}
