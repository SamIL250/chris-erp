"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  creditKindLabel,
  creditStatusLabel,
  type CreditKind,
  type CreditStatus,
} from "@/lib/creditNotes";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";

type CreditRow = {
  _id: Id<"creditNotes">;
  docNumber: string;
  status: CreditStatus;
  kind: CreditKind;
  restock: boolean;
  customerName: string;
  invoiceNumber: string;
  currency: string;
  decimalPlaces: number;
  gross: number;
  creditDate: number;
};

function statusColor(status: CreditStatus): "gray" | "brand" | "error" {
  switch (status) {
    case "draft":
      return "gray";
    case "posted":
      return "brand";
    case "void":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Credit notes against invoices (PH2-17). */
export function CreditDesk() {
  const router = useRouter();
  const notes = useQuery(api.sales.creditNotes.list, {});
  if (notes === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<CreditRow>[] = [
    {
      id: "docNumber",
      header: "Credit",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    { id: "invoice", header: "Invoice", cell: (row) => row.invoiceNumber },
    { id: "customer", header: "Customer", cell: (row) => row.customerName },
    { id: "kind", header: "Kind", cell: (row) => creditKindLabel(row.kind) },
    {
      id: "date",
      header: "Date",
      cell: (row) => priceDayLabel(row.creditDate),
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
          {creditStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Credit notes"
        description="Credit a posted invoice for a return or an adjustment. A return can put the goods back."
      />
      <DataTable
        title="Credit notes"
        rows={notes}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/sales/credit-notes/${row._id}`)}
        empty={{
          title: "No credit notes yet",
          description: "Credit a posted invoice to open one.",
        }}
      />
    </div>
  );
}
