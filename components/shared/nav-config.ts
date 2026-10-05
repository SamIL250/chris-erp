import {
  BankNote01,
  Home01,
  LayersThree01,
  Package,
  PresentationChart01,
  Settings01,
  ShoppingCart01,
  Tag01,
  Tool01,
} from "@untitledui/icons";
import type {
  NavItemDividerType,
  NavItemType,
} from "@/components/application/app-navigation/config";
import type { Module } from "@/lib/permissions";

/**
 * Admin navigation (PH0-12). Each module is a top-level link until it has
 * child pages (Catalog grew Categories/Attributes in PH1-04; more to come
 * as their phases land). Shared by the admin shell sidebar and the ⌘K
 * search palette (PH0-14).
 */
export const NAV_ITEMS: (NavItemType | NavItemDividerType)[] = [
  { label: "Dashboard", href: "/dashboard", icon: Home01 },
  { divider: true },
  {
    label: "Catalog",
    icon: Package,
    items: [
      { label: "Categories", href: "/catalog/categories" },
      { label: "Attributes", href: "/catalog/attributes" },
    ],
  },
  { label: "Inventory", href: "/inventory", icon: LayersThree01 },
  { label: "Sales", href: "/sales", icon: Tag01 },
  { label: "Procurement", href: "/procurement", icon: ShoppingCart01 },
  { label: "Finance", href: "/finance", icon: BankNote01 },
  { label: "Service", href: "/service", icon: Tool01 },
  { label: "Reports", href: "/reports", icon: PresentationChart01 },
  { divider: true },
  {
    label: "Settings",
    icon: Settings01,
    items: [
      { label: "Company", href: "/settings/company" },
      { label: "Currencies", href: "/settings/currencies" },
      { label: "Tax", href: "/settings/tax" },
      { label: "Document numbering", href: "/settings/sequences" },
      { label: "Formatting", href: "/settings/formatting" },
      { label: "Users", href: "/users" },
      { label: "Audit log", href: "/settings/audit" },
      { label: "Profile", href: "/settings/profile" },
    ],
  },
];

/**
 * Which module's `view` permission each nav link needs (PH0-23). Links that
 * aren't listed are open to every signed-in user (Dashboard, Profile —
 * self-service). Mirrors `lib/access.ts` for routes.
 */
export const NAV_MODULES: Record<string, Module> = {
  "/catalog": "catalog",
  "/catalog/categories": "catalog",
  "/catalog/attributes": "catalog",
  "/inventory": "inventory",
  "/sales": "sales",
  "/procurement": "procurement",
  "/finance": "finance",
  "/service": "service",
  "/reports": "reports",
  "/users": "users",
  "/settings/audit": "settings",
  "/settings/company": "settings",
  "/settings/currencies": "settings",
  "/settings/tax": "settings",
  "/settings/sequences": "settings",
  "/settings/formatting": "settings",
};

const isDivider = (item: NavItemType | NavItemDividerType): boolean => item.divider === true;

/**
 * Hide nav links whose module the viewer can't `view` (PH0-23, fail-closed:
 * pass `() => false` while permissions load). Group entries (Settings) keep
 * whichever children are allowed; empty groups and stray/leading/trailing
 * dividers are dropped so the rail never renders a lopsided separator.
 */
export function filterNavByPermission(
  items: (NavItemType | NavItemDividerType)[],
  canView: (module: Module) => boolean,
): (NavItemType | NavItemDividerType)[] {
  const visible: (NavItemType | NavItemDividerType)[] = [];
  for (const item of items) {
    if (isDivider(item)) {
      visible.push(item);
      continue;
    }
    const navModule = item.href !== undefined ? NAV_MODULES[item.href] : undefined;
    if (navModule !== undefined && !canView(navModule)) continue;
    if (item.items !== undefined) {
      const children = item.items.filter((child) => {
        const childModule = NAV_MODULES[child.href];
        return childModule === undefined || canView(childModule);
      });
      if (children.length === 0) continue;
      visible.push({ ...item, items: children });
      continue;
    }
    visible.push(item);
  }
  return visible.filter((item, index) => {
    if (!isDivider(item)) return true;
    const before = visible[index - 1];
    const after = visible.slice(index + 1).find((next) => !isDivider(next));
    return before !== undefined && !isDivider(before) && after !== undefined;
  });
}

/**
 * Best (longest) matching nav href for the current path, so detail pages
 * still highlight their module.
 */
export function findActiveUrl(pathname: string): string | undefined {
  let best: string | undefined;
  const walk = (items: (NavItemType | NavItemDividerType)[]) => {
    for (const item of items) {
      if (item.href && (pathname === item.href || pathname.startsWith(`${item.href}/`))) {
        if (!best || item.href.length > best.length) best = item.href;
      }
      if (item.items) walk(item.items);
    }
  };
  walk(NAV_ITEMS);
  return best;
}
