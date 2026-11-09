"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { PurchaseOrderBill } from "@/components/procurement/purchase-order-bill";
import { PurchaseReceiptForm } from "@/components/procurement/purchase-receipt-form";
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
import { pdfCompany } from "@/lib/pdfKit";
import { formatUnitPrice, priceDayFromInput, priceDayLabel } from "@/lib/pricing";
import { purchaseOrderPdf } from "@/lib/purchaseOrderPdf";
import {
  purchaseOrderPriceError,
  purchaseOrderQtyError,
  purchaseOrderStatusColor,
  purchaseOrderStatusLabel,
} from "@/lib/purchaseOrders";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-tertiary text-sm">{label}</dt>
      <dd className="text-primary text-sm font-medium">{children}</dd>
    </div>
  );
}

function AddPurchaseLine({ purchaseOrderId }: { purchaseOrderId: Id<"purchaseOrders"> }) {
  const addLine = useMutation(api.procurement.purchaseOrders.addLine);
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

  const save = async () => {
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
    const qtyError = purchaseOrderQtyError(quantity);
    if (qtyError !== null) {
      setError(qtyError);
      return;
    }
    const price = Number(unitPrice);
    const priceError = purchaseOrderPriceError(price);
    if (priceError !== null) {
      setError(priceError);
      return;
    }
    const variant = variants.find((row) => row._id === variantId);
    setError(null);
    setBusy(true);
    try {
      await addLine({
        purchaseOrderId,
        productId: productId as Id<"products">,
        ...(variant !== undefined ? { variantId: variant._id } : {}),
        qty: quantity,
        unitPrice: price,
      });
      toast.success("Line added");
      setQty("1");
      setUnitPrice("");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
      <h3 className="text-primary text-sm font-semibold">Add a line</h3>
      {error ? <FormAlert title="Couldn't add the line" message={error} /> : null}
      <Input label="Find a product" placeholder="Name or SKU" value={search} onChange={setSearch} />
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
        <Input label="Agreed price" type="number" value={unitPrice} onChange={setUnitPrice} />
      </div>
      <div className="flex justify-end">
        <Button color="secondary" isLoading={busy} onPress={() => void save()}>
          Add line
        </Button>
      </div>
    </div>
  );
}

/** A purchase order: agreed price, tax, expected date, then send (PH2-21). */
export function PurchaseOrderDetail({
  purchaseOrderId,
}: {
  purchaseOrderId: Id<"purchaseOrders">;
}) {
  const detail = useQuery(api.procurement.purchaseOrders.get, { purchaseOrderId });
  const org = useQuery(api.organization.get, {});
  const canEdit = useCan("procurement", "edit");
  const canSend = useCan("procurement", "approve");
  const canReceive = useCan("inventory", "create");
  const updateExpectedDate = useMutation(api.procurement.purchaseOrders.updateExpectedDate);
  const updateLine = useMutation(api.procurement.purchaseOrders.updateLine);
  const removeLine = useMutation(api.procurement.purchaseOrders.removeLine);
  const send = useMutation(api.procurement.purchaseOrders.send);
  const [expected, setExpected] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageLabel(detail?.docNumber);
  const covers = useProductCovers(detail?.lines.map((line) => line.productId) ?? []);

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Purchase order" description="That purchase order doesn't exist." />;
  }

  const draft = detail.status === "draft";
  const receivable = detail.status === "sent" || detail.status === "partiallyReceived";
  const expectedValue = expected ?? priceDayLabel(detail.expectedDate);
  const money = (amount: number) =>
    `${formatUnitPrice(amount, detail.decimalPlaces)} ${detail.currency}`;

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(null);
    setBusy(true);
    try {
      await work();
      toast.success(done);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const company = await pdfCompany(org, detail.companyName);
    const bytes = await purchaseOrderPdf({
      companyName: company.companyName,
      logo: company.logo,
      footer: company.footer,
      docNumber: detail.docNumber,
      status: detail.status,
      vendorName: detail.vendorName,
      vendorCode: detail.vendorCode,
      currency: detail.currency,
      decimalPlaces: detail.decimalPlaces,
      expectedDate: priceDayLabel(detail.expectedDate),
      requisitionNumber: detail.requisitionNumber,
      lines: detail.lines.map((line) => ({
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        net: line.net,
        tax: line.tax,
        gross: line.gross,
      })),
      net: detail.totals.net,
      tax: detail.totals.tax,
      gross: detail.totals.gross,
    });
    const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${detail.docNumber}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveExpected = () => {
    const day = priceDayFromInput(expectedValue);
    if ("error" in day) {
      setError(day.error);
      return;
    }
    void run(
      () => updateExpectedDate({ purchaseOrderId, expectedDate: day.ms }),
      "Expected date saved",
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={detail.docNumber}
        description={`${detail.vendorName} · ${money(detail.amount)}`}
        actions={
          <Badge color={purchaseOrderStatusColor(detail.status)} size="md">
            {purchaseOrderStatusLabel(detail.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the purchase order" message={error} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button color="secondary" onPress={() => void download()}>
          Download PDF
        </Button>
        {canSend && draft ? (
          <Button
            color="primary"
            isLoading={busy}
            onPress={() => void run(() => send({ purchaseOrderId }), "Purchase order sent")}
          >
            Send
          </Button>
        ) : null}
      </div>
      <dl className="bg-primary ring-primary grid gap-4 rounded-xl p-5 ring-1 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Vendor">{detail.vendorName}</Fact>
        <Fact label="Expected">
          {draft && canEdit ? (
            <div className="mt-2 flex items-end gap-2">
              <Input label="Expected" type="date" value={expectedValue} onChange={setExpected} />
              <Button color="secondary" size="sm" isDisabled={busy} onPress={saveExpected}>
                Save
              </Button>
            </div>
          ) : (
            priceDayLabel(detail.expectedDate)
          )}
        </Fact>
        <Fact label="Requisition">
          {detail.requisitionId !== null && detail.requisitionNumber !== null ? (
            <Button color="link-color" href={`/procurement/requisitions/${detail.requisitionId}`}>
              {detail.requisitionNumber}
            </Button>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label="Bill">
          <PurchaseOrderBill purchaseOrderId={purchaseOrderId} status={detail.status} />
        </Fact>
        {detail.receipts.length > 0 ? (
          <Fact label="Receipts">
            <span className="flex flex-wrap gap-3">
              {detail.receipts.map((receipt) => (
                <Button
                  key={receipt._id}
                  color="link-color"
                  href={`/inventory/receipts/${receipt._id}`}
                >
                  {receipt.number}
                </Button>
              ))}
            </span>
          </Fact>
        ) : null}
      </dl>
      <ul className="bg-primary ring-primary divide-secondary divide-y rounded-xl ring-1">
        {detail.lines.map((line) => {
          const priceValue = prices[line._id] ?? String(line.unitPrice);
          return (
            <li
              key={line._id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <ProductIdentity
                name={line.description}
                meta={line.sku}
                src={covers.get(line.productId) ?? null}
              />
              <div className="space-y-2 text-right">
                {draft && canEdit ? (
                  <div className="flex items-end justify-end gap-2">
                    <Input
                      label="Agreed price"
                      type="number"
                      value={priceValue}
                      onChange={(value) =>
                        setPrices((current) => ({ ...current, [line._id]: value }))
                      }
                    />
                    <Button
                      color="secondary"
                      size="sm"
                      isDisabled={busy}
                      onPress={() => {
                        const price = Number(priceValue);
                        const priceError = purchaseOrderPriceError(price);
                        if (priceError !== null) {
                          setError(priceError);
                          return;
                        }
                        void run(
                          () => updateLine({ purchaseOrderId, lineId: line._id, unitPrice: price }),
                          "Agreed price saved",
                        );
                      }}
                    >
                      Save
                    </Button>
                    {detail.lines.length > 1 ? (
                      <Button
                        color="tertiary"
                        size="sm"
                        isDisabled={busy}
                        onPress={() =>
                          void run(
                            () => removeLine({ purchaseOrderId, lineId: line._id }),
                            "Line removed",
                          )
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <p className="text-primary text-sm">
                      {line.qty} × {money(line.unitPrice)}
                    </p>
                    <p className="text-tertiary text-sm">
                      Accepted {line.acceptedQty} of {line.qty}
                      {line.rejectedQty > 0 ? ` · Rejected ${line.rejectedQty}` : ""}
                    </p>
                  </div>
                )}
                <p className="text-tertiary text-sm">
                  Net {money(line.net)} · Tax {money(line.tax)} · Gross {money(line.gross)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <dl className="bg-primary ring-primary grid gap-4 rounded-xl p-5 ring-1 sm:grid-cols-3">
        <Fact label="Net">{money(detail.totals.net)}</Fact>
        <Fact label="Tax">{money(detail.totals.tax)}</Fact>
        <Fact label="Total">{money(detail.totals.gross)}</Fact>
      </dl>
      {draft && canEdit ? <AddPurchaseLine purchaseOrderId={purchaseOrderId} /> : null}
      {receivable && canReceive ? (
        <PurchaseReceiptForm purchaseOrderId={purchaseOrderId} lines={detail.lines} />
      ) : null}
    </div>
  );
}
