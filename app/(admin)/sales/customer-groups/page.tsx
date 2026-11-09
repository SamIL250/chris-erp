"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { CustomerGroupForm } from "@/components/sales/customer-group-form";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";

type Row = {
  _id: Id<"customerGroups">;
  name: string;
  active: boolean;
  customerCount: number;
};

/** Customer groups (PH2-02). A row opens the tier and the companies on it. */
export default function CustomerGroupsPage() {
  const router = useRouter();
  const canCreate = useCan("sales", "create");
  const rows = useQuery(api.sales.customerGroups.list, {});
  const [creating, setCreating] = useState(false);

  const columns: DataTableColumn<Row>[] = [
    {
      id: "name",
      header: "Group",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.name}</span>,
    },
    {
      id: "customers",
      header: "Customers",
      cell: (row) => (
        <span className="text-secondary text-sm tabular-nums">{row.customerCount}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={row.active ? "success" : "gray"} size="sm">
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer groups"
        description="Tiers such as Retail, Wholesale, and Institutional. A company belongs to one group."
        actions={
          canCreate ? (
            <Button color="primary" onPress={() => setCreating(true)}>
              New group
            </Button>
          ) : null
        }
      />

      {rows === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          title="Groups"
          columns={columns}
          rows={rows}
          rowId={(row) => row._id}
          onRowClick={(row) => router.push(`/sales/customer-groups/${row._id}`)}
          empty={{
            title: "No customer groups yet",
            description: "Add Retail, Wholesale, and Institutional, or any tier you sell at.",
            action: canCreate ? (
              <Button color="primary" size="sm" onPress={() => setCreating(true)}>
                New group
              </Button>
            ) : undefined,
          }}
        />
      )}

      <ModalOverlay
        isDismissable
        isOpen={creating}
        onOpenChange={(open) => !open && setCreating(false)}
      >
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            {creating ? (
              <CustomerGroupForm
                group={null}
                canSave={canCreate}
                onSaved={() => setCreating(false)}
                onCancel={() => setCreating(false)}
              />
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
