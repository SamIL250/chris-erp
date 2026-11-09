"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { priceDay, priceDayLabel } from "@/lib/pricing";

function defaultValidUntil(): string {
  const today = priceDay(Date.now());
  if (today === null) return "";
  return priceDayLabel(today + 30 * 86_400_000);
}

/** Open a draft quote for a company (PH2-11). */
export function QuoteCreate() {
  const router = useRouter();
  const customers = useQuery(api.sales.customers.list, {});
  const create = useMutation(api.sales.quotes.create);
  const [customerId, setCustomerId] = useState<string>("");
  const [validUntil, setValidUntil] = useState(defaultValidUntil);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (customers === undefined) return <Skeleton className="h-80" />;

  const open = customers.filter((row) => row.status !== "closed");
  const save = async () => {
    if (customerId === "") {
      setError("Choose a customer.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const quoteId = await create({
        customerId: customerId as Id<"customers">,
        validUntil,
        notes: notes.trim() === "" ? null : notes,
      });
      router.push(`/sales/quotes/${quoteId}`);
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="New quote"
        description="A draft for one company. Lines, tax, and a discount come next."
      />
      {error ? <FormAlert title="Couldn't open the quote" message={error} /> : null}
      {open.length === 0 ? (
        <p className="text-tertiary text-sm">Add a customer before writing a quote.</p>
      ) : (
        <div className="bg-primary ring-primary space-y-5 rounded-xl p-5 ring-1">
          <Select
            label="Customer"
            placeholder="Choose a customer"
            items={open.map((row) => ({ id: row._id, label: `${row.name} · ${row.code}` }))}
            value={customerId === "" ? null : customerId}
            onChange={(key) => setCustomerId(key == null ? "" : String(key))}
          >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
          <Input
            label="Valid until"
            type="date"
            value={validUntil}
            onChange={setValidUntil}
            hint="The quote is good through this day."
          />
          <TextArea label="Notes" value={notes} onChange={setNotes} rows={3} />
          <div className="flex justify-end">
            <Button color="primary" isLoading={busy} onPress={() => void save()}>
              Create quote
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
