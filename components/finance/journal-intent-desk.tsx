"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  journalIntentStatusLabel,
  journalIntentTypeLabel,
  type JournalIntentStatus,
  type JournalIntentType,
} from "@/lib/journalIntents";
import { formatUnitPrice } from "@/lib/pricing";

type IntentRow = {
  _id: Id<"journalIntents">;
  type: JournalIntentType;
  number: string;
  href: string | null;
  period: string;
  currency: string;
  amount: number;
  status: JournalIntentStatus;
};

/** Pending journal intents (PH2-26). Posting them is Phase 3. */
export function JournalIntentDesk() {
  const router = useRouter();
  const rows = useQuery(api.finance.journalIntents.list, {});
  if (rows === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<IntentRow>[] = [
    {
      id: "type",
      header: "Event",
      cell: (row) => journalIntentTypeLabel(row.type),
    },
    {
      id: "number",
      header: "Document",
      cell: (row) =>
        row.href === null ? (
          <span className="text-primary text-sm font-medium">{row.number}</span>
        ) : (
          <Link href={row.href} className="text-primary text-sm font-medium">
            {row.number}
          </Link>
        ),
    },
    { id: "period", header: "Period", cell: (row) => row.period },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => `${formatUnitPrice(row.amount, 2)} ${row.currency}`,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color="warning" size="sm">
          {journalIntentStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Journal intents"
        description="Events waiting for the ledger. Nothing here has been posted."
      />
      <DataTable
        title="Backlog"
        rows={rows}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => {
          if (row.href !== null) router.push(row.href);
        }}
        empty={{
          title: "No journal intents",
          description:
            "A shipment, an invoice, a receipt, a bill, a debit note, or a stock adjustment writes one here.",
        }}
      />
    </div>
  );
}
