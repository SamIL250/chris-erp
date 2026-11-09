"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { formatQty } from "@/lib/inventory-display";
import { deskTileLabel, type DeskTile } from "@/lib/orderDesk";
import { cx } from "@/utils/cx";

type DeskKind = "order" | "delivery" | "invoice" | "return";

type DeskRow = {
  id: string;
  kind: DeskKind;
  number: string;
  customerName: string;
  detail: string;
};

function rowHref(row: DeskRow): string {
  switch (row.kind) {
    case "order":
      return `/sales/orders/${row.id}`;
    case "delivery":
      return `/sales/deliveries/${row.id}`;
    case "invoice":
      return `/sales/invoices/${row.id}`;
    case "return":
      return `/sales/returns/${row.id}`;
    default: {
      const unreachable: never = row.kind;
      return unreachable;
    }
  }
}

function kindLabel(kind: DeskKind): string {
  switch (kind) {
    case "order":
      return "Order";
    case "delivery":
      return "Delivery";
    case "invoice":
      return "Invoice";
    case "return":
      return "Return";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function emptyCopy(tile: DeskTile): { title: string; description: string } {
  switch (tile) {
    case "open":
      return {
        title: "No open orders",
        description: "A draft, confirmed, fulfilling, or invoiced order shows up here.",
      };
    case "pick":
      return {
        title: "Nothing to pick",
        description: "Reserved quantity that is not on a packing slip shows up here.",
      };
    case "ship":
      return {
        title: "Nothing to ship",
        description: "A packed slip shows up here until it ships.",
      };
    case "bill":
      return {
        title: "Nothing to bill",
        description: "Shipped quantity, and a draft invoice, show up here.",
      };
    case "returns":
      return {
        title: "No returns pending",
        description: "A requested or received return shows up here.",
      };
    default: {
      const unreachable: never = tile;
      return unreachable;
    }
  }
}

/** Live order desk (PH2-19). */
export function OrderDesk() {
  const desk = useQuery(api.sales.desk.get, {});
  const router = useRouter();
  const [tile, setTile] = useState<DeskTile>("open");

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
    { id: "customer", header: "Customer", cell: (row) => row.customerName },
    { id: "detail", header: "Status", cell: (row) => row.detail },
  ];
  const empty = emptyCopy(tile);
  const tiles: { id: DeskTile; value: string; sub?: string }[] = [
    { id: "open", value: String(desk.open.count) },
    {
      id: "pick",
      value: String(desk.pick.count),
      sub: desk.pick.units > 0 ? `${formatQty(desk.pick.units)} units` : undefined,
    },
    { id: "ship", value: String(desk.ship.count) },
    {
      id: "bill",
      value: String(desk.bill.count),
      sub: desk.bill.units > 0 ? `${formatQty(desk.bill.units)} units` : undefined,
    },
    { id: "returns", value: String(desk.returns.count) },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Order desk"
        description="Open orders, what is waiting to pick or ship, what is waiting to bill, and returns that are not finished."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
            <p className="text-secondary text-sm font-medium">{deskTileLabel(item.id)}</p>
            <p className="text-display-sm text-primary mt-1 font-semibold">{item.value}</p>
            {item.sub ? <p className="text-tertiary text-sm">{item.sub}</p> : null}
          </button>
        ))}
      </div>
      <DataTable
        title={deskTileLabel(tile)}
        rows={rows}
        columns={columns}
        rowId={(row) => row.id}
        onRowClick={(row) => router.push(rowHref(row))}
        empty={empty}
      />
    </div>
  );
}
