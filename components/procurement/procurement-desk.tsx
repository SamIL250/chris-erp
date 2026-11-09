"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { formatQty } from "@/lib/inventory-display";
import { procurementDeskTileLabel, type ProcurementDeskTile } from "@/lib/procurementDesk";
import { cx } from "@/utils/cx";

type DeskKind = "purchaseOrder" | "vendorBill";

type DeskRow = {
  id: string;
  kind: DeskKind;
  number: string;
  vendorName: string;
  detail: string;
};

function rowHref(row: DeskRow): string {
  switch (row.kind) {
    case "purchaseOrder":
      return `/procurement/purchase-orders/${row.id}`;
    case "vendorBill":
      return `/procurement/bills/${row.id}`;
    default: {
      const unreachable: never = row.kind;
      return unreachable;
    }
  }
}

function kindLabel(kind: DeskKind): string {
  switch (kind) {
    case "purchaseOrder":
      return "Purchase order";
    case "vendorBill":
      return "Bill";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function emptyCopy(tile: ProcurementDeskTile): { title: string; description: string } {
  switch (tile) {
    case "open":
      return {
        title: "No open purchase orders",
        description: "A draft, sent, partially received, or received order shows up here.",
      };
    case "overdue":
      return {
        title: "No overdue deliveries",
        description: "A sent order past its expected date, and not fully received, shows up here.",
      };
    case "receipts":
      return {
        title: "No receipts pending",
        description: "Quantity still to accept on a sent order shows up here.",
      };
    case "bills":
      return {
        title: "No bills pending match",
        description: "An open vendor bill shows up here. A received order with no bill does not.",
      };
    default: {
      const unreachable: never = tile;
      return unreachable;
    }
  }
}

/** Live procurement desk (PH2-25). */
export function ProcurementDesk() {
  const desk = useQuery(api.procurement.desk.get, {});
  const router = useRouter();
  const [tile, setTile] = useState<ProcurementDeskTile>("open");

  if (desk === undefined) return <Skeleton className="h-96" />;

  const rows = desk[tile].rows;
  const columns: DataTableColumn<DeskRow>[] = [
    {
      id: "number",
      header: "Document",
      cell: (row) => (
        <span>
          <span className="text-primary block text-sm font-medium">{row.number}</span>
          <span className="text-tertiary text-sm">{kindLabel(row.kind)}</span>
        </span>
      ),
    },
    { id: "vendor", header: "Vendor", cell: (row) => row.vendorName },
    { id: "detail", header: "Status", cell: (row) => row.detail },
  ];
  const empty = emptyCopy(tile);
  const tiles: { id: ProcurementDeskTile; value: string; sub?: string }[] = [
    { id: "open", value: String(desk.open.count) },
    { id: "overdue", value: String(desk.overdue.count) },
    {
      id: "receipts",
      value: String(desk.receipts.count),
      sub: desk.receipts.units > 0 ? `${formatQty(desk.receipts.units)} units` : undefined,
    },
    { id: "bills", value: String(desk.bills.count) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Procurement desk"
        description="Open purchase orders, deliveries past their expected date, quantity still to receive, and bills waiting to be matched."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tile === item.id}
            onClick={() => setTile(item.id)}
            className={cx(
              "bg-primary ring-primary rounded-xl p-5 text-left ring-1",
              tile === item.id && "ring-brand ring-2",
            )}
          >
            <p className="text-secondary text-sm font-medium">
              {procurementDeskTileLabel(item.id)}
            </p>
            <p className="text-display-sm text-primary mt-1 font-semibold">{item.value}</p>
            {item.sub ? <p className="text-tertiary text-sm">{item.sub}</p> : null}
          </button>
        ))}
      </div>
      <DataTable
        title={procurementDeskTileLabel(tile)}
        rows={rows}
        columns={columns}
        rowId={(row) => row.id}
        onRowClick={(row) => router.push(rowHref(row))}
        empty={empty}
      />
    </div>
  );
}
