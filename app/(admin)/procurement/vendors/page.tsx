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
import { paymentTermsLabel } from "@/lib/customers";

type Row = {
  _id: string;
  code: string;
  name: string;
  active: boolean;
  paymentTermsDays: number;
  currency: string;
  licenseNumber: string | null;
};

/** Vendor list (PH2-03). Search and active status are applied on the server. */
export default function VendorsPage() {
  const router = useRouter();
  const canCreate = useCan("procurement", "create");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const rows = useQuery(api.procurement.vendors.list, {
    ...(search.trim() === "" ? {} : { search: search.trim() }),
    ...(active === "" ? {} : { active: active === "active" }),
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
        <Badge color={row.active ? "success" : "gray"} size="sm">
          {row.active ? "Active" : "Inactive"}
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
      id: "currency",
      header: "Currency",
      cell: (row) => <span className="text-secondary text-sm">{row.currency}</span>,
    },
    {
      id: "license",
      header: "License",
      cell: (row) => <span className="text-secondary text-sm">{row.licenseNumber ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Companies you buy from. Terms, tax, and the license live on the account. Contacts and addresses are on the company page."
        actions={
          canCreate ? (
            <Button color="primary" href="/procurement/vendors/new">
              New vendor
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            aria-label="Search vendors"
            placeholder="Search name or code"
            size="sm"
            value={search}
            onChange={setSearch}
          />
        </div>
        <div className="w-44">
          <Select
            aria-label="Filter by active status"
            size="sm"
            placeholder="All statuses"
            items={[
              { id: "", label: "All statuses" },
              { id: "active", label: "Active" },
              { id: "inactive", label: "Inactive" },
            ]}
            value={active}
            onChange={(key) => setActive(key == null ? "" : String(key))}
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
          title="Vendors"
          columns={columns}
          rows={rows}
          rowId={(row) => row._id}
          onRowClick={(row) => router.push(`/procurement/vendors/${row._id}`)}
          empty={{
            title: search.trim() !== "" || active !== "" ? "Nothing matches" : "No vendors yet",
            description:
              search.trim() !== "" || active !== ""
                ? "No company fits these filters."
                : "Add the first company you buy from.",
            action: canCreate ? (
              <Button color="primary" size="sm" href="/procurement/vendors/new">
                New vendor
              </Button>
            ) : undefined,
          }}
        />
      )}
    </div>
  );
}
