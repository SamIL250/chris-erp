"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/base/buttons/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { formatValue, formatWhen } from "@/lib/inventory-display";

type ReturnRow = {
  _id: Id<"purchaseReturns">;
  docNumber: string;
  receiptNumber: string | null;
  vendorName: string | null;
  reason: string;
  amount: number | null;
  createdAt: number;
};

/** Debit notes raised when goods go back to a vendor (PH2-24). */
export function PurchaseReturnDesk() {
  const router = useRouter();
  const rows = useQuery(api.procurement.purchaseReturns.list, {});
  const canReturn = useCan("inventory", "create");
  if (rows === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<ReturnRow>[] = [
    {
      id: "docNumber",
      header: "Debit note",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    { id: "vendor", header: "Vendor", cell: (row) => row.vendorName ?? "—" },
    { id: "receipt", header: "Receipt", cell: (row) => row.receiptNumber ?? "—" },
    { id: "reason", header: "Reason", cell: (row) => row.reason },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => formatValue(row.amount ?? undefined),
    },
    { id: "when", header: "Returned", cell: (row) => formatWhen(row.createdAt) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Vendor returns"
        description="Goods that left a receipt on the way back to the vendor. The number is the debit note reference."
        actions={
          canReturn ? (
            <Button color="primary" href="/procurement/returns/new">
              New return
            </Button>
          ) : null
        }
      />
      <DataTable
        title="Returns"
        rows={rows}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/procurement/returns/${row._id}`)}
        empty={{
          title: "No vendor returns yet",
          description: "Open a goods receipt and send quantity back to the vendor.",
        }}
      />
    </div>
  );
}
