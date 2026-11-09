"use client";

import { useQuery } from "convex/react";
import { Badge } from "@/components/base/badges/badges";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useProductCovers } from "@/hooks/use-product-covers";
import type { Id } from "@/convex/_generated/dataModel";

/** Products that name this vendor (PH2-04). Editing the link is on the product. */
export function VendorProducts({ vendorId }: { vendorId: Id<"vendors"> }) {
  const links = useQuery(api.catalog.productVendors.listForVendor, { vendorId });
  const covers = useProductCovers((links ?? []).map((row) => row.productId));
  if (links === undefined) return <Skeleton className="h-24" />;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-primary text-md font-semibold">Products</h2>
        <p className="text-tertiary text-sm">
          Linked from the product. A receipt updates the last purchase price.
        </p>
      </div>
      {links.length === 0 ? (
        <p className="text-tertiary text-sm">No products name this vendor yet.</p>
      ) : (
        <ul className="divide-secondary divide-y">
          {links.map((row) => (
            <li key={row._id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <a className="hover:underline" href={`/catalog/products/${row.productId}`}>
                  <ProductIdentity
                    name={row.productName ?? row.productSku ?? "Product"}
                    meta={row.productSku ?? undefined}
                    src={covers.get(row.productId) ?? null}
                  />
                </a>
                <p className="text-tertiary mt-1 text-sm">
                  Vendor SKU {row.vendorSku ?? "—"} · Last purchase{" "}
                  {row.lastPurchasePrice === null
                    ? "—"
                    : row.lastPurchasePrice.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </p>
              </div>
              {row.preferred ? (
                <Badge color="success" size="sm">
                  Preferred
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
