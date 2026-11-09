"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { priceDayFromInput } from "@/lib/pricing";
import { vendorBillPriceError, vendorBillQtyError, vendorBillReferenceError } from "@/lib/vendorBills";

type DraftLine = {
  key: string;
  productId: Id<"products">;
  variantId?: Id<"variants">;
  label: string;
  qty: number;
  unitPrice: number;
};

/** A vendor bill with no purchase order (PH2-23). */
export function VendorBillForm() {
  const router = useRouter();
  const create = useMutation(api.procurement.vendorBills.create);
  const vendors = useQuery(api.procurement.vendors.list, { active: true });
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [billDate, setBillDate] = useState("");
  const [reference, setReference] = useState("");
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
    const qtyError = vendorBillQtyError(quantity);
    if (qtyError !== null) {
      setError(qtyError);
      return;
    }
    const price = Number(unitPrice);
    const priceError = vendorBillPriceError(price);
    if (priceError !== null) {
      setError(priceError);
      return;
    }
    const product = (products ?? []).find((row) => row._id === productId);
    const variant = variants.find((row) => row._id === variantId);
    if (product === undefined) {
      setError("Choose a product.");
      return;
    }
    setError(null);
    setLines((current) => [
      ...current,
      {
        key: `${product._id}:${variant?._id ?? ""}`,
        productId: product._id,
        ...(variant !== undefined ? { variantId: variant._id } : {}),
        label: variant !== undefined ? `${product.name} · ${variant.sku}` : `${product.name} · ${product.sku}`,
        qty: quantity,
        unitPrice: price,
      },
    ]);
    setQty("1");
    setUnitPrice("");
  };

  const save = async () => {
    if (vendorId === null) {
      setError("Choose a vendor.");
      return;
    }
    const day = priceDayFromInput(billDate);
    if ("error" in day) {
      setError(day.error);
      return;
    }
    const referenceError = vendorBillReferenceError(reference);
    if (referenceError !== null) {
      setError(referenceError);
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one line.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const vendorBillId = await create({
        vendorId: vendorId as Id<"vendors">,
        billDate: day.ms,
        ...(reference.trim() === "" ? {} : { reference: reference.trim() }),
        lines: lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
          qty: line.qty,
          unitPrice: line.unitPrice,
        })),
      });
      toast.success("Bill recorded");
      router.push(`/procurement/bills/${vendorBillId}`);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="New bill"
        description="A bill with no purchase order. Match it when the figures are the ones you want to post."
      />
      {error ? <FormAlert title="Couldn't record the bill" message={error} /> : null}
      <div className="bg-primary ring-primary grid gap-4 rounded-xl p-5 ring-1 sm:grid-cols-3">
        <Select
          label="Vendor"
          placeholder="Choose a vendor"
          items={(vendors ?? []).map((row) => ({ id: row._id, label: `${row.name} · ${row.code}` }))}
          value={vendorId}
          onChange={(key) => setVendorId(key == null ? null : String(key))}
        >
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
        <Input label="Bill date" type="date" value={billDate} onChange={setBillDate} />
        <Input label="Vendor reference" value={reference} onChange={setReference} />
      </div>
      <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
        <h3 className="text-primary text-sm font-semibold">Add a line</h3>
        <Input label="Find a product" placeholder="Name or SKU" value={search} onChange={setSearch} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Product"
            placeholder="Choose a product"
            items={(products ?? []).map((row) => ({ id: row._id, label: `${row.name} · ${row.sku}` }))}
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
            items={[
              { id: "product", label: "Product" },
              ...(variants ?? []).map((row) => ({ id: row._id, label: row.sku })),
            ]}
            value={variantId}
            isDisabled={productId === "" || (variants ?? []).length === 0}
            onChange={(key) => setVariantId(key == null ? "product" : String(key))}
          >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
          <Input label="Quantity" type="number" value={qty} onChange={setQty} />
          <Input label="Unit price" type="number" value={unitPrice} onChange={setUnitPrice} />
        </div>
        <div className="flex justify-end">
          <Button color="secondary" onPress={addLine}>
            Add line
          </Button>
        </div>
        {lines.length > 0 ? (
          <ul className="divide-secondary divide-y">
            {lines.map((line) => (
              <li key={line.key} className="flex items-center justify-between py-3">
                <span className="text-primary text-sm">{line.label}</span>
                <span className="flex items-center gap-3">
                  <span className="text-tertiary text-sm">
                    {line.qty} × {line.unitPrice}
                  </span>
                  <Button
                    color="tertiary"
                    size="sm"
                    onPress={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button color="primary" isLoading={busy} onPress={() => void save()}>
          Record bill
        </Button>
      </div>
    </div>
  );
}
