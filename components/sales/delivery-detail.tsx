"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { SalesDocFlow } from "@/components/shared/doc-flow";
import { usePageLabel } from "@/components/shared/page-label";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { useProductCovers } from "@/hooks/use-product-covers";
import { deliveryPdf } from "@/lib/deliveryPdf";
import { pdfCompany } from "@/lib/pdfKit";
import { deliveryStatusLabel, type DeliveryStatus } from "@/lib/deliveries";
import { toUserMessage } from "@/lib/errors";
import { formatQty } from "@/lib/inventory-display";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";

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

/** One packing slip: confirm the pack, then ship with a date, carrier, and tracking number. */
export function DeliveryDetail({ deliveryId }: { deliveryId: string }) {
  const detail = useQuery(api.sales.deliveries.get, {
    deliveryId: deliveryId as Id<"deliveries">,
  });
  const org = useQuery(api.organization.get, {});
  const billing = useQuery(api.sales.invoices.forDelivery, {
    deliveryId: deliveryId as Id<"deliveries">,
  });
  const ship = useMutation(api.sales.deliveries.ship);
  const cancel = useMutation(api.sales.deliveries.cancel);
  const createInvoice = useMutation(api.sales.invoices.createFromDelivery);
  const router = useRouter();
  const canEdit = useCan("sales", "edit");
  const canCreate = useCan("sales", "create");
  const [shippedOn, setShippedOn] = useState(() => priceDayLabel(Date.now()));
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  usePageLabel(detail?.delivery.docNumber);
  const covers = useProductCovers((detail?.lines ?? []).map((line) => line.productId));

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return (
      <PageHeader title="Delivery not found" description="That packing slip is not on file." />
    );
  }

  const { delivery } = detail;
  const money = (amount: number) =>
    `${formatUnitPrice(amount, detail.decimalPlaces)} ${detail.currency}`;

  const download = async () => {
    const company = await pdfCompany(org, "Company");
    const bytes = await deliveryPdf({
      companyName: company.companyName,
      logo: company.logo,
      footer: company.footer,
      docNumber: delivery.docNumber,
      status: delivery.status,
      orderNumber: delivery.orderNumber,
      customerName: delivery.customerName,
      customerCode: detail.customerCode,
      warehouseCode: delivery.warehouseCode,
      warehouseName: delivery.warehouseName,
      shipTo: addressText(detail.shipTo),
      shippedOn: delivery.shippedAt === null ? null : priceDayLabel(delivery.shippedAt),
      carrier: delivery.carrier,
      trackingNumber: delivery.trackingNumber,
      lines: detail.lines.map((line) => ({
        description: line.description,
        sku: line.sku,
        qty: line.qty,
      })),
    });
    const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${delivery.docNumber}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
      <SalesDocFlow deliveryId={delivery._id} />
      <PageHeader
        title={delivery.docNumber}
        description={`${delivery.warehouseCode} · ${delivery.warehouseName} · ${delivery.customerName}`}
        actions={
          <Badge color={statusColor(delivery.status)} size="md">
            {deliveryStatusLabel(delivery.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the delivery" message={error} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button color="secondary" onPress={() => void download()}>
          Download PDF
        </Button>
        {canCreate && billing?.billable ? (
          <Button
            color="primary"
            onPress={() =>
              void run(async () => {
                const id = await createInvoice({
                  deliveryId: delivery._id,
                  invoiceOn: priceDayLabel(Date.now()),
                });
                router.push(`/sales/invoices/${id}`);
              }, "Invoice drafted")
            }
          >
            Invoice
          </Button>
        ) : null}
      </div>
      {delivery.status === "shipped" ? (
        <section className="grid gap-4 sm:grid-cols-3">
          <Fact label="Shipped">
            {delivery.shippedAt === null ? "—" : priceDayLabel(delivery.shippedAt)}
          </Fact>
          <Fact label="Carrier">{delivery.carrier ?? "—"}</Fact>
          <Fact label="Tracking">{delivery.trackingNumber ?? "—"}</Fact>
        </section>
      ) : null}
      {delivery.status === "packed" && canEdit ? (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Ship delivery">
          <Input
            aria-label="Ship date"
            label="Ship date"
            type="date"
            size="sm"
            value={shippedOn}
            onChange={setShippedOn}
            className="w-44"
          />
          <Input
            aria-label="Carrier"
            label="Carrier"
            size="sm"
            value={carrier}
            onChange={setCarrier}
            className="w-48"
          />
          <Input
            aria-label="Tracking number"
            label="Tracking number"
            size="sm"
            value={trackingNumber}
            onChange={setTrackingNumber}
            className="w-48"
          />
          <Button
            color="primary"
            onPress={() =>
              void run(
                () =>
                  ship({
                    deliveryId: delivery._id,
                    shippedOn,
                    carrier,
                    trackingNumber,
                  }),
                "Shipped",
              )
            }
          >
            Ship
          </Button>
          <Button
            color="secondary"
            onPress={() =>
              void run(() => cancel({ deliveryId: delivery._id }), "Packing slip cancelled")
            }
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {detail.intent !== null ? (
        <p className="text-secondary text-sm">
          Cost of goods {money(detail.intent.amount)} · {detail.intent.period} · pending
        </p>
      ) : null}
      <ul className="divide-secondary divide-y">
        {detail.lines.map((line) => (
          <li key={line._id} className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="min-w-0">
              <ProductIdentity name={line.description} src={covers.get(line.productId) ?? null} />
              <p className="text-tertiary mt-1 text-sm">
                {line.sku} · {formatQty(line.qty)}
                {line.unitCost === undefined ? "" : ` · unit cost ${money(line.unitCost)}`}
              </p>
            </div>
            <Link
              href={`/sales/orders/${delivery.salesOrderId}`}
              className="text-secondary text-sm hover:underline"
            >
              {delivery.orderNumber}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function addressText(
  address: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country: string;
  } | null,
): string | null {
  if (address === null) return null;
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ].filter((part) => part !== undefined && part !== "");
  return parts.length === 0 ? null : parts.join(", ");
}

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
      <p className="text-tertiary text-sm">{label}</p>
      <p className="text-primary mt-1 text-sm font-medium">{children}</p>
    </div>
  );
}
