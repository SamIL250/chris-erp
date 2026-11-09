"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { SalesDocFlow } from "@/components/shared/doc-flow";
import { ReturnRequestForm } from "@/components/sales/return-form";
import { usePageLabel } from "@/components/shared/page-label";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { useProductCovers } from "@/hooks/use-product-covers";
import { paymentTermsLabel } from "@/lib/customers";
import { packableQty } from "@/lib/deliveries";
import { toUserMessage } from "@/lib/errors";
import { formatQty } from "@/lib/inventory-display";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";
import {
  orderChannelLabel,
  orderStatusLabel,
  type SalesOrderChannel,
  type SalesOrderStatus,
} from "@/lib/salesOrders";

function statusColor(status: SalesOrderStatus): "gray" | "brand" | "warning" | "success" | "error" {
  switch (status) {
    case "draft":
    case "closed":
      return "gray";
    case "confirmed":
      return "brand";
    case "fulfilling":
      return "warning";
    case "invoiced":
      return "success";
    case "cancelled":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function channelColor(channel: SalesOrderChannel): "gray" | "brand" {
  switch (channel) {
    case "manual":
      return "gray";
    case "storefront":
      return "brand";
    default: {
      const unreachable: never = channel;
      return unreachable;
    }
  }
}

function addressText(
  address:
    | {
        line1: string;
        line2?: string;
        city: string;
        region?: string;
        postalCode?: string;
        country: string;
      }
    | undefined,
): string | null {
  if (address === undefined) return null;
  return [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(", ");
}

/** The sales-order screen (PH2-13): header, today's price, and what is free to ship. */
export function OrderDetail({ salesOrderId }: { salesOrderId: string }) {
  const warehouses = useQuery(api.inventory.warehouses.list);
  const [picked, setPicked] = useState("");
  const active = (warehouses ?? []).filter((row) => row.active);
  const previewWarehouse =
    picked !== "" ? picked : (active.find((row) => row.isDefault)?._id ?? active[0]?._id ?? "");
  const detail = useQuery(api.sales.orders.get, {
    salesOrderId: salesOrderId as Id<"salesOrders">,
    ...(previewWarehouse !== "" ? { warehouseId: previewWarehouse as Id<"warehouses"> } : {}),
  });
  const confirm = useMutation(api.sales.orders.confirm);
  const reserve = useMutation(api.sales.orders.reserve);
  const createInvoice = useMutation(api.sales.invoices.createFromOrder);
  const close = useMutation(api.sales.orders.close);
  const cancel = useMutation(api.sales.orders.cancel);
  const slips = useQuery(api.sales.deliveries.forOrder, {
    salesOrderId: salesOrderId as Id<"salesOrders">,
  });
  const billing = useQuery(api.sales.invoices.forOrder, {
    salesOrderId: salesOrderId as Id<"salesOrders">,
  });
  const router = useRouter();
  const canCreate = useCan("sales", "create");
  const canEdit = useCan("sales", "edit");
  const [error, setError] = useState<string | null>(null);
  usePageLabel(detail?.order.docNumber);
  const covers = useProductCovers((detail?.lines ?? []).map((line) => line.productId));

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Order not found" description="That order is not on file." />;
  }

  const { order } = detail;
  const warehouseId = order.warehouseId ?? previewWarehouse;
  const money = (amount: number) =>
    `${formatUnitPrice(amount, order.decimalPlaces)} ${order.currency}`;
  const open =
    order.status === "draft" || order.status === "confirmed" || order.status === "fulfilling";
  const short = detail.lines.some((line) => line.backorder);
  const shipTo = addressText(order.shipTo);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await work();
      toast.success(done);
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  return (
    <div className="space-y-8">
      <SalesDocFlow salesOrderId={order._id} />
      <PageHeader
        title={order.docNumber}
        description={
          order.warehouseCode !== ""
            ? `${order.warehouseCode} · ${order.warehouseName}`
            : "Choose a warehouse before confirming."
        }
        actions={
          <Badge color={statusColor(order.status)} size="md">
            {orderStatusLabel(order.status)}
          </Badge>
        }
      />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeaderField label="Customer">
          <Link href={`/sales/customers/${order.customerId}`} className="hover:underline">
            {order.customerName}
          </Link>
          <span className="text-tertiary block text-xs">{order.customerCode}</span>
          {order.customerStatus === "onHold" ? (
            <Badge color="warning" size="sm" className="mt-2">
              On hold
            </Badge>
          ) : null}
          {order.customerStatus === "closed" ? (
            <Badge color="error" size="sm" className="mt-2">
              Closed
            </Badge>
          ) : null}
        </HeaderField>
        <HeaderField label="Ship to">{shipTo ?? "No ship-to address"}</HeaderField>
        <HeaderField label="Terms">{paymentTermsLabel(order.paymentTermsDays)}</HeaderField>
        <HeaderField label="Channel">
          <Badge color={channelColor(order.channel)} size="sm">
            {orderChannelLabel(order.channel)}
          </Badge>
        </HeaderField>
      </section>
      {error ? <FormAlert title="Couldn't update the order" message={error} /> : null}
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Order actions">
        {canCreate && order.status === "draft" ? (
          <div className="w-64">
            <Select
              aria-label="Warehouse"
              label="Warehouse"
              placeholder="Choose a warehouse"
              items={active.map((row) => ({
                id: row._id as string,
                label: `${row.code} · ${row.name}`,
              }))}
              value={warehouseId === "" ? null : warehouseId}
              onChange={(key) => setPicked(key == null ? "" : String(key))}
            >
              {(item) => (
                <Select.Item id={item.id} key={item.id}>
                  {item.label}
                </Select.Item>
              )}
            </Select>
          </div>
        ) : null}
        {canCreate && order.status === "draft" ? (
          <Button
            color="primary"
            isDisabled={warehouseId === ""}
            onPress={() =>
              void run(
                () =>
                  confirm({
                    salesOrderId: order._id,
                    warehouseId: warehouseId as Id<"warehouses">,
                  }),
                "Order confirmed",
              )
            }
          >
            Confirm
          </Button>
        ) : null}
        {canEdit && short && (order.status === "confirmed" || order.status === "fulfilling") ? (
          <Button
            color="secondary"
            onPress={() => void run(() => reserve({ salesOrderId: order._id }), "Stock reserved")}
          >
            Reserve available
          </Button>
        ) : null}
        {canCreate && billing?.billable ? (
          <Button
            color="primary"
            onPress={() =>
              void run(async () => {
                const id = await createInvoice({
                  salesOrderId: order._id,
                  invoiceOn: priceDayLabel(Date.now()),
                });
                router.push(`/sales/invoices/${id}`);
              }, "Invoice drafted")
            }
          >
            Invoice
          </Button>
        ) : null}
        {canCreate && order.status === "invoiced" ? (
          <Button
            color="primary"
            onPress={() => void run(() => close({ salesOrderId: order._id }), "Order closed")}
          >
            Close
          </Button>
        ) : null}
        {canCreate && open ? (
          <Button
            color="secondary"
            onPress={() => void run(() => cancel({ salesOrderId: order._id }), "Order cancelled")}
          >
            Cancel
          </Button>
        ) : null}
      </div>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
          <p className="text-tertiary text-sm">Net</p>
          <p className="text-primary text-md font-semibold tabular-nums">
            {money(detail.totals.net)}
          </p>
        </div>
        <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
          <p className="text-tertiary text-sm">Tax</p>
          <p className="text-primary text-md font-semibold tabular-nums">
            {money(detail.totals.tax)}
          </p>
        </div>
        <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
          <p className="text-tertiary text-sm">Total</p>
          <p className="text-primary text-md font-semibold tabular-nums">
            {money(detail.totals.gross)}
          </p>
        </div>
      </section>
      <ul className="divide-secondary divide-y">
        {detail.lines.map((line) => {
          const priced =
            line.liveUnitPrice !== null && Math.abs(line.liveUnitPrice - line.unitPrice) > 1e-6;
          return (
            <li key={line._id} className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0">
                <ProductIdentity name={line.description} src={covers.get(line.productId) ?? null} />
                <p className="text-tertiary mt-1 text-sm">
                  {line.sku} · {formatQty(line.qty)} × {money(line.unitPrice)} · reserved{" "}
                  {formatQty(line.reservedQty)} · shipped {formatQty(line.fulfilledQty)}
                </p>
                <p className="text-secondary mt-1 text-sm">
                  {line.liveUnitPrice === null
                    ? "No current price"
                    : priced
                      ? `Today ${money(line.liveUnitPrice)}`
                      : "Today's price matches"}
                  {line.marginPercent === null ? "" : ` · margin ${line.marginPercent.toFixed(1)}%`}
                </p>
                <p className="text-tertiary mt-1 text-sm">
                  {line.available === null || line.onHand === null
                    ? "Choose a warehouse to see what is free."
                    : `${formatQty(line.available)} available · ${formatQty(line.onHand)} on hand${
                        order.warehouseCode !== "" ? ` at ${order.warehouseCode}` : ""
                      }`}
                </p>
                {line.backorder ? (
                  <Badge color="warning" size="sm" className="mt-2">
                    Backorder
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <p className="text-primary text-sm font-medium tabular-nums">{money(line.gross)}</p>
                {canEdit &&
                (order.status === "confirmed" || order.status === "fulfilling") &&
                packableQty(line.reservedQty, packedQty(slips, line._id)) > 0 ? (
                  <PackLine
                    key={`${line._id}:${line.reservedQty}`}
                    salesOrderId={order._id}
                    lineId={line._id}
                    packable={packableQty(line.reservedQty, packedQty(slips, line._id))}
                    onError={setError}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canCreate ? (
        <ReturnRequestForm
          source="order"
          salesOrderId={order._id}
          lines={detail.lines.map((line) => ({
            _id: line._id,
            description: line.description,
            sku: line.sku,
          }))}
        />
      ) : null}
    </div>
  );
}

function HeaderField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
      <p className="text-tertiary text-sm">{label}</p>
      <div className="text-primary mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}

function packedQty(
  slips:
    | {
        status: "packed" | "shipped" | "cancelled";
        lines: { salesOrderLineId: Id<"salesOrderLines">; qty: number }[];
      }[]
    | undefined,
  lineId: Id<"salesOrderLines">,
): number {
  if (slips === undefined) return 0;
  let packed = 0;
  for (const slip of slips) {
    if (slip.status !== "packed") continue;
    for (const line of slip.lines) {
      if (line.salesOrderLineId === lineId) packed += line.qty;
    }
  }
  return packed;
}

function PackLine({
  salesOrderId,
  lineId,
  packable,
  onError,
}: {
  salesOrderId: Id<"salesOrders">;
  lineId: Id<"salesOrderLines">;
  packable: number;
  onError: (message: string | null) => void;
}) {
  const pack = useMutation(api.sales.deliveries.pack);
  const router = useRouter();
  const [qty, setQty] = useState(String(packable));
  return (
    <div className="flex items-end gap-2">
      <Input
        aria-label="Quantity to pack"
        label="Pack"
        size="sm"
        type="number"
        value={qty}
        onChange={setQty}
        className="w-24"
      />
      <Button
        color="primary"
        size="sm"
        onPress={() => {
          onError(null);
          const amount = Number(qty);
          void pack({ salesOrderId, lines: [{ lineId, qty: amount }] })
            .then((id) => {
              toast.success("Packed");
              router.push(`/sales/deliveries/${id}`);
            })
            .catch((err: unknown) => onError(toUserMessage(err)));
        }}
      >
        Pack
      </Button>
    </div>
  );
}
