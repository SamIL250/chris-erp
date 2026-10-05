"use client";

import { useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import AdminLoading from "@/app/(admin)/loading";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import { requiredModuleForPath } from "@/lib/access";
import { hasPermission } from "@/lib/permissions";

/**
 * Permission-derived route access (PH0-23; PH0-13 covers auth-level only).
 *
 * Withholds page children until `users:me` resolves (the standard admin
 * skeleton meanwhile), then:
 * - open path (`/dashboard`, `/settings/profile`, …) → render;
 * - missing `view` permission → toast + replace with `/dashboard`.
 * Children only mount once allowed, so the protected page's queries never
 * fire and no unauthorized content flashes.
 *
 * Server-side, every query/mutation enforces `requirePermission` anyway —
 * this is navigation UX, not the security boundary.
 */
export function PermissionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useQuery(api.users.me);
  const toastedRef = useRef<string | null>(null);

  const required = requiredModuleForPath(pathname ?? "");
  const roleKeys = me === undefined || me === null ? null : me.roles.map((role) => role.key);
  const allowed =
    required === null || (roleKeys !== null && hasPermission(roleKeys, required, "view"));

  useEffect(() => {
    if (me === undefined || me === null || allowed) return;
    if (toastedRef.current !== pathname) {
      toastedRef.current = pathname;
      toast.error("You don't have permission to view that page.");
    }
    router.replace("/dashboard");
  }, [me, allowed, pathname, router]);

  // Session died on the client (token refresh failed): send them to login the
  // same way the proxy would on the next request.
  useEffect(() => {
    if (me === null) router.replace("/login");
  }, [me, router]);

  if (me === undefined || me === null || !allowed) return <AdminLoading />;
  return <>{children}</>;
}
