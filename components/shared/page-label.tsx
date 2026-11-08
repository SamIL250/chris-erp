"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { crumbsForPath } from "@/lib/breadcrumbs";

const PageLabelContext = createContext<{
  label: string | undefined;
  setLabel: (label: string | undefined) => void;
} | null>(null);

/** Lets a page fill the dynamic crumb (the product name) without owning the trail. */
export function PageLabelProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | undefined>();
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <PageLabelContext.Provider value={value}>{children}</PageLabelContext.Provider>;
}

export function usePageLabel(label: string | undefined) {
  const setLabel = useContext(PageLabelContext)?.setLabel;
  useEffect(() => {
    if (!setLabel) return;
    setLabel(label);
    return () => setLabel(undefined);
  }, [setLabel, label]);
}

/** Route trail rendered above every nested admin page. */
export function PageCrumb() {
  const pathname = usePathname() ?? "";
  const label = useContext(PageLabelContext)?.label;
  const items = crumbsForPath(pathname, label);
  if (items.length < 2) return null;
  return <Breadcrumb items={items} className="mb-4" />;
}
