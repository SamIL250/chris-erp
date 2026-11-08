"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/base/buttons/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useCan } from "@/hooks/use-can";
import { formatWhen } from "@/lib/inventory-display";

/** Manual goods receipts (PH1-22 screen, PH1-23). No purchase order. */
export default function ReceiptsPage() {
  const router = useRouter();
  const canCreate = useCan("inventory", "create");
  const rows = useQuery(api.inventory.goodsReceipts.list, {});
  const warehouses = useQuery(api.inventory.warehouses.list);

  const columns: DataTableColumn<NonNullable<typeof rows>[number]>[] = [
    {
      id: "number",
      header: "Number",
      cell: (row) => (
        <span className="text-primary font-mono text-sm font-medium">{row.number}</span>
      ),
    },
    {
      id: "warehouse",
      header: "Warehouse",
      cell: (row) => {
        const warehouse = warehouses?.find((item) => item._id === row.warehouseId);
        return (
          <span className="text-secondary text-sm">
            {warehouse ? `${warehouse.code} · ${warehouse.name}` : "—"}
          </span>
        );
      },
    },
    {
      id: "note",
      header: "Reference",
      cell: (row) => <span className="text-secondary text-sm">{row.referenceNote}</span>,
    },
    {
      id: "when",
      header: "Posted",
      cell: (row) => <span className="text-tertiary text-sm">{formatWhen(row.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receipts"
        description="Manual intake. The reference note says where the goods came from. Receiving against a purchase order comes later."
        actions={
          canCreate ? (
            <Button color="primary" href="/inventory/receipts/new">
              New receipt
            </Button>
          ) : null
        }
      />
      {rows === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          title="Receipts"
          columns={columns}
          rows={rows}
          rowId={(row) => row.receiptId}
          onRowClick={(row) => router.push(`/inventory/receipts/${row.receiptId}`)}
          empty={{
            title: "No receipts yet",
            description: "Post an intake when goods arrive without a purchase order.",
          }}
        />
      )}
    </div>
  );
}
