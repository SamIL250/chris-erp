"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ProductIdentity } from "@/components/catalog/product-cover";
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
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";
import {
  billMatchIssues,
  vendorBillPriceError,
  vendorBillQtyError,
  vendorBillStatusColor,
  vendorBillStatusLabel,
} from "@/lib/vendorBills";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-tertiary text-sm">{label}</dt>
      <dd className="text-primary text-sm font-medium">{children}</dd>
    </div>
  );
}

function amount(value: number | null): string {
  return value === null ? "—" : String(value);
}

/** One vendor bill, with ordered, received, and billed side by side (PH2-23). */
export function VendorBillDetail({ vendorBillId }: { vendorBillId: Id<"vendorBills"> }) {
  const detail = useQuery(api.procurement.vendorBills.get, { vendorBillId });
  const updateLine = useMutation(api.procurement.vendorBills.updateLine);
  const match = useMutation(api.procurement.vendorBills.match);
  const canEdit = useCan("procurement", "edit");
  const canMatch = useCan("finance", "post");
  const [drafts, setDrafts] = useState<Record<string, { qty: string; price: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageLabel(detail?.docNumber);
  const covers = useProductCovers(detail?.lines.map((line) => line.productId) ?? []);

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Vendor bill" description="That bill doesn't exist." />;
  }

  const open = detail.status === "open";
  const money = (value: number) => `${formatUnitPrice(value, detail.decimalPlaces)} ${detail.currency}`;

  const saveLine = async (lineId: Id<"vendorBillLines">, qty: string, price: string) => {
    const quantity = Number(qty);
    const qtyError = vendorBillQtyError(quantity);
    if (qtyError !== null) {
      setError(qtyError);
      return;
    }
    const unitPrice = Number(price);
    const priceError = vendorBillPriceError(unitPrice);
    if (priceError !== null) {
      setError(priceError);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await updateLine({ vendorBillId, lineId, qty: quantity, unitPrice });
      toast.success("Line saved");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const matchBill = async () => {
    setError(null);
    setBusy(true);
    try {
      await match({ vendorBillId });
      toast.success("Bill matched");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={detail.docNumber}
        description={`${detail.vendorName} · ${money(detail.amount)}`}
        actions={
          <Badge color={vendorBillStatusColor(detail.status)} size="md">
            {vendorBillStatusLabel(detail.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the bill" message={error} /> : null}
      {open && canMatch ? (
        <Button color="primary" isLoading={busy} onPress={() => void matchBill()}>
          Match
        </Button>
      ) : null}
      {detail.status === "matched" ? (
        <p className="text-tertiary text-sm">Matched. Recording a payment is Phase 3.</p>
      ) : null}
      <dl className="bg-primary ring-primary grid gap-4 rounded-xl p-5 ring-1 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Vendor">{detail.vendorName}</Fact>
        <Fact label="Bill date">{priceDayLabel(detail.billDate)}</Fact>
        <Fact label="Vendor reference">{detail.reference ?? "—"}</Fact>
        <Fact label="Purchase order">
          {detail.purchaseOrderId !== null && detail.purchaseOrderNumber !== null ? (
            <Button color="link-color" href={`/procurement/purchase-orders/${detail.purchaseOrderId}`}>
              {detail.purchaseOrderNumber}
            </Button>
          ) : (
            "None"
          )}
        </Fact>
      </dl>
      <ul className="bg-primary ring-primary divide-secondary divide-y rounded-xl ring-1">
        {detail.lines.map((line) => {
          const draft = drafts[line._id] ?? { qty: String(line.qty), price: String(line.unitPrice) };
          const issues = billMatchIssues({
            orderedQty: line.orderedQty,
            receivedQty: line.receivedQty,
            billedQty: line.qty,
            orderPrice: line.orderPrice,
            billPrice: line.unitPrice,
          });
          return (
            <li key={line._id} className="space-y-3 px-5 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <ProductIdentity
                  name={line.description}
                  meta={line.sku}
                  src={covers.get(line.productId) ?? null}
                />
                <p className="text-primary text-sm">{money(line.gross)}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Fact label="Ordered">{amount(line.orderedQty)}</Fact>
                <Fact label="Received">{amount(line.receivedQty)}</Fact>
                <Fact label="Billed">{line.qty}</Fact>
                <Fact label="Order price">
                  {line.orderPrice === null ? "—" : money(line.orderPrice)}
                </Fact>
                <Fact label="Bill price">{money(line.unitPrice)}</Fact>
              </dl>
              {issues.length > 0 ? (
                <ul className="text-warning text-sm">
                  {issues.map((issue) => (
                    <li key={issue.message}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}
              {open && canEdit ? (
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    label="Billed quantity"
                    type="number"
                    value={draft.qty}
                    onChange={(value) =>
                      setDrafts((current) => ({ ...current, [line._id]: { ...draft, qty: value } }))
                    }
                  />
                  <Input
                    label="Unit price"
                    type="number"
                    value={draft.price}
                    onChange={(value) =>
                      setDrafts((current) => ({
                        ...current,
                        [line._id]: { ...draft, price: value },
                      }))
                    }
                  />
                  <Button
                    color="secondary"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => void saveLine(line._id, draft.qty, draft.price)}
                  >
                    Save
                  </Button>
                </div>
              ) : null}
              <p className="text-tertiary text-sm">
                Net {money(line.net)} · Tax {money(line.tax)} · Gross {money(line.gross)}
              </p>
            </li>
          );
        })}
      </ul>
      <dl className="bg-primary ring-primary grid gap-4 rounded-xl p-5 ring-1 sm:grid-cols-3">
        <Fact label="Net">{money(detail.totals.net)}</Fact>
        <Fact label="Tax">{money(detail.totals.tax)}</Fact>
        <Fact label="Total">{money(detail.totals.gross)}</Fact>
      </dl>
    </div>
  );
}
