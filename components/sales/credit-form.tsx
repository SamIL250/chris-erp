"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { FormAlert } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { creditKindLabel, type CreditKind } from "@/lib/creditNotes";
import { toUserMessage } from "@/lib/errors";
import { priceDayLabel } from "@/lib/pricing";

type InvoiceLine = {
  _id: Id<"salesInvoiceLines">;
  description: string;
  sku: string;
};

const KINDS: { id: CreditKind; label: string }[] = [
  { id: "return", label: creditKindLabel("return") },
  { id: "adjustment", label: creditKindLabel("adjustment") },
];

/** Draft a credit against one invoice (PH2-17). */
export function CreditForm({
  invoiceId,
  lines,
}: {
  invoiceId: Id<"salesInvoices">;
  lines: InvoiceLine[];
}) {
  const billing = useQuery(api.sales.creditNotes.forInvoice, { invoiceId });
  const create = useMutation(api.sales.creditNotes.create);
  const router = useRouter();
  const [kind, setKind] = useState<CreditKind>("return");
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState("");
  const [creditOn, setCreditOn] = useState(() => priceDayLabel(Date.now()));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (billing === undefined) return null;
  const remaining = new Map(billing.remaining.map((row) => [row.invoiceLineId, row.qty]));
  const open = lines.filter((line) => (remaining.get(line._id) ?? 0) > 0);
  if (open.length === 0) return null;

  const draft = async () => {
    setError(null);
    try {
      const id = await create({
        invoiceId,
        creditOn,
        kind,
        restock: kind === "return" && restock,
        reason,
        lines: open.map((line) => ({
          invoiceLineId: line._id,
          qty: Number(qty[line._id] ?? remaining.get(line._id) ?? 0),
        })),
      });
      toast.success("Credit drafted");
      router.push(`/sales/credit-notes/${id}`);
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  return (
    <section className="space-y-4" aria-label="Credit this invoice">
      <h2 className="text-primary text-md font-semibold">Credit this invoice</h2>
      {error ? <FormAlert title="Couldn't draft the credit" message={error} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            aria-label="Kind"
            label="Kind"
            items={KINDS}
            value={kind}
            onChange={(key) => {
              if (key === "return" || key === "adjustment") setKind(key);
            }}
          >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
        </div>
        <Input
          aria-label="Credit date"
          label="Credit date"
          type="date"
          size="sm"
          value={creditOn}
          onChange={setCreditOn}
          className="w-44"
        />
        <Input
          aria-label="Reason"
          label="Reason"
          size="sm"
          value={reason}
          onChange={setReason}
          className="min-w-64 flex-1"
        />
      </div>
      <Checkbox
        isSelected={kind === "return" && restock}
        isDisabled={kind !== "return"}
        onChange={setRestock}
        label="Put the goods back in stock"
        hint={
          kind === "return"
            ? "A return can go back to the order's warehouse. Leave this off when the customer keeps the goods."
            : "An adjustment only changes what the customer owes."
        }
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
      <Button color="primary" onPress={() => void draft()}>
        Draft credit
      </Button>
    </section>
  );
}
