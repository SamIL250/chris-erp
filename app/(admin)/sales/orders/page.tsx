"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatUnitPrice } from "@/lib/pricing";
import { orderStatusLabel, type SalesOrderStatus } from "@/lib/salesOrders";

type Row = {
  _id: Id<"salesOrders">;
  docNumber: string;
  customerName: string;
  currency: string;
  decimalPlaces: number;
  gross: number;
  status: SalesOrderStatus;
};

function statusColor(status: SalesOrderStatus): "gray" | "brand" | "warning" | "success" | "error" {
  switch (status) {
    case "draft":
    case "closed":
      return "gray";
    case "confirmed":
      return "brand";
    case "fulfilling":
      return "warning";
    case "invoiced":
      return "success";
    case "cancelled":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Orders opened from quotes (PH2-11, PH2-12). The order desk is PH2-13. */
export default function OrdersPage() {
  const router = useRouter();
  const orders = useQuery(api.sales.orders.list, {});
  const columns: DataTableColumn<Row>[] = [
    {
      id: "number",
      header: "Order",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (row) => <span className="text-secondary text-sm">{row.customerName}</span>,
    },
    {
      id: "total",
      header: "Total",
      cell: (row) => (
        <span className="text-secondary text-sm tabular-nums">
          {formatUnitPrice(row.gross, row.decimalPlaces)} {row.currency}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={statusColor(row.status)} size="sm">
          {orderStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Confirm an order to reserve stock. Pack a reserved quantity, then ship the slip. A short line stays on backorder."
      />
      {orders === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        <DataTable
          title="Orders"
          columns={columns}
          rows={orders}
          rowId={(row) => row._id}
          onRowClick={(row) => router.push(`/sales/orders/${row._id}`)}
          empty={{
            title: "No orders yet",
            description: "Accept a quote, then convert it. The order keeps the quote's prices.",
          }}
        />
      )}
    </div>
  );
}
