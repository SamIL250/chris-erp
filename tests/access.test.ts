import { describe, expect, test } from "vitest";
import type {
  NavItemDividerType,
  NavItemType,
} from "../components/application/app-navigation/config";
import { filterNavByPermission, NAV_ITEMS } from "../components/shared/nav-config";
import { requiredModuleForPath } from "../lib/access";

/**
 * Permission-derived navigation + route access (PH0-23) — the pure helpers
 * behind `useCan()`/`PermissionGate`. Deny-by-default: unknown/unmapped
 * entries stay visible (auth-level access is middleware's job), everything
 * mapped to a module is hidden without `view`.
 */

const all = () => true;
const none = () => false;

const labels = (items: (NavItemType | NavItemDividerType)[]) =>
  items.map((item) => (item.divider ? "—" : item.label));

describe("requiredModuleForPath (PH0-23)", () => {
  test("open paths need no permission", () => {
    expect(requiredModuleForPath("/dashboard")).toBeNull();
    expect(requiredModuleForPath("/settings/profile")).toBeNull();
    expect(requiredModuleForPath("/settings/profile/advanced")).toBeNull();
    // Unknown admin paths (the 404 page) aren't permission-blocked.
    expect(requiredModuleForPath("/no-such-route")).toBeNull();
  });

  test("module routes require that module's view permission", () => {
    expect(requiredModuleForPath("/users")).toBe("users");
    expect(requiredModuleForPath("/catalog/products/123")).toBe("catalog");
    expect(requiredModuleForPath("/sales/quotes")).toBe("sales");
    expect(requiredModuleForPath("/finance/journal")).toBe("finance");
    expect(requiredModuleForPath("/settings")).toBe("settings");
    expect(requiredModuleForPath("/settings/currencies")).toBe("settings");
  });
});

describe("filterNavByPermission (PH0-23)", () => {
  test("full access keeps the navigation intact", () => {
    const items = filterNavByPermission(NAV_ITEMS, all);
    expect(items).toHaveLength(NAV_ITEMS.length);
    expect(labels(items)).toEqual(labels(NAV_ITEMS));
  });

  test("no access keeps Dashboard + Profile and cleans up dividers", () => {
    const items = filterNavByPermission(NAV_ITEMS, none);
    expect(labels(items)).toEqual(["Dashboard", "—", "Settings"]);
    const settings = items.find((item) => item.label === "Settings");
    expect(settings?.items?.map((child) => child.href)).toEqual(["/settings/profile"]);
  });

  test("partial access shows only permitted modules", () => {
    const usersOnly = filterNavByPermission(NAV_ITEMS, (module) => module === "users");
    expect(labels(usersOnly)).toEqual(["Dashboard", "—", "Settings"]);
    expect(usersOnly.flatMap((item) => item.items?.map((child) => child.href) ?? [])).toContain(
      "/users",
    );

    // Catalog permitted: separators land around it without doubling up.
    const catalogOnly = filterNavByPermission(NAV_ITEMS, (module) => module === "catalog");
    expect(labels(catalogOnly)).toEqual(["Dashboard", "—", "Catalog", "—", "Settings"]);
  });

  test("groups whose children are all hidden disappear entirely", () => {
    const nav: (NavItemType | NavItemDividerType)[] = [
      { label: "Solo", href: "/solo" }, // unmapped → stays (auth-level only)
      { label: "Group", items: [{ label: "Sales", href: "/sales" }] },
    ];
    expect(filterNavByPermission(nav, none).map((item) => item.label)).toEqual(["Solo"]);
  });
});
