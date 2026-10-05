"use client";

import { ArrowRight, SearchSm } from "@untitledui/icons";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FC } from "react";
import { Dialog, DialogTrigger, Modal, ModalOverlay } from "@/components/application/modals/modal";
import type {
  NavItemDividerType,
  NavItemType,
} from "@/components/application/app-navigation/config";
import { Skeleton } from "@/components/ui/skeleton";
import { NAV_ITEMS } from "@/components/shared/nav-config";
import { cx } from "@/utils/cx";

/** One selectable search result. */
export interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  icon?: FC<{ className?: string }>;
}

/**
 * A labelled group of results. `hits === undefined` renders skeleton rows —
 * Convex-backed groups (customers, products, documents — added as their
 * phases land) stay `undefined` while their query loads.
 */
export interface SearchGroup {
  id: string;
  label: string;
  hits?: SearchHit[];
}

function navHits(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  const walk = (items: (NavItemType | NavItemDividerType)[], parentTitle?: string) => {
    for (const item of items) {
      if (!item.href || !item.label) continue;
      const title = parentTitle ? `${parentTitle} / ${item.label}` : item.label;
      if (!q || title.toLowerCase().includes(q) || item.href.toLowerCase().includes(q)) {
        hits.push({
          id: item.href,
          title,
          subtitle: item.href,
          href: item.href,
          icon: "icon" in item ? item.icon : undefined,
        });
      }
      if (item.items) walk(item.items, item.label);
    }
  };
  walk(NAV_ITEMS);
  return hits;
}

/**
 * Result groups for the palette. Phase 0 searches navigation; each later
 * phase appends its group here (Convex `search(q)` queries, 10-hit limit,
 * empty array for short queries) — see docs/development-plan.md PH0-14.
 */
function useSearchGroups(query: string): SearchGroup[] {
  return [{ id: "navigation", label: "Navigation", hits: navHits(query) }];
}

/**
 * Global search palette (PH0-14). Opens via the topbar trigger or ⌘K / Ctrl+K,
 * navigates with ↑ ↓ Enter, closes with Esc.
 */
export function CommandPalette({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const groups = useSearchGroups(query);
  const flat = useMemo(() => groups.flatMap((g) => g.hits ?? []), [groups]);
  const anyLoading = groups.some((g) => g.hits === undefined);
  // Clamp instead of resetting in an effect when the query shortens the list.
  const active = flat.length > 0 ? Math.min(activeIndex, flat.length - 1) : -1;

  const setOpen = (open: boolean) => {
    if (!open) setQuery("");
    onOpenChange(open);
  };

  const go = (hit: SearchHit) => {
    setOpen(false);
    router.push(hit.href);
  };

  // ⌘K / Ctrl+K anywhere on admin pages.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isOpen) setQuery("");
        onOpenChange(!isOpen);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onOpenChange]);

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <ModalOverlay className="items-start [--modal-pt:10vh] sm:items-start">
        <Modal className="sm:max-w-xl">
          <Dialog className="flex max-h-[inherit] flex-col">
            {/* Query input */}
            <div className="border-secondary flex items-center gap-3 border-b px-4">
              <SearchSm className="text-tertiary size-5 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((i) =>
                      flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length,
                    );
                  } else if (e.key === "Enter") {
                    if (flat[active]) go(flat[active]);
                  }
                }}
                placeholder="Search pages, customers, documents…"
                aria-label="Search"
                className="text-primary placeholder:text-tertiary text-md h-12 w-full min-w-0 flex-1 bg-transparent outline-hidden"
              />
              <kbd className="ring-secondary text-quaternary rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset">
                Esc
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[50vh] min-h-24 overflow-y-auto p-2">
              {groups.map((group) => (
                <div key={group.id} className="mb-2 last:mb-0">
                  <p className="text-quaternary px-3 pt-2 pb-1.5 text-xs font-medium">
                    {group.label}
                  </p>
                  {group.hits === undefined
                    ? [0, 1, 2].map((i) => (
                        <Skeleton key={i} className="mx-3 my-1 h-10 rounded-lg" />
                      ))
                    : group.hits.map((hit) => {
                        const index = flat.indexOf(hit);
                        const isActive = index === active;
                        return (
                          <button
                            key={hit.id}
                            type="button"
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => go(hit)}
                            className={cx(
                              "outline-focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-2",
                              isActive && "bg-secondary",
                            )}
                          >
                            {hit.icon ? (
                              <hit.icon
                                className={cx(
                                  "size-5 shrink-0",
                                  isActive ? "text-primary" : "text-secondary",
                                )}
                              />
                            ) : null}
                            <span className="min-w-0 flex-1">
                              <span className="text-primary block truncate text-sm font-medium">
                                {hit.title}
                              </span>
                              {hit.subtitle ? (
                                <span className="text-tertiary block truncate text-xs">
                                  {hit.subtitle}
                                </span>
                              ) : null}
                            </span>
                            <ArrowRight
                              className={cx(
                                "size-4 shrink-0",
                                isActive ? "text-secondary" : "text-quaternary opacity-0",
                              )}
                            />
                          </button>
                        );
                      })}
                </div>
              ))}

              {flat.length === 0 && !anyLoading ? (
                <div className="px-3 py-8 text-center">
                  <p className="text-secondary text-sm">No results for “{query}”</p>
                  <p className="text-quaternary mt-1 text-xs">
                    Try a module name — more sources arrive with later phases.
                  </p>
                </div>
              ) : null}
            </div>

            {/* Keyboard hints */}
            <div className="border-secondary text-quaternary flex items-center justify-between border-t px-4 py-2.5 text-xs">
              <span>↑↓ to navigate · ↵ to open</span>
              <span className="flex items-center gap-1.5">
                <kbd className="ring-secondary rounded px-1.5 py-0.5 font-medium ring-1 ring-inset">
                  ⌘K
                </kbd>
                to toggle
              </span>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
