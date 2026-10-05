import { useQuery } from "convex/react";
import { useMemo } from "react";
import type {
  NavItemDividerType,
  NavItemType,
} from "@/components/application/app-navigation/config";
import { filterNavByPermission, NAV_ITEMS } from "@/components/shared/nav-config";
import { api } from "@/convex/_generated/api";
import { hasPermission, type Action, type Module } from "@/lib/permissions";

/**
 * Permission hooks (PH0-23) — the UI mirror of the server checks in
 * `convex/_lib/permissions.ts`. All read `users:me` (one shared subscription;
 * the admin shell already loads it), so `hasPermission` answers client-side
 * with no extra round-trip. Server queries/mutations stay the enforcement
 * point — these only hide what would be refused (fail closed: while `me` is
 * still loading, nothing permission-gated renders).
 */

function useRoleKeys(): string[] | null {
  const me = useQuery(api.users.me);
  if (me === undefined || me === null) return null;
  return me.roles.map((role) => role.key);
}

/** Can the signed-in user perform `module.action`? */
export function useCan(module: Module, action: Action): boolean {
  const roleKeys = useRoleKeys();
  return roleKeys !== null && hasPermission(roleKeys, module, action);
}

/** Is the signed-in user an Owner? (rule 4: role grants are owner-only) */
export function useIsOwner(): boolean {
  const roleKeys = useRoleKeys();
  return roleKeys !== null && roleKeys.includes("owner");
}

/** Nav items visible to the signed-in user (empty until `me` resolves). */
export function useNavItems(): (NavItemType | NavItemDividerType)[] {
  const roleKeys = useRoleKeys();
  return useMemo(() => {
    if (roleKeys === null) return []; // fail closed while loading
    return filterNavByPermission(NAV_ITEMS, (module) => hasPermission(roleKeys, module, "view"));
  }, [roleKeys]);
}
