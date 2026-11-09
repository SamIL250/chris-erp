"use client";

import { useQuery } from "convex/react";
import { Button } from "@/components/base/buttons/button";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { PurchaseReturnPanel } from "@/components/procurement/purchase-return-panel";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageLabel } from "@/components/shared/page-label";
import { useProductCovers } from "@/hooks/use-product-covers";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { formatQty, formatValue, formatWhen } from "@/lib/inventory-display";

/** Read-only receipt. A correction is an adjustment, not an edit. */
export function ReceiptDetail({ id }: { id: string }) {
  const receipt = useQuery(api.inventory.goodsReceipts.get, {
    receiptId: id as Id<"goodsReceipts">,
  });
  const warehouses = useQuery(api.inventory.warehouses.list);
  const products = useQuery(api.catalog.products.picker, { search: "" });
  const covers = useProductCovers((receipt?.lines ?? []).map((line) => line.productId));
  const canReadProcurement = useCan("procurement", "view");
  usePageLabel(receipt?.number);

  if (receipt === undefined) return <Skeleton className="h-96" />;

  const lineRows = receipt.lines.map((row) => {
    const product = products?.find((item) => item._id === row.productId);
    return {
      ...row,
      coverSrc: covers.get(row.productId) ?? product?.coverUrl ?? null,
      productName: product?.name ?? "Product",
      productSku: product?.sku ?? row.productId,
    };
  });

  const warehouse = warehouses?.find((row) => row._id === receipt.warehouseId);
  const againstOrder = receipt.purchaseOrderId !== null;
  const columns: DataTableColumn<(typeof lineRows)[number]>[] = [
    {
      id: "product",
      header: "Product",
      cell: (row) => (
        <ProductIdentity name={row.productName} meta={row.productSku} src={row.coverSrc} />
      ),
    },
    ...(againstOrder
      ? [
          {
            id: "accepted",
            header: "Accepted",
            cell: (row: (typeof lineRows)[number]) => (
              <span className="text-sm tabular-nums">{formatQty(row.qtyAccepted ?? row.qty)}</span>
            ),
          },
          {
            id: "rejected",
            header: "Rejected",
            cell: (row: (typeof lineRows)[number]) => (
              <span className="text-sm tabular-nums">{formatQty(row.qtyRejected ?? 0)}</span>
            ),
          },
        ]
      : [
          {
            id: "qty",
            header: "Quantity",
            cell: (row: (typeof lineRows)[number]) => (
              <span className="text-sm tabular-nums">{formatQty(row.qty)}</span>
            ),
          },
        ]),
    {
      id: "cost",
      header: "Unit cost",
      cell: (row) => (
        <span className="text-sm tabular-nums">{formatValue(row.unitCost ?? undefined)}</span>
      ),
    },
    ...(againstOrder
      ? [
          {
            id: "average",
            header: "Average cost",
            cell: (row: (typeof lineRows)[number]) => (
              <span className="text-sm tabular-nums">
                {formatValue(row.averageCost ?? undefined)}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={receipt.number}
        description={`${warehouse ? `${warehouse.code} · ${warehouse.name}` : "Warehouse"}${receipt.vendor ? ` · ${receipt.vendor.code} · ${receipt.vendor.name}` : ""} · ${receipt.referenceNote} · ${formatWhen(receipt.createdAt)}`}
      />
      {receipt.purchaseOrderId !== null && receipt.purchaseOrderNumber !== null ? (
        <Button color="link-color" href={`/procurement/purchase-orders/${receipt.purchaseOrderId}`}>
          {receipt.purchaseOrderNumber}
        </Button>
      ) : null}
      <DataTable title="Lines" columns={columns} rows={lineRows} rowId={(row) => row.lineId} />
      {canReadProcurement ? (
        <PurchaseReturnPanel
          receiptId={id as Id<"goodsReceipts">}
          lines={lineRows.map((row) => ({
            lineId: row.lineId,
            name: row.productName,
            sku: row.productSku,
            receivedQty: row.qty,
            unitCost: row.unitCost ?? null,
          }))}
        />
      ) : null}
    </div>
  );
}
