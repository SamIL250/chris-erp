"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { FormAlert } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";

type Line = { _id: string; description: string; sku: string };

/** Request a return from a posted invoice or a shipped order (PH2-18). */
export function ReturnRequestForm(
  props:
    | { source: "invoice"; invoiceId: Id<"salesInvoices">; lines: Line[] }
    | { source: "order"; salesOrderId: Id<"salesOrders">; lines: Line[] },
) {
  const invoiceBilling = useQuery(
    api.sales.salesReturns.forInvoice,
    props.source === "invoice" ? { invoiceId: props.invoiceId } : "skip",
  );
  const orderBilling = useQuery(
    api.sales.salesReturns.forOrder,
    props.source === "order" ? { salesOrderId: props.salesOrderId } : "skip",
  );
  const createFromInvoice = useMutation(api.sales.salesReturns.createFromInvoice);
  const createFromOrder = useMutation(api.sales.salesReturns.createFromOrder);
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const billing = props.source === "invoice" ? invoiceBilling : orderBilling;
  if (billing === undefined) return null;
  const remaining = new Map<string, number>();
  if (props.source === "invoice") {
    for (const row of invoiceBilling?.remaining ?? []) remaining.set(row.invoiceLineId, row.qty);
  } else {
    for (const row of orderBilling?.remaining ?? []) remaining.set(row.salesOrderLineId, row.qty);
  }
  const open = props.lines.filter((line) => (remaining.get(line._id) ?? 0) > 0);
  if (open.length === 0) return null;

  const request = async () => {
    setError(null);
    try {
      const lines = open.map((line) => ({
        qty: Number(qty[line._id] ?? remaining.get(line._id) ?? 0),
      }));
      const id =
        props.source === "invoice"
          ? await createFromInvoice({
              invoiceId: props.invoiceId,
              reason,
              lines: open.map((line, index) => ({
                invoiceLineId: line._id as Id<"salesInvoiceLines">,
                qty: lines[index]?.qty ?? 0,
              })),
            })
          : await createFromOrder({
              salesOrderId: props.salesOrderId,
              reason,
              lines: open.map((line, index) => ({
                salesOrderLineId: line._id as Id<"salesOrderLines">,
                qty: lines[index]?.qty ?? 0,
              })),
            });
      toast.success("Return requested");
      router.push(`/sales/returns/${id}`);
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  return (
    <section className="space-y-4" aria-label="Request a return">
      <h2 className="text-primary text-md font-semibold">Request a return</h2>
      {error ? <FormAlert title="Couldn't request the return" message={error} /> : null}
      <Input
        aria-label="Reason"
        label="Reason"
        size="sm"
        value={reason}
        onChange={setReason}
        className="max-w-xl"
      />
      <ul className="divide-secondary divide-y">
        {open.map((line) => (
          <li key={line._id} className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-primary text-sm font-medium">{line.description}</p>
              <p className="text-tertiary text-sm">{line.sku}</p>
            </div>
            <Input
              aria-label={`Quantity for ${line.description}`}
              label="Qty"
              size="sm"
              value={qty[line._id] ?? String(remaining.get(line._id) ?? 0)}
              onChange={(value) => setQty((current) => ({ ...current, [line._id]: value }))}
              className="w-28"
            />
          </li>
        ))}
      </ul>
      <Button color="primary" onPress={() => void request()}>
        Request return
      </Button>
    </section>
  );
}
