"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
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
import { toUserMessage } from "@/lib/errors";
import { formatQty } from "@/lib/inventory-display";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";
import {
  returnDispositionLabel,
  returnStatusLabel,
  type ReturnDisposition,
  type ReturnStatus,
} from "@/lib/salesReturns";

const DISPOSITIONS: { id: ReturnDisposition; label: string }[] = [
  { id: "restock", label: returnDispositionLabel("restock") },
  { id: "quarantine", label: returnDispositionLabel("quarantine") },
  { id: "writeOff", label: returnDispositionLabel("writeOff") },
];

function statusColor(status: ReturnStatus): "gray" | "brand" | "success" | "warning" | "error" {
  switch (status) {
    case "requested":
      return "warning";
    case "received":
      return "brand";
    case "credited":
    case "exchanged":
      return "success";
    case "cancelled":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function stockText(line: { disposition?: ReturnDisposition }): string {
  switch (line.disposition) {
    case undefined:
      return "Not received";
    case "restock":
      return "Back in stock";
    case "quarantine":
      return "Quarantined";
    case "writeOff":
      return "Written off";
    default: {
      const unreachable: never = line.disposition;
      return unreachable;
    }
  }
}

/** One return: receive it, then credit the invoice or open an exchange order. */
export function ReturnDetail({ salesReturnId }: { salesReturnId: string }) {
  const detail = useQuery(api.sales.salesReturns.get, {
    salesReturnId: salesReturnId as Id<"salesReturns">,
  });
  const receive = useMutation(api.sales.salesReturns.receive);
  const credit = useMutation(api.sales.salesReturns.credit);
  const exchange = useMutation(api.sales.salesReturns.exchange);
  const cancel = useMutation(api.sales.salesReturns.cancel);
  const canCreate = useCan("sales", "create");
  const [disposition, setDisposition] = useState<Record<string, ReturnDisposition>>({});
  const [creditOn, setCreditOn] = useState(() => priceDayLabel(Date.now()));
  const [error, setError] = useState<string | null>(null);
  usePageLabel(detail?.salesReturn.docNumber);
  const covers = useProductCovers((detail?.lines ?? []).map((line) => line.productId));

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Return not found" description="That return is not on file." />;
  }

  const { salesReturn } = detail;
  const money = (amount: number) =>
    `${formatUnitPrice(amount, salesReturn.decimalPlaces)} ${salesReturn.currency}`;

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
      <SalesDocFlow salesReturnId={salesReturn._id} />
      <PageHeader
        title={salesReturn.docNumber}
        description={`${salesReturn.customerName} · ${salesReturn.reason}`}
        actions={
          <Badge color={statusColor(salesReturn.status)} size="md">
            {returnStatusLabel(salesReturn.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the return" message={error} /> : null}
      {canCreate && salesReturn.status === "received" ? (
        <div className="flex flex-wrap items-end gap-3">
          {salesReturn.invoiceId !== null ? (
            <Input
              aria-label="Credit date"
              label="Credit date"
              type="date"
              size="sm"
              value={creditOn}
              onChange={setCreditOn}
              className="w-44"
            />
          ) : null}
          {salesReturn.invoiceId !== null ? (
            <Button
              color="primary"
              onPress={() =>
                void run(
                  () => credit({ salesReturnId: salesReturn._id, creditOn }),
                  "Credit posted",
                )
              }
            >
              Credit note
            </Button>
          ) : null}
          <Button
            color="secondary"
            onPress={() =>
              void run(() => exchange({ salesReturnId: salesReturn._id }), "Exchange drafted")
            }
          >
            Exchange
          </Button>
        </div>
      ) : null}
      {canCreate && salesReturn.status === "requested" ? (
        <Button
          color="secondary"
          onPress={() =>
            void run(() => cancel({ salesReturnId: salesReturn._id }), "Return cancelled")
          }
        >
          Cancel
        </Button>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-3">
        <Fact label="Requested">{priceDayLabel(salesReturn.createdAt)}</Fact>
        <Fact label="Reason">{salesReturn.reason}</Fact>
        <Fact label="Warehouse">
          {salesReturn.warehouseCode === null ? "Not received" : salesReturn.warehouseCode}
        </Fact>
      </section>
      <ul className="divide-secondary divide-y">
        {detail.lines.map((line) => (
          <li key={line._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <ProductIdentity
              name={line.description}
              meta={line.sku}
              src={covers.get(line.productId) ?? null}
            />
            <div className="flex items-center gap-3">
              <p className="text-secondary text-sm tabular-nums">
                {formatQty(line.qty)} × {money(line.unitPrice)}
              </p>
              {salesReturn.status === "requested" && canCreate ? (
                <div className="w-40">
                  <Select
                    aria-label={`Inspection for ${line.description}`}
                    label="Inspection"
                    items={DISPOSITIONS}
                    value={disposition[line._id] ?? "restock"}
                    onChange={(key) => {
                      if (key === "restock" || key === "quarantine" || key === "writeOff") {
                        setDisposition((current) => ({ ...current, [line._id]: key }));
                      }
                    }}
                  >
                    {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                  </Select>
                </div>
              ) : (
                <p className="text-primary text-sm">{stockText(line)}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canCreate && salesReturn.status === "requested" ? (
        <Button
          color="primary"
          onPress={() =>
            void run(
              () =>
                receive({
                  salesReturnId: salesReturn._id,
                  lines: detail.lines.map((line) => ({
                    salesReturnLineId: line._id,
                    disposition: disposition[line._id] ?? "restock",
                  })),
                }),
              "Return received",
            )
          }
        >
          Receive
        </Button>
      ) : null}
      {salesReturn.invoiceId !== null ? (
        <Link
          href={`/sales/invoices/${salesReturn.invoiceId}`}
          className="text-brand-secondary text-sm font-medium"
        >
          {salesReturn.invoiceNumber}
        </Link>
      ) : (
        <Link
          href={`/sales/orders/${salesReturn.salesOrderId}`}
          className="text-brand-secondary text-sm font-medium"
        >
          {salesReturn.orderNumber}
        </Link>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
      <p className="text-tertiary text-sm">{label}</p>
      <p className="text-primary mt-1 text-sm font-medium">{children}</p>
    </div>
  );
}
