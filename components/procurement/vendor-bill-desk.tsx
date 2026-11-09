"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";
import {
  vendorBillStatusColor,
  vendorBillStatusLabel,
  type VendorBillStatus,
} from "@/lib/vendorBills";

type BillRow = {
  _id: Id<"vendorBills">;
  docNumber: string;
  status: VendorBillStatus;
  vendorName: string;
  purchaseOrderNumber: string | null;
  billDate: number;
  currency: string;
  decimalPlaces: number;
  amount: number;
};

/** Vendor bills waiting to be matched (PH2-23). */
export function VendorBillDesk() {
  const router = useRouter();
  const rows = useQuery(api.procurement.vendorBills.list, {});
  const canEdit = useCan("procurement", "edit");
  if (rows === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<BillRow>[] = [
    {
      id: "docNumber",
      header: "Bill",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    { id: "vendor", header: "Vendor", cell: (row) => row.vendorName },
    {
      id: "order",
      header: "Purchase order",
      cell: (row) => row.purchaseOrderNumber ?? "—",
    },
    { id: "date", header: "Bill date", cell: (row) => priceDayLabel(row.billDate) },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => `${formatUnitPrice(row.amount, row.decimalPlaces)} ${row.currency}`,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={vendorBillStatusColor(row.status)} size="sm">
          {vendorBillStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Vendor bills"
        description="Record a bill from a received purchase order, or on its own. Matching posts it. Payment is Phase 3."
        actions={
          canEdit ? (
            <Button color="primary" href="/procurement/bills/new">
              New bill
            </Button>
          ) : null
        }
      />
      <DataTable
        title="Bills"
        rows={rows}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/procurement/bills/${row._id}`)}
        empty={{
          title: "No vendor bills yet",
          description: "Record one from a received purchase order, or on its own.",
        }}
      />
    </div>
  );
}
