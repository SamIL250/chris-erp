"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import {
  Bell01,
  ChevronLeft,
  ChevronRight,
  LogOut01,
  Menu01,
  SearchSm,
  User01,
} from "@untitledui/icons";
import { Button as AriaButton } from "react-aria-components";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { NavList } from "@/components/application/app-navigation/base-components/nav-list";
import { Avatar } from "@/components/base/avatar/avatar";
import { AvatarLabelGroup } from "@/components/base/avatar/avatar-label-group";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { CommandPalette } from "@/components/shared/command-palette";
import { findActiveUrl } from "@/components/shared/nav-config";
import { useNavItems } from "@/hooks/use-can";
import {
  Drawer,
  DrawerBody,
  DrawerDialog,
  DrawerOverlay,
  DrawerPanel,
} from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { cx } from "@/utils/cx";

function BrandMark() {
  return (
    <span className="bg-brand-solid flex size-8 shrink-0 items-center justify-center rounded-lg">
      <span className="text-display-xs font-semibold text-white">C</span>
    </span>
  );
}

/**
 * The admin chrome: collapsible sidebar (icon rail when collapsed), topbar
 * with search trigger / notifications / account menu, and a slide-over
 * navigation drawer below the `lg` breakpoint.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const me = useQuery(api.users.me);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const activeUrl = findActiveUrl(pathname ?? "");
  const navItems = useNavItems();

  const handleSignOut = () => {
    void (async () => {
      await signOut();
      router.push("/login");
      router.refresh();
    })();
  };

  const navList = (
    <NavList
      items={navItems}
      activeUrl={activeUrl}
      className={cx("flex-1 overflow-y-auto", collapsed && "pt-4 [&_span]:hidden")}
    />
  );

  const accountArea = (
    <div className="border-secondary border-t p-4">
      {me === undefined ? (
        <Skeleton className="h-12 w-full" />
      ) : me ? (
        <AvatarLabelGroup
          size="sm"
          src={me.image ?? undefined}
          title={me.name ?? me.email ?? "User"}
          subtitle={me.email ?? ""}
          initials={(me.name ?? me.email ?? "?").slice(0, 1).toUpperCase()}
        />
      ) : null}
    </div>
  );

  return (
    <div className="bg-secondary flex min-h-full flex-1">
      {/* Desktop sidebar */}
      <aside
        className={cx(
          "border-secondary bg-primary z-30 hidden shrink-0 flex-col border-r transition-[width] duration-150 lg:flex",
          collapsed ? "w-[72px]" : "w-60",
        )}
      >
        <div
          className={cx(
            "border-secondary flex h-16 shrink-0 items-center gap-2 border-b px-4",
            collapsed && "justify-center px-0",
          )}
        >
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2"
            aria-label="Chris ERP — storefront"
          >
            <BrandMark />
            {!collapsed && (
              <span className="text-primary text-md truncate font-semibold">Chris ERP</span>
            )}
          </Link>
          {!collapsed && (
            <Button
              color="tertiary"
              size="sm"
              noTextPadding
              iconLeading={ChevronLeft}
              aria-label="Collapse sidebar"
              className="ml-auto shrink-0"
              onPress={() => setCollapsed(true)}
            />
          )}
        </div>

        {navList}

        {!collapsed && accountArea}

        {collapsed && (
          <div className="border-secondary border-t p-2">
            <Button
              color="tertiary"
              size="sm"
              noTextPadding
              iconLeading={ChevronRight}
              aria-label="Expand sidebar"
              className="w-full justify-center"
              onPress={() => setCollapsed(false)}
            />
          </div>
        )}
      </aside>

      {/* Main column */}
      <div className="bg-secondary flex min-w-0 flex-1 flex-col">
        <header className="border-secondary bg-primary sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b px-4 sm:gap-3 sm:px-6">
          <AriaButton
            aria-label="Open navigation"
            className="text-secondary hover:bg-secondary_hover outline-focus-ring rounded-lg p-2 focus-visible:outline-2 lg:hidden"
            onPress={() => setMobileNavOpen(true)}
          >
            <Menu01 className="size-5" />
          </AriaButton>

          <Link
            href="/"
            className="flex items-center gap-2 lg:hidden"
            aria-label="Chris ERP — storefront"
          >
            <BrandMark />
          </Link>

          {/* Global search trigger → ⌘K palette (PH0-14) */}
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="border-secondary bg-primary text-tertiary hover:border-border-hover outline-focus-ring hidden h-10 w-64 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm shadow-xs focus-visible:outline-2 md:flex"
          >
            <SearchSm className="size-4 shrink-0" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="ring-secondary text-tertiary rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Dropdown.Root>
              <AriaButton
                aria-label="Notifications"
                className="text-secondary hover:bg-secondary_hover outline-focus-ring rounded-lg p-2 focus-visible:outline-2"
              >
                <Bell01 className="size-5" />
              </AriaButton>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu aria-label="Notifications">
                  <Dropdown.Item
                    label="No notifications yet"
                    isDisabled
                    selectionIndicator="none"
                  />
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.Root>

            <Dropdown.Root>
              <AriaButton
                aria-label="Account menu"
                className="outline-focus-ring rounded-full p-0.5 focus-visible:outline-2"
              >
                <Avatar
                  size="sm"
                  src={me?.image ?? undefined}
                  initials={(me?.name ?? me?.email ?? "?").slice(0, 1).toUpperCase()}
                  alt={me?.name ?? "Account"}
                />
              </AriaButton>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu aria-label="Account">
                  <Dropdown.Item
                    label="Profile"
                    icon={User01}
                    selectionIndicator="none"
                    href="/settings/profile"
                  />
                  <Dropdown.Separator />
                  <Dropdown.Item
                    label="Sign out"
                    icon={LogOut01}
                    selectionIndicator="none"
                    onAction={handleSignOut}
                  />
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.Root>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>

      {/* Global search palette (⌘K) */}
      <CommandPalette isOpen={searchOpen} onOpenChange={setSearchOpen} />

      {/* Mobile navigation drawer */}
      <Drawer isOpen={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DrawerOverlay className="justify-start">
          <DrawerPanel className="w-72 max-w-[85vw]">
            <DrawerDialog title="Navigation">
              <DrawerBody
                className="flex flex-col gap-4 px-0 py-0"
                // Any click inside (including links) closes the drawer.
                onClick={() => setMobileNavOpen(false)}
              >
                <NavList items={navItems} activeUrl={activeUrl} />
                <div className="border-secondary border-t px-4 pt-4 pb-6">
                  {me ? (
                    <div className="mb-3">
                      <AvatarLabelGroup
                        size="sm"
                        src={me.image ?? undefined}
                        title={me.name ?? me.email ?? "User"}
                        subtitle={me.email ?? ""}
                        initials={(me.name ?? me.email ?? "?").slice(0, 1).toUpperCase()}
                      />
                    </div>
                  ) : null}
                  <Button
                    color="secondary"
                    size="sm"
                    iconLeading={LogOut01}
                    className="w-full"
                    onPress={handleSignOut}
                  >
                    Sign out
                  </Button>
                </div>
              </DrawerBody>
            </DrawerDialog>
          </DrawerPanel>
        </DrawerOverlay>
      </Drawer>
    </div>
  );
}
