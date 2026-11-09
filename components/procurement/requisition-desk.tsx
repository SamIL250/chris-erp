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
import { priceDayLabel } from "@/lib/pricing";
import { requisitionStatusLabel, type RequisitionStatus } from "@/lib/requisitions";

type RequisitionRow = {
  _id: Id<"requisitions">;
  docNumber: string;
  status: RequisitionStatus;
  needBy: number;
  requesterName: string;
  lineCount: number;
  purchaseOrderNumber: string | null;
  createdAt: number;
};

function statusColor(status: RequisitionStatus): "gray" | "success" | "error" {
  switch (status) {
    case "draft":
      return "gray";
    case "approved":
      return "success";
    case "rejected":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Internal requests to buy (PH2-20). */
export function RequisitionDesk() {
  const router = useRouter();
  const canCreate = useCan("procurement", "create");
  const rows = useQuery(api.procurement.requisitions.list, {});
  if (rows === undefined) return <Skeleton className="h-96" />;

  const columns: DataTableColumn<RequisitionRow>[] = [
    {
      id: "docNumber",
      header: "Requisition",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    { id: "requester", header: "Requester", cell: (row) => row.requesterName },
    { id: "needBy", header: "Need by", cell: (row) => priceDayLabel(row.needBy) },
    { id: "lines", header: "Lines", align: "right", cell: (row) => String(row.lineCount) },
    {
      id: "order",
      header: "Purchase order",
      cell: (row) => row.purchaseOrderNumber ?? "—",
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={statusColor(row.status)} size="sm">
          {requisitionStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Requisitions"
        description="Ask for goods, then an approver turns an approved request into a draft purchase order."
        actions={
          canCreate ? (
            <Button color="primary" href="/procurement/requisitions/new">
              New requisition
            </Button>
          ) : null
        }
      />
      <DataTable
        title="Requisitions"
        rows={rows}
        columns={columns}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/procurement/requisitions/${row._id}`)}
        empty={{
          title: "No requisitions yet",
          description: "Request the products you need and a date they are needed by.",
        }}
      />
    </div>
  );
}
