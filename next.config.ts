import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security headers (PH0-20) — applied to every response.
 *
 * CSP tradeoffs, chosen deliberately without a browser to verify against:
 * - `script-src` keeps `'unsafe-inline'` because Next.js injects its inline
 *   bootstrap scripts. This still restricts scripts to our own origin (an
 *   injected `<script src="https://evil…">` won't run); the planned upgrade
 *   is a per-request nonce threaded through the proxy.
 * - Dev adds `'unsafe-eval'` + explicit localhost websockets so HMR and
 *   tooling keep working.
 * - `img-src` allows `https:` for OAuth avatars (and later, pasted image
 *   URLs); Convex storage lives under `*.convex.cloud`.
 * - Google OAuth uses a full-page redirect, so `frame-src`/`frame-ancestors`
 *   can stay `'none'`.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.convex.cloud wss://*.convex.cloud${
    isDev ? " ws://localhost:3000 ws://127.0.0.1:3000" : ""
  }`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `payment` is deliberately NOT disabled — Stripe may need it later.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()",
  },
  // Browsers ignore HSTS on http://localhost, so this is safe everywhere.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
