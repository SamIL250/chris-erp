"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { Button } from "@/components/base/buttons/button";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { usePageLabel } from "@/components/shared/page-label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProductCovers } from "@/hooks/use-product-covers";
import { formatQty, formatValue, formatWhen } from "@/lib/inventory-display";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-tertiary text-sm">{label}</dt>
      <dd className="text-primary text-sm font-medium">{children}</dd>
    </div>
  );
}

/** One debit note. The goods have already left stock (PH2-24). */
export function PurchaseReturnDetail({
  purchaseReturnId,
}: {
  purchaseReturnId: Id<"purchaseReturns">;
}) {
  const detail = useQuery(api.procurement.purchaseReturns.get, { purchaseReturnId });
  const warehouses = useQuery(api.inventory.warehouses.list);
  usePageLabel(detail?.docNumber);
  const covers = useProductCovers(detail?.lines.map((line) => line.productId) ?? []);

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Vendor return" description="That return doesn't exist." />;
  }

  const warehouse = warehouses?.find((row) => row._id === detail.warehouseId);

  return (
    <div className="space-y-8">
      <PageHeader
        title={detail.docNumber}
        description="Debit note. The goods left stock at the receipt's unit cost. Recording the vendor's credit is Phase 3."
      />
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Vendor">{detail.vendorName ?? "—"}</Fact>
        <Fact label="Receipt">
          {detail.receiptNumber !== null ? (
            <Button color="link-color" href={`/inventory/receipts/${detail.goodsReceiptId}`}>
              {detail.receiptNumber}
            </Button>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label="Warehouse">{warehouse ? `${warehouse.code} · ${warehouse.name}` : "—"}</Fact>
        <Fact label="Returned">{formatWhen(detail.createdAt)}</Fact>
        <Fact label="Reason">{detail.reason}</Fact>
        <Fact label="Amount">{formatValue(detail.amount ?? undefined)}</Fact>
      </dl>
      <ul className="divide-secondary divide-y">
        {detail.lines.map((line) => (
          <li key={line.lineId} className="flex items-center justify-between gap-4 py-4">
            <ProductIdentity
              name={line.description}
              meta={line.sku}
              src={covers.get(line.productId) ?? null}
            />
            <p className="text-secondary text-sm tabular-nums">
              {formatQty(line.qty)} × {formatValue(line.unitCost ?? undefined)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
