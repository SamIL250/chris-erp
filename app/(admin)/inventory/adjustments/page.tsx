"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
import { ImageUpload } from "@/components/ui/image-upload";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";

type Reason = "damage" | "countCorrection" | "writeOff" | "found";

const REASONS: { id: Reason; label: string; hint: string }[] = [
  { id: "damage", label: "Damage", hint: "Removes the quantity from the shelf." },
  { id: "writeOff", label: "Write-off", hint: "Removes the quantity from the shelf." },
  { id: "found", label: "Found", hint: "Adds the quantity to the shelf." },
  {
    id: "countCorrection",
    label: "Count correction",
    hint: "Adds or removes, whichever way the count was off.",
  },
];

/**
 * Manual adjustment (PH1-23). The reason fixes the sign. A removal cannot
 * take units that are still reserved — the server enforces that.
 */
export default function AdjustmentsPage() {
  const router = useRouter();
  const canApprove = useCan("inventory", "approve");
  const adjust = useMutation(api.inventory.stock.adjust);
  const warehouses = useQuery(api.inventory.warehouses.list);
  const products = useQuery(api.catalog.products.picker, { search: "" });
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [reason, setReason] = useState<Reason>("countCorrection");
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [photoFileId, setPhotoFileId] = useState<Id<"files"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const variants = useQuery(
    api.catalog.variants.list,
    productId === "" ? "skip" : { productId: productId as Id<"products"> },
  );
  const active = (warehouses ?? []).filter((row) => row.active);
  const reasonHint = REASONS.find((item) => item.id === reason)?.hint;

  const save = async () => {
    setError(null);
    if (!canApprove) {
      setError("You don't have permission to approve inventory items.");
      return;
    }
    if (warehouseId === "" || productId === "") {
      setError("Choose a warehouse and a product.");
      return;
    }
    if ((variants?.length ?? 0) > 0 && variantId === "") {
      setError("This product has variants — name the variant this count is for.");
      return;
    }
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    const signed =
      reason === "found" || (reason === "countCorrection" && direction === "add")
        ? amount
        : -amount;
    setBusy(true);
    try {
      await adjust({
        warehouseId: warehouseId as Id<"warehouses">,
        productId: productId as Id<"products">,
        ...(variantId === "" ? {} : { variantId: variantId as Id<"variants"> }),
        qty: signed,
        reason,
        ...(note.trim() === "" ? {} : { note }),
        ...(photoFileId === null ? {} : { photoFileId }),
      });
      toast.success("Adjustment posted");
      router.push(`/inventory/stock/${productId}?warehouse=${warehouseId}`);
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Adjustment"
        description="Correct a count. Damage and write-off leave the shelf. Found stock arrives. A removal stops at what is still reserved."
      />
      {canApprove ? null : (
        <FormAlert
          title="Read only"
          message="Posting an adjustment needs permission to approve inventory. You can still read stock."
        />
      )}
      {error ? <FormAlert message={error} /> : null}
      <Select
        aria-label="Warehouse"
        label="Warehouse"
        placeholder="Choose a warehouse"
        items={active.map((row) => ({ id: row._id as string, label: `${row.code} · ${row.name}` }))}
        value={warehouseId}
        onChange={(key) => setWarehouseId(key == null ? "" : String(key))}
        isDisabled={!canApprove}
      >
        {(item) => (
          <Select.Item id={item.id} key={item.id}>
            {item.label}
          </Select.Item>
        )}
      </Select>
      <Select
        aria-label="Product"
        label="Product"
        placeholder="Choose a product"
        items={(products ?? []).map((row) => ({ id: row._id, label: `${row.name} · ${row.sku}` }))}
        value={productId}
        onChange={(key) => {
          setProductId(key == null ? "" : String(key));
          setVariantId("");
        }}
        isDisabled={!canApprove}
      >
        {(item) => (
          <Select.Item id={item.id} key={item.id}>
            {item.label}
          </Select.Item>
        )}
      </Select>
      {variants !== undefined && variants.length > 0 ? (
        <Select
          aria-label="Variant"
          label="Variant"
          placeholder="Choose a variant"
          items={variants.map((variant) => ({
            id: variant._id,
            label: variant.optionValues.map((option) => option.value).join(" / ") || variant.sku,
          }))}
          value={variantId}
          onChange={(key) => setVariantId(key == null ? "" : String(key))}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      ) : null}
      <Select
        aria-label="Reason"
        label="Reason"
        hint={reasonHint}
        items={REASONS.map((item) => ({ id: item.id, label: item.label }))}
        value={reason}
        onChange={(key) => setReason((key == null ? "countCorrection" : String(key)) as Reason)}
        isDisabled={!canApprove}
      >
        {(item) => (
          <Select.Item id={item.id} key={item.id}>
            {item.label}
          </Select.Item>
        )}
      </Select>
      {reason === "countCorrection" ? (
        <Select
          aria-label="Direction"
          label="Direction"
          items={[
            { id: "remove", label: "Remove from the shelf" },
            { id: "add", label: "Add to the shelf" },
          ]}
          value={direction}
          onChange={(key) => setDirection(key === "add" ? "add" : "remove")}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      ) : null}
      <Input
        label="Quantity"
        type="number"
        inputMode="decimal"
        placeholder="1"
        hint="A positive amount. The reason decides whether it is added or removed."
        value={qty}
        onChange={setQty}
        isDisabled={!canApprove}
      />
      <TextArea
        label="Note"
        placeholder="What you saw"
        hint="Optional. Up to 500 characters."
        rows={3}
        value={note}
        onChange={setNote}
        isDisabled={!canApprove}
      />
      <ImageUpload
        label="Photo"
        hint="Optional. A picture of the damage, the count, or the units you found."
        kind="adjustmentPhoto"
        onChange={(image) => setPhotoFileId(image?.fileId ?? null)}
        disabled={!canApprove}
      />
      <div className="flex justify-end">
        <Button
          color="primary"
          isLoading={busy}
          isDisabled={!canApprove}
          onPress={() => void save()}
        >
          Post adjustment
        </Button>
      </div>
    </div>
  );
}
