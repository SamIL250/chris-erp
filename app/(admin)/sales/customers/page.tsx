"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useCan } from "@/hooks/use-can";
import { customerStatusLabel, paymentTermsLabel, type CustomerStatus } from "@/lib/customers";
import { formatValue } from "@/lib/inventory-display";

type Row = {
  _id: string;
  code: string;
  name: string;
  status: CustomerStatus;
  paymentTermsDays: number;
  currency: string;
  creditLimit?: number;
  groupName: string | null;
};

/** Customer list (PH2-01). Search and status are applied on the server. */
export default function CustomersPage() {
  const router = useRouter();
  const canCreate = useCan("sales", "create");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const rows = useQuery(api.sales.customers.list, {
    ...(search.trim() === "" ? {} : { search: search.trim() }),
    ...(status === "" ? {} : { status: status as CustomerStatus }),
  });

  const columns: DataTableColumn<Row>[] = [
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
    {
      id: "terms",
      header: "Terms",
      cell: (row) => (
        <span className="text-secondary text-sm">{paymentTermsLabel(row.paymentTermsDays)}</span>
      ),
    },
    {
      id: "group",
      header: "Group",
      cell: (row) => <span className="text-secondary text-sm">{row.groupName ?? "—"}</span>,
    },
    {
      id: "currency",
      header: "Currency",
      cell: (row) => <span className="text-secondary text-sm">{row.currency}</span>,
    },
    {
      id: "credit",
      header: "Credit limit",
      cell: (row) => (
        <span className="text-secondary text-sm tabular-nums">
          {row.creditLimit === undefined ? "—" : formatValue(row.creditLimit)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Companies you sell to. Terms, tax, and credit live on the account. Contacts, addresses, and notes are on the company page."
        actions={
          canCreate ? (
            <Button color="primary" href="/sales/customers/new">
              New customer
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            aria-label="Search customers"
            placeholder="Search name or code"
            size="sm"
            value={search}
            onChange={setSearch}
          />
        </div>
        <div className="w-44">
          <Select
            aria-label="Filter by account status"
            size="sm"
            placeholder="All statuses"
            items={[
              { id: "", label: "All statuses" },
              { id: "active", label: "Active" },
              { id: "onHold", label: "On hold" },
              { id: "closed", label: "Closed" },
            ]}
            value={status}
            onChange={(key) => setStatus(key == null ? "" : String(key))}
          >
            {(item) => (
              <Select.Item id={item.id} key={item.id}>
                {item.label}
              </Select.Item>
            )}
          </Select>
        </div>
      </div>

      {rows === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          title="Customers"
          columns={columns}
          rows={rows}
          rowId={(row) => row._id}
          onRowClick={(row) => router.push(`/sales/customers/${row._id}`)}
          empty={{
            title: search.trim() !== "" || status !== "" ? "Nothing matches" : "No customers yet",
            description:
              search.trim() !== "" || status !== ""
                ? "No company fits these filters."
                : "Add the first company you sell to.",
            action: canCreate ? (
              <Button color="primary" size="sm" href="/sales/customers/new">
                New customer
              </Button>
            ) : undefined,
          }}
        />
      )}
    </div>
  );
}
