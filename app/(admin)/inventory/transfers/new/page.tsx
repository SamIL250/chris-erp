"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentLines, emptyLine, type DraftLine } from "@/components/inventory/document-lines";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";

/** New draft transfer (PH1-23). Shipping happens on the document page. */
export default function NewTransferPage() {
  const router = useRouter();
  const create = useMutation(api.inventory.transfers.create);
  const warehouses = useQuery(api.inventory.warehouses.list);
  const products = useQuery(api.catalog.products.picker, { search: "" });
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = (warehouses ?? []).filter((row) => row.active);
  const items = active.map((row) => ({
    id: row._id as string,
    label: `${row.code} · ${row.name}`,
  }));

  const save = async () => {
    setError(null);
    if (fromWarehouseId === "" || toWarehouseId === "") {
      setError("Choose the source and the destination.");
      return;
    }
    const parsed = [];
    for (const line of lines) {
      if (line.productId === "") {
        setError("Choose a product on every line.");
        return;
      }
      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError("Every line needs a quantity greater than zero.");
        return;
      }
      parsed.push({
        productId: line.productId as Id<"products">,
        ...(line.variantId === "" ? {} : { variantId: line.variantId as Id<"variants"> }),
        qty,
      });
    }
    setBusy(true);
    try {
      const id = await create({
        fromWarehouseId: fromWarehouseId as Id<"warehouses">,
        toWarehouseId: toWarehouseId as Id<"warehouses">,
        ...(note.trim() === "" ? {} : { note }),
        lines: parsed,
      });
      toast.success("Transfer drafted");
      router.push(`/inventory/transfers/${id}`);
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New transfer"
        description="A draft holds no stock. Shipping takes the goods off the source warehouse."
      />
      {error ? <FormAlert message={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          aria-label="From warehouse"
          label="From"
          placeholder="Source"
          items={items}
          value={fromWarehouseId}
          onChange={(key) => setFromWarehouseId(key == null ? "" : String(key))}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id}>
              {item.label}
            </Select.Item>
          )}
        </Select>
        <Select
          aria-label="To warehouse"
          label="To"
          placeholder="Destination"
          items={items}
          value={toWarehouseId}
          onChange={(key) => setToWarehouseId(key == null ? "" : String(key))}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      </div>
      <TextArea
        label="Note"
        placeholder="Optional"
        hint="Shown on the transfer. Not required."
        rows={3}
        value={note}
        onChange={setNote}
      />
      <DocumentLines lines={lines} products={products} onChange={setLines} />
      <div className="flex justify-end gap-3">
        <Button color="secondary" href="/inventory/transfers">
          Cancel
        </Button>
        <Button color="primary" isLoading={busy} onPress={() => void save()}>
          Save draft
        </Button>
      </div>
    </div>
  );
}
