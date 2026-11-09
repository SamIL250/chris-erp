"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { CustomerGroupForm } from "@/components/sales/customer-group-form";
import { GroupPrices } from "@/components/sales/stored-price-table";
import { usePageLabel } from "@/components/shared/page-label";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { customerStatusLabel, type CustomerStatus } from "@/lib/customers";

type Assigned = {
  _id: Id<"customers">;
  code: string;
  name: string;
  status: CustomerStatus;
};

/** One tier and the companies assigned to it (PH2-02). */
export function CustomerGroupDetail({ groupId }: { groupId: string }) {
  const router = useRouter();
  const canEdit = useCan("sales", "edit");
  const detail = useQuery(api.sales.customerGroups.get, {
    groupId: groupId as Id<"customerGroups">,
  });
  usePageLabel(detail?.group.name);

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return (
      <PageHeader title="Customer group not found" description="That tier is not in the master." />
    );
  }

  const columns: DataTableColumn<Assigned>[] = [
    {
      id: "code",
      header: "Code",
      cell: (row) => <span className="text-primary font-mono text-sm font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: "Company",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.name}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge
          color={row.status === "active" ? "success" : row.status === "onHold" ? "error" : "gray"}
          size="sm"
        >
          {customerStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={detail.group.name}
        description="Companies in this tier. Change the assignment from the company page."
        actions={
          <Badge color={detail.group.active ? "success" : "gray"} size="md">
            {detail.group.active ? "Active" : "Inactive"}
          </Badge>
        }
      />

      <section className="bg-primary ring-primary rounded-xl ring-1">
        <CustomerGroupForm
          key={`${detail.group.updatedAt}-${detail.group.name}-${detail.group.active}`}
          group={detail.group}
          canSave={canEdit}
          onSaved={() => undefined}
        />
      </section>

      <GroupPrices groupId={detail.group._id} active={detail.group.active} />

      <DataTable
        title="Customers"
        columns={columns}
        rows={detail.customers}
        rowId={(row) => row._id}
        onRowClick={(row) => router.push(`/sales/customers/${row._id}`)}
        empty={{
          title: "No customers in this group",
          description: "Assign a company to this tier from its page.",
        }}
      />
    </div>
  );
}
