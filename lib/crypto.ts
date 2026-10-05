/**
 * Small Web-Crypto helpers shared by Convex code (invite codes, PH0-19) —
 * available in the Convex runtime, Node, and browsers.
 */

/** SHA-256 hex digest of a string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** URL-safe random hex string (2 characters per byte of entropy). */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
