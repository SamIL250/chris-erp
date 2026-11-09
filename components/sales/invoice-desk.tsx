"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { invoiceStatusLabel, type InvoiceStatus } from "@/lib/invoices";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";

type InvoiceRow = {
  _id: Id<"salesInvoices">;
  docNumber: string;
  status: InvoiceStatus;
  customerName: string;
  orderNumber: string;
  deliveryNumber: string | null;
  currency: string;
  decimalPlaces: number;
  gross: number;
  invoiceDate: number;
};

function statusColor(status: InvoiceStatus): "gray" | "brand" | "success" | "error" {
  switch (status) {
    case "draft":
      return "gray";
    case "posted":
      return "brand";
    case "paid":
      return "success";
    case "void":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Invoices drafted from shipped orders and deliveries (PH2-16). */
export function InvoiceDesk() {
  const router = useRouter();
  const invoices = useQuery(api.sales.invoices.list, {});
  if (invoices === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      id: "docNumber",
      header: "Invoice",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    { id: "order", header: "Order", cell: (row) => row.orderNumber },
    { id: "customer", header: "Customer", cell: (row) => row.customerName },
    {
      id: "date",
      header: "Date",
      cell: (row) => priceDayLabel(row.invoiceDate),
    },
    {
      id: "total",
      header: "Total",
      cell: (row) => `${formatUnitPrice(row.gross, row.decimalPlaces)} ${row.currency}`,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={statusColor(row.status)} size="sm">
          {invoiceStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Invoices"
        description="Draft an invoice from shipped quantity, then post it. Posting records what the customer owes."
      />
      <DataTable
        title="Invoices"
        rows={invoices}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/sales/invoices/${row._id}`)}
        empty={{
          title: "No invoices yet",
          description: "Invoice a shipped order or delivery to open one.",
        }}
      />
    </div>
  );
}
