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
import { returnStatusLabel, type ReturnStatus } from "@/lib/salesReturns";

type ReturnRow = {
  _id: Id<"salesReturns">;
  docNumber: string;
  status: ReturnStatus;
  customerName: string;
  orderNumber: string;
  invoiceNumber: string | null;
  currency: string;
  decimalPlaces: number;
  amount: number;
  createdAt: number;
};

function statusColor(status: ReturnStatus): "gray" | "brand" | "success" | "warning" | "error" {
  switch (status) {
    case "requested":
      return "warning";
    case "received":
      return "brand";
    case "credited":
    case "exchanged":
      return "success";
    case "cancelled":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Return requests waiting to be received (PH2-18). */
export function ReturnDesk() {
  const router = useRouter();
  const rows = useQuery(api.sales.salesReturns.list, {});
  if (rows === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<ReturnRow>[] = [
    {
      id: "docNumber",
      header: "Return",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    { id: "order", header: "Order", cell: (row) => row.orderNumber },
    {
      id: "invoice",
      header: "Invoice",
      cell: (row) => row.invoiceNumber ?? "—",
    },
    { id: "customer", header: "Customer", cell: (row) => row.customerName },
    {
      id: "date",
      header: "Requested",
      cell: (row) => priceDayLabel(row.createdAt),
    },
    {
      id: "total",
      header: "Total",
      cell: (row) => `${formatUnitPrice(row.amount, row.decimalPlaces)} ${row.currency}`,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={statusColor(row.status)} size="sm">
          {returnStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Returns"
        description="Request goods back from an invoice or an order, then restock, quarantine, or write them off."
      />
      <DataTable
        title="Returns"
        rows={rows}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/sales/returns/${row._id}`)}
        empty={{
          title: "No returns yet",
          description: "Request one from a posted invoice or a shipped order.",
        }}
      />
    </div>
  );
}
