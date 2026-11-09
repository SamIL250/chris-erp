"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";
import {
  purchaseOrderStatusColor,
  purchaseOrderStatusLabel,
  type PurchaseOrderStatus,
} from "@/lib/purchaseOrders";

type PurchaseOrderRow = {
  _id: Id<"purchaseOrders">;
  docNumber: string;
  status: PurchaseOrderStatus;
  vendorName: string;
  requisitionNumber: string;
  expectedDate: number;
  currency: string;
  decimalPlaces: number;
  amount: number;
  createdAt: number;
};

/** Purchase orders sent to a vendor (PH2-21). */
export function PurchaseOrderDesk() {
  const router = useRouter();
  const rows = useQuery(api.procurement.purchaseOrders.list, {});
  if (rows === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<PurchaseOrderRow>[] = [
    {
      id: "docNumber",
      header: "Purchase order",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    { id: "vendor", header: "Vendor", cell: (row) => row.vendorName },
    { id: "requisition", header: "Requisition", cell: (row) => row.requisitionNumber },
    { id: "expected", header: "Expected", cell: (row) => priceDayLabel(row.expectedDate) },
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
        <Badge color={purchaseOrderStatusColor(row.status)} size="sm">
          {purchaseOrderStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Purchase orders"
        description="Agreed price and tax, then send. A receipt and a bill move the order on."
      />
      <DataTable
        title="Purchase orders"
        rows={rows}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/procurement/purchase-orders/${row._id}`)}
        empty={{
          title: "No purchase orders yet",
          description: "Approve a requisition, then convert it.",
        }}
      />
    </div>
  );
}
