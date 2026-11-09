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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { formatUnitPrice, priceDayFromInput } from "@/lib/pricing";
import { requisitionPriceError, requisitionQtyError } from "@/lib/requisitions";

type DraftLine = {
  key: string;
  productId: Id<"products">;
  variantId: Id<"variants"> | null;
  qty: number;
  unitPrice: number;
  label: string;
  sku: string;
};

/** A new internal requisition (PH2-20). Lines are collected, then saved together. */
export function RequisitionForm() {
  const router = useRouter();
  const create = useMutation(api.procurement.requisitions.create);
  const [needBy, setNeedBy] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const products = useQuery(api.catalog.products.picker, { search });
  const [productId, setProductId] = useState("");
  const variants = useQuery(
    api.catalog.variants.list,
    productId === "" ? "skip" : { productId: productId as Id<"products"> },
  );
  const [variantId, setVariantId] = useState("product");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const productItems = (products ?? []).map((row) => ({
    id: row._id,
    label: `${row.name} · ${row.sku}`,
  }));
  const variantItems = [
    { id: "product", label: "Product" },
    ...(variants ?? []).map((row) => ({ id: row._id, label: row.sku })),
  ];

  const addLine = () => {
    if (productId === "") {
      setError("Choose a product.");
      return;
    }
    if (variants === undefined) {
      setError("Wait for the variants to load.");
      return;
    }
    if (variants.length > 0 && variantId === "product") {
      setError("Name the variant.");
      return;
    }
    const quantity = Number(qty);
    const qtyError = requisitionQtyError(quantity);
    if (qtyError !== null) {
      setError(qtyError);
      return;
    }
    const price = Number(unitPrice);
    const priceError = requisitionPriceError(price);
    if (priceError !== null) {
      setError(priceError);
      return;
    }
    const product = (products ?? []).find((row) => row._id === productId);
    if (product === undefined) {
      setError("Choose a product.");
      return;
    }
    const variant = variants.find((row) => row._id === variantId);
    const sku = variant?.sku ?? product.sku;
    const variantKey = variant?._id ?? "product";
    const duplicate = lines.some(
      (line) => line.productId === product._id && (line.variantId ?? "product") === variantKey,
    );
    if (duplicate) {
      setError(`${sku} is already on this requisition.`);
      return;
    }
    setLines((current) => [
      ...current,
      {
        key: `${product._id}:${variant?._id ?? "product"}`,
        productId: product._id,
        variantId: variant?._id ?? null,
        qty: quantity,
        unitPrice: price,
        label: variant === undefined ? product.name : `${product.name} · ${variant.sku}`,
        sku,
      },
    ]);
    setError(null);
    setQty("1");
    setUnitPrice("");
  };

  const save = async () => {
    const day = priceDayFromInput(needBy);
    if ("error" in day) {
      setError(day.error);
      return;
    }
    if (lines.length < 1) {
      setError("Add a line.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const requisitionId = await create({
        needBy: day.ms,
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        lines: lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId !== null ? { variantId: line.variantId } : {}),
          qty: line.qty,
          unitPrice: line.unitPrice,
        })),
      });
      router.push(`/procurement/requisitions/${requisitionId}`);
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="New requisition"
        description="Name what you need, the price you expect to pay, and the date you need it by."
      />
      {error ? <FormAlert title="Couldn't save the requisition" message={error} /> : null}
      <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Need by" type="date" value={needBy} onChange={setNeedBy} />
          <TextArea label="Note" value={note} onChange={setNote} rows={3} />
        </div>
      </div>
      <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
        <h3 className="text-primary text-sm font-semibold">Add a line</h3>
        <Input
          label="Find a product"
          placeholder="Name or SKU"
          value={search}
          onChange={setSearch}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Product"
            placeholder="Choose a product"
            items={productItems}
            value={productId === "" ? null : productId}
            onChange={(key) => {
              setProductId(key == null ? "" : String(key));
              setVariantId("product");
            }}
          >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
          <Select
            label="Variant"
            items={variantItems}
            value={variantId}
            isDisabled={productId === "" || (variants ?? []).length === 0}
            onChange={(key) => setVariantId(key == null ? "product" : String(key))}
          >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
          <Input label="Quantity" type="number" value={qty} onChange={setQty} />
          <Input label="Requested price" type="number" value={unitPrice} onChange={setUnitPrice} />
        </div>
        <div className="flex justify-end">
          <Button color="secondary" onPress={addLine}>
            Add line
          </Button>
        </div>
        {lines.length > 0 ? (
          <ul className="divide-secondary divide-y">
            {lines.map((line) => (
              <li key={line.key} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-primary text-sm font-medium">{line.label}</p>
                  <p className="text-tertiary text-sm">
                    {line.sku} · {line.qty} × {formatUnitPrice(line.unitPrice, 2)}
                  </p>
                </div>
                <Button
                  color="tertiary"
                  size="sm"
                  onPress={() =>
                    setLines((current) => current.filter((row) => row.key !== line.key))
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button color="primary" isLoading={busy} onPress={() => void save()}>
          Request
        </Button>
      </div>
    </div>
  );
}
