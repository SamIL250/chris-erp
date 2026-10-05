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

/**
 * Admin navigation (PH0-12). Each module is a top-level link for now — child
 * pages (e.g. Catalog → Products) are added as their phases land.
 * Shared by the admin shell sidebar and the ⌘K search palette (PH0-14).
 */
export const NAV_ITEMS: (NavItemType | NavItemDividerType)[] = [
  { label: "Dashboard", href: "/dashboard", icon: Home01 },
  { divider: true },
  { label: "Catalog", href: "/catalog", icon: Package },
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
    items: [{ label: "Profile", href: "/settings/profile" }],
  },
];

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
