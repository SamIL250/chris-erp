#!/usr/bin/env node
/**
 * Seed demo data (PH0-34) — idempotent, additive, Owner-only.
 *
 * Signs in as the owner through the app's auth endpoint, then calls the
 * `seed:seed` mutation and prints what it created (including invite links for
 * the per-role demo users, so passwords can be set without Resend).
 *
 * Usage:
 *   OWNER_EMAIL=owner2@example.com OWNER_PASSWORD=... node scripts/seed.mjs
 *
 * Env (all optional):
 *   OWNER_EMAIL / OWNER_PASSWORD  owner account (required)
 *   APP_URL                       default http://localhost:3000
 *   NEXT_PUBLIC_CONVEX_URL        read from .env.local when unset
 */
import { readFileSync } from "node:fs";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

function readEnvFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const envFile = readEnvFile(new URL("../.env.local", import.meta.url));
const CONVEX_URL = (
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  envFile.match(/^NEXT_PUBLIC_CONVEX_URL=(.+)$/m)?.[1] ??
  ""
)
  .trim()
  .replace(/\/$/, "");

const email = process.env.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD;
if (!email || !password || !CONVEX_URL) {
  console.error(
    "Missing credentials: set OWNER_EMAIL and OWNER_PASSWORD " +
      `(and NEXT_PUBLIC_CONVEX_URL, or keep .env.local).`,
  );
  process.exit(1);
}

// 1. Sign in — the same call the login form makes.
const signIn = await fetch(`${APP_URL}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: APP_URL },
  body: JSON.stringify({
    action: "auth:signIn",
    args: { provider: "password", params: { flow: "signIn", email, password } },
  }),
});
if (!signIn.ok) {
  console.error(`Sign-in failed (HTTP ${signIn.status}) — is \`next dev\` running on ${APP_URL}?`);
  process.exit(1);
}
const authCookie = signIn.headers
  .getSetCookie()
  .find((cookie) => cookie.startsWith("__convexAuthJWT="));
if (authCookie === undefined) {
  console.error(
    "Sign-in returned no session — check OWNER_EMAIL/OWNER_PASSWORD " +
      "(the account must exist and be an Owner, e.g. the first signup on a fresh deploy).",
  );
  process.exit(1);
}
const token = authCookie.split(";")[0].split("=").slice(1).join("=");

// 2. Seed.
const response = await fetch(`${CONVEX_URL}/api/mutation`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ path: "seed:seed", args: {} }),
});
const payload = await response.json();
if (payload.status !== "success") {
  console.error(`Seed failed: ${payload.errorMessage ?? "unknown error"}`);
  if (payload.errorData) console.error(`  ${payload.errorData}`);
  process.exit(1);
}

const { created, invites } = payload.value ?? {};
const total = Object.values(created ?? {}).reduce((sum, count) => sum + count, 0);
if (total === 0 && (invites ?? []).length === 0) {
  console.log("Already seeded — nothing to do.");
} else {
  console.log("Seeded:");
  for (const [entity, count] of Object.entries(created ?? {})) {
    console.log(`  ${entity}: ${count}`);
  }
}
if ((invites ?? []).length > 0) {
  console.log("\nInvite links (open to set each demo user's password):");
  for (const invite of invites) console.log(`  ${invite.email}\n    ${invite.url}`);
}
