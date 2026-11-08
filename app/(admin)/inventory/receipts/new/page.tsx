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

/** Post a manual goods receipt (PH1-23). */
export default function NewReceiptPage() {
  const router = useRouter();
  const create = useMutation(api.inventory.goodsReceipts.create);
  const warehouses = useQuery(api.inventory.warehouses.list);
  const products = useQuery(api.catalog.products.picker, { search: "" });
  const [warehouseId, setWarehouseId] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = (warehouses ?? []).filter((row) => row.active);

  const save = async () => {
    setError(null);
    if (warehouseId === "") {
      setError("Choose the warehouse these goods arrived at.");
      return;
    }
    if (referenceNote.trim() === "") {
      setError("Add a reference note.");
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
      const unitCost = line.unitCost.trim() === "" ? undefined : Number(line.unitCost);
      if (unitCost !== undefined && !Number.isFinite(unitCost)) {
        setError("Unit cost must be a number.");
        return;
      }
      parsed.push({
        productId: line.productId as Id<"products">,
        ...(line.variantId === "" ? {} : { variantId: line.variantId as Id<"variants"> }),
        qty,
        ...(unitCost === undefined ? {} : { unitCost }),
      });
    }
    setBusy(true);
    try {
      const id = await create({
        warehouseId: warehouseId as Id<"warehouses">,
        referenceNote,
        lines: parsed,
      });
      toast.success("Receipt posted");
      router.push(`/inventory/receipts/${id}`);
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New receipt"
        description="Goods go on hand as soon as you post. The note is the delivery slip, the opening balance, or whatever explains the intake."
      />
      {error ? <FormAlert message={error} /> : null}
      <Select
        aria-label="Warehouse"
        label="Warehouse"
        placeholder="Where the goods arrived"
        items={active.map((row) => ({ id: row._id as string, label: `${row.code} · ${row.name}` }))}
        value={warehouseId}
        onChange={(key) => setWarehouseId(key == null ? "" : String(key))}
      >
        {(item) => (
          <Select.Item id={item.id} key={item.id}>
            {item.label}
          </Select.Item>
        )}
      </Select>
      <TextArea
        label="Reference note"
        placeholder="Delivery note 441"
        hint="Required. Up to 500 characters."
        rows={3}
        value={referenceNote}
        onChange={setReferenceNote}
      />
      <DocumentLines lines={lines} products={products} onChange={setLines} showCost />
      <div className="flex justify-end gap-3">
        <Button color="secondary" href="/inventory/receipts">
          Cancel
        </Button>
        <Button color="primary" isLoading={busy} onPress={() => void save()}>
          Post receipt
        </Button>
      </div>
    </div>
  );
}
