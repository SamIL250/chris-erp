"use client";

import { useQuery } from "convex/react";
import { Badge } from "@/components/base/badges/badges";
import { PriceListForm } from "@/components/sales/price-list-form";
import { StoredPriceTable } from "@/components/sales/stored-price-table";
import { usePageLabel } from "@/components/shared/page-label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";

/** One price list, its product prices, and the breaks on those prices (PH2-09). */
export function PriceListDetail({ listId }: { listId: string }) {
  const canCreate = useCan("sales", "create");
  const detail = useQuery(api.sales.prices.getList, { listId: listId as Id<"priceLists"> });
  const choices = useQuery(api.sales.prices.currencyChoices, {});
  usePageLabel(detail?.list.name);

  if (detail === undefined || choices === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Price list not found" description="That list is not on file." />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={detail.list.name}
        description={`${detail.list.currency} · ${detail.prices.length} price${detail.prices.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2">
            {detail.list.isBase ? (
              <Badge color="brand" size="md">
                Base
              </Badge>
            ) : null}
            <Badge color={detail.list.active ? "success" : "gray"} size="md">
              {detail.list.active ? "Active" : "Inactive"}
            </Badge>
          </div>
        }
      />
      <section className="bg-primary ring-primary rounded-xl ring-1">
        <PriceListForm
          key={`${detail.list.updatedAt}-${detail.list.name}-${detail.list.active}-${detail.list.isBase}`}
          list={{ ...detail.list, priceCount: detail.prices.length }}
          currencies={choices.currencies}
          canSave={canCreate}
          onSaved={() => undefined}
        />
      </section>
      <StoredPriceTable
        title="Prices"
        description="A customer price beats a group price, and a group price beats this list. A quantity break replaces the unit once the quantity is reached."
        prices={detail.prices}
        scope={{ kind: "list", listId: detail.list._id, currency: detail.list.currency }}
        currencies={choices.currencies}
        defaultCurrency={detail.list.currency}
        acceptsNew={canCreate && detail.list.active}
        canRemove={canCreate}
        blockedReason={
          canCreate && !detail.list.active ? "This list is inactive. New prices are refused." : null
        }
      />
    </div>
  );
}
