"use client";

import { useQuery } from "convex/react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageLabel } from "@/components/shared/page-label";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatQty, formatValue, formatWhen } from "@/lib/inventory-display";

/** Read-only receipt. A correction is an adjustment, not an edit. */
export function ReceiptDetail({ id }: { id: string }) {
  const receipt = useQuery(api.inventory.goodsReceipts.get, {
    receiptId: id as Id<"goodsReceipts">,
  });
  const warehouses = useQuery(api.inventory.warehouses.list);
  const products = useQuery(api.catalog.products.picker, { search: "" });
  usePageLabel(receipt?.number);

  if (receipt === undefined) return <Skeleton className="h-96" />;

  const warehouse = warehouses?.find((row) => row._id === receipt.warehouseId);
  const columns: DataTableColumn<(typeof receipt.lines)[number]>[] = [
    {
      id: "product",
      header: "Product",
      cell: (row) => {
        const product = products?.find((item) => item._id === row.productId);
        return (
          <span className="text-primary text-sm">
            {product ? `${product.name} · ${product.sku}` : row.productId}
          </span>
        );
      },
    },
    {
      id: "qty",
      header: "Quantity",
      cell: (row) => <span className="text-sm tabular-nums">{formatQty(row.qty)}</span>,
    },
    {
      id: "cost",
      header: "Unit cost",
      cell: (row) => <span className="text-sm tabular-nums">{formatValue(row.unitCost)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={receipt.number}
        description={`${warehouse ? `${warehouse.code} · ${warehouse.name}` : "Warehouse"} · ${receipt.referenceNote} · ${formatWhen(receipt.createdAt)}`}
      />
      <DataTable title="Lines" columns={columns} rows={receipt.lines} rowId={(row) => row.lineId} />
    </div>
  );
}
