"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useCan } from "@/hooks/use-can";
import { formatQty, formatWhen, transferStatusLabel } from "@/lib/inventory-display";

type StatusFilter = "" | "draft" | "inTransit" | "received" | "cancelled";

const STATUS_COLOR = {
  draft: "warning",
  inTransit: "brand",
  received: "success",
  cancelled: "gray",
} as const;

/**
 * Transfers (PH1-23). "In transit" is the report of goods that have left
 * the source and have not fully arrived.
 */
export default function TransfersPage() {
  const router = useRouter();
  const canCreate = useCan("inventory", "create");
  const [status, setStatus] = useState<StatusFilter>("inTransit");
  const listed = useQuery(api.inventory.transfers.list, status === "" ? {} : { status });
  const report = useQuery(api.inventory.transfers.inTransit, status === "inTransit" ? {} : "skip");
  const warehouses = useQuery(api.inventory.warehouses.list);

  const nameOf = (id: string) => {
    const warehouse = warehouses?.find((row) => row._id === id);
    return warehouse ? `${warehouse.code} · ${warehouse.name}` : "—";
  };

  if (status === "inTransit") {
    const rows = (report ?? []).map((row) => ({
      ...row,
      outstanding: row.lines.reduce((sum, line) => sum + line.outstanding, 0),
    }));
    const columns: DataTableColumn<(typeof rows)[number]>[] = [
      {
        id: "number",
        header: "Number",
        cell: (row) => (
          <span className="text-primary font-mono text-sm font-medium">{row.number}</span>
        ),
      },
      {
        id: "from",
        header: "From",
        cell: (row) => (
          <span className="text-secondary text-sm">
            {row.fromCode} · {row.fromName}
          </span>
        ),
      },
      {
        id: "to",
        header: "To",
        cell: (row) => (
          <span className="text-secondary text-sm">
            {row.toCode} · {row.toName}
          </span>
        ),
      },
      {
        id: "outstanding",
        header: "Still to arrive",
        cell: (row) => (
          <span className="text-primary text-sm tabular-nums">{formatQty(row.outstanding)}</span>
        ),
      },
      {
        id: "shipped",
        header: "Shipped",
        cell: (row) => <span className="text-tertiary text-sm">{formatWhen(row.shippedAt)}</span>,
      },
    ];
    return (
      <Frame canCreate={canCreate} status={status} onStatus={setStatus}>
        {report === undefined ? (
          <Skeleton className="h-96" />
        ) : (
          <DataTable
            title="In transit"
            description="Goods that have left the source warehouse and have not fully arrived."
            columns={columns}
            rows={rows}
            rowId={(row) => row.transferId}
            onRowClick={(row) => router.push(`/inventory/transfers/${row.transferId}`)}
            empty={{
              title: "Nothing in transit",
              description: "Ship a draft transfer and it will wait here until it is received.",
            }}
          />
        )}
      </Frame>
    );
  }

  const columns: DataTableColumn<NonNullable<typeof listed>[number]>[] = [
    {
      id: "number",
      header: "Number",
      cell: (row) => (
        <span className="text-primary font-mono text-sm font-medium">{row.number}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={STATUS_COLOR[row.status]} size="sm">
          {transferStatusLabel(row.status)}
        </Badge>
      ),
    },
    {
      id: "from",
      header: "From",
      cell: (row) => <span className="text-secondary text-sm">{nameOf(row.fromWarehouseId)}</span>,
    },
    {
      id: "to",
      header: "To",
      cell: (row) => <span className="text-secondary text-sm">{nameOf(row.toWarehouseId)}</span>,
    },
    {
      id: "created",
      header: "Created",
      cell: (row) => <span className="text-tertiary text-sm">{formatWhen(row.createdAt)}</span>,
    },
  ];

  return (
    <Frame canCreate={canCreate} status={status} onStatus={setStatus}>
      {listed === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          title="Transfers"
          columns={columns}
          rows={listed}
          rowId={(row) => row.transferId}
          onRowClick={(row) => router.push(`/inventory/transfers/${row.transferId}`)}
          empty={{
            title: "No transfers",
            description: "A transfer moves goods from one warehouse to another.",
          }}
        />
      )}
    </Frame>
  );
}

function Frame({
  canCreate,
  status,
  onStatus,
  children,
}: {
  canCreate: boolean;
  status: StatusFilter;
  onStatus: (status: StatusFilter) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transfers"
        description="Draft, ship the goods out of the source, then receive them — in full or in part — at the destination."
        actions={
          canCreate ? (
            <Button color="primary" href="/inventory/transfers/new">
              New transfer
            </Button>
          ) : null
        }
      />
      <div className="w-44">
        <Select
          aria-label="Filter by status"
          size="sm"
          items={[
            { id: "inTransit", label: "In transit" },
            { id: "draft", label: "Drafts" },
            { id: "received", label: "Received" },
            { id: "cancelled", label: "Cancelled" },
            { id: "", label: "All" },
          ]}
          value={status}
          onChange={(key) => onStatus((key == null ? "" : String(key)) as StatusFilter)}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      </div>
      {children}
    </div>
  );
}
