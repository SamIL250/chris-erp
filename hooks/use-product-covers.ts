"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** Cover URL by product id. Missing products and products with no image map to null. */
export function useProductCovers(productIds: readonly string[]): Map<string, string | null> {
  const key = [...new Set(productIds.filter((id) => id !== ""))].sort().join("\n");
  const ids = useMemo(() => (key === "" ? [] : (key.split("\n") as Id<"products">[])), [key]);
  const rows = useQuery(
    api.catalog.products.covers,
    ids.length === 0 ? "skip" : { productIds: ids },
  );
  return useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of rows ?? []) map.set(row.productId, row.url);
    return map;
  }, [rows]);
}
