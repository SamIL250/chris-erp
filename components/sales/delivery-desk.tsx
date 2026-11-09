"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { useProductCovers } from "@/hooks/use-product-covers";
import { pickListPdf } from "@/lib/deliveryPdf";
import { pdfCompany } from "@/lib/pdfKit";
import { deliveryStatusLabel, type DeliveryStatus } from "@/lib/deliveries";
import { toUserMessage } from "@/lib/errors";
import { formatQty } from "@/lib/inventory-display";
import { priceDayLabel } from "@/lib/pricing";

type PickLine = {
  lineId: Id<"salesOrderLines">;
  productId: Id<"products">;
  sku: string;
  description: string;
  packable: number;
};

type PickOrder = {
  salesOrderId: Id<"salesOrders">;
  docNumber: string;
  customerName: string;
  lines: PickLine[];
};

type SlipRow = {
  _id: Id<"deliveries">;
  docNumber: string;
  orderNumber: string;
  customerName: string;
  warehouseCode: string;
  status: DeliveryStatus;
};

function statusColor(status: DeliveryStatus): "gray" | "warning" | "success" {
  switch (status) {
    case "packed":
      return "warning";
    case "shipped":
      return "success";
    case "cancelled":
      return "gray";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** Pick list grouped by warehouse, and the packing slips already opened (PH2-14). */
export function DeliveryDesk() {
  const router = useRouter();
  const groups = useQuery(api.sales.deliveries.pickList, {});
  const slips = useQuery(api.sales.deliveries.list, {});
  const org = useQuery(api.organization.get, {});
  const productIds = (groups ?? []).flatMap((group) =>
    group.orders.flatMap((order) => order.lines.map((line) => line.productId)),
  );
  const covers = useProductCovers(productIds);
  const columns: DataTableColumn<SlipRow>[] = [
    {
      id: "number",
      header: "Delivery",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.docNumber}</span>,
    },
    {
      id: "order",
      header: "Order",
      cell: (row) => <span className="text-secondary text-sm">{row.orderNumber}</span>,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (row) => <span className="text-secondary text-sm">{row.customerName}</span>,
    },
    {
      id: "warehouse",
      header: "Warehouse",
      cell: (row) => <span className="text-secondary text-sm">{row.warehouseCode}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={statusColor(row.status)} size="sm">
          {deliveryStatusLabel(row.status)}
        </Badge>
      ),
    },
  ];

  if (groups === undefined || slips === undefined) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Deliveries"
        description="Pack what is reserved, then ship it with a carrier and a tracking number."
        actions={
          <Button
            color="secondary"
            onPress={() => {
              void (async () => {
                const company = await pdfCompany(org, "Company");
                const bytes = await pickListPdf({
                  companyName: company.companyName,
                  logo: company.logo,
                  footer: company.footer,
                  printedOn: priceDayLabel(Date.now()),
                  groups: groups.map((group) => ({
                    code: group.code,
                    name: group.name,
                    orders: group.orders.map((order) => ({
                      docNumber: order.docNumber,
                      customerName: order.customerName,
                      lines: order.lines.map((line) => ({
                        description: line.description,
                        sku: line.sku,
                        qty: line.packable,
                      })),
                    })),
                  })),
                });
                const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "pick-list.pdf";
                link.click();
                URL.revokeObjectURL(url);
              })();
            }}
          >
            Print pick list
          </Button>
        }
      />
      <section className="space-y-4">
        <h2 className="text-primary text-md font-semibold">Pick list</h2>
        {groups.length === 0 ? (
          <div className="bg-primary ring-primary rounded-xl px-6 py-12 ring-1">
            <EmptyState size="md">
              <EmptyState.Header>
                <EmptyState.Illustration type="box" />
              </EmptyState.Header>
              <EmptyState.Content>
                <EmptyState.Title>Nothing is waiting to pick</EmptyState.Title>
                <EmptyState.Description>
                  Reserved quantity shows up here, grouped by warehouse.
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.warehouseId} className="space-y-3">
              <h3 className="text-secondary text-sm font-medium">
                {group.code} · {group.name}
              </h3>
              {group.orders.map((order) => (
                <PackOrder key={order.salesOrderId} order={order} covers={covers} />
              ))}
            </div>
          ))
        )}
      </section>
      <section className="space-y-4">
        <h2 className="text-primary text-md font-semibold">Packing slips</h2>
        <DataTable
          title="Packing slips"
          rows={slips}
          columns={columns}
          rowId={(row) => row._id}
          onRowClick={(row) => router.push(`/sales/deliveries/${row._id}`)}
          empty={{
            title: "No packing slips yet",
            description: "Pack a reserved order to open one.",
          }}
        />
      </section>
    </div>
  );
}

function PackOrder({ order, covers }: { order: PickOrder; covers: Map<string, string | null> }) {
  const pack = useMutation(api.sales.deliveries.pack);
  const router = useRouter();
  const canEdit = useCan("sales", "edit");
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((line) => [line.lineId, String(line.packable)])),
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="bg-primary ring-primary space-y-3 rounded-xl p-4 ring-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/sales/orders/${order.salesOrderId}`}
          className="text-primary text-sm font-medium hover:underline"
        >
          {order.docNumber}
        </Link>
        <span className="text-tertiary text-sm">{order.customerName}</span>
      </div>
      <ul className="divide-secondary divide-y">
        {order.lines.map((line) => (
          <li key={line.lineId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <ProductIdentity name={line.description} src={covers.get(line.productId) ?? null} />
              <p className="text-tertiary mt-1 text-sm">
                {line.sku} · {formatQty(line.packable)} to pack
              </p>
            </div>
            <Input
              aria-label={`Quantity to pack for ${line.sku}`}
              size="sm"
              type="number"
              value={qty[line.lineId] ?? ""}
              onChange={(value) => setQty((current) => ({ ...current, [line.lineId]: value }))}
              className="w-24"
            />
          </li>
        ))}
      </ul>
      {error ? <FormAlert title="Couldn't pack the order" message={error} /> : null}
      {canEdit ? (
        <Button
          color="primary"
          size="sm"
          onPress={() => {
            setError(null);
            const lines = order.lines
              .map((line) => ({ lineId: line.lineId, qty: Number(qty[line.lineId] ?? "") }))
              .filter((line) => line.qty > 0);
            if (lines.length === 0) {
              setError("Enter a quantity to pack.");
              return;
            }
            void pack({ salesOrderId: order.salesOrderId, lines })
              .then((id) => {
                toast.success("Packed");
                router.push(`/sales/deliveries/${id}`);
              })
              .catch((err: unknown) => setError(toUserMessage(err)));
          }}
        >
          Pack order
        </Button>
      ) : null}
    </div>
  );
}
