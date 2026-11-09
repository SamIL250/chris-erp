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
import { quoteStatusLabel, type QuoteStatus } from "@/lib/quotes";

type Row = {
  _id: Id<"quotes">;
  docNumber: string;
  customerName: string;
  status: QuoteStatus;
  currency: string;
  decimalPlaces: number;
  validUntil: number;
  gross: number;
};

function statusColor(status: QuoteStatus): "gray" | "brand" | "success" | "error" {
  switch (status) {
    case "draft":
    case "expired":
      return "gray";
    case "sent":
      return "brand";
    case "accepted":
      return "success";
    case "rejected":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Quote list (PH2-11). */
export default function QuotesPage() {
  const router = useRouter();
  const canCreate = useCan("sales", "create");
  const quotes = useQuery(api.sales.quotes.list, {});

  const columns: DataTableColumn<Row>[] = [
    {
      id: "number",
      header: "Quote",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (row) => <span className="text-secondary text-sm">{row.customerName}</span>,
    },
    {
      id: "valid",
      header: "Valid until",
      cell: (row) => (
        <span className="text-secondary text-sm">{priceDayLabel(row.validUntil)}</span>
      ),
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
          {quoteStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        description="A price for a company, valid through a date, then an order."
        actions={
          canCreate ? (
            <Button color="primary" href="/sales/quotes/new">
              New quote
            </Button>
          ) : null
        }
      />
      {quotes === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        <DataTable
          title="Quotes"
          columns={columns}
          rows={quotes}
          rowId={(row) => row._id}
          onRowClick={(row) => router.push(`/sales/quotes/${row._id}`)}
          empty={{
            title: "No quotes yet",
            description: "A quote holds lines, a discount, tax, and the day it stops being valid.",
          }}
        />
      )}
    </div>
  );
}
