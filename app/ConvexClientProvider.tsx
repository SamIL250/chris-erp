"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Connects the Convex client to Convex Auth so queries/mutations carry the
 * auth token. Auth state itself (SSR token, /api/auth fetch client) comes
 * from `ConvexAuthNextjsServerProvider` in the root layout — BOTH providers
 * are required for the proxy middleware to see the token.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
