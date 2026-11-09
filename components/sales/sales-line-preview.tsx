"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  formatUnitPrice,
  priceDay,
  priceDayFromInput,
  priceDayLabel,
  resolveQtyError,
  type PriceSource,
} from "@/lib/pricing";

/**
 * Margin preview for a sales line (PH2-09). The unit is `resolvePrice`.
 * The total rounds again after the unit is multiplied by the quantity.
 * Margin uses the product's display cost. Quote and order lines reuse this
 * once those documents exist.
 */

function sourceLabel(source: PriceSource | null, breakId: string | null) {
  let name: string;
  switch (source) {
    case "customer":
      name = "Customer price";
      break;
    case "group":
      name = "Group price";
      break;
    case "list":
      name = "Price list";
      break;
    case "catalog":
      name = "Catalog price";
      break;
    case null:
      name = "No price";
      break;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
  return breakId !== null && source !== null ? `${name} · quantity break` : name;
}

function todayIso() {
  const day = priceDay(Date.now());
  return day === null ? "" : priceDayLabel(day);
}

export function SalesLinePreview() {
  const choices = useQuery(api.sales.prices.currencyChoices, {});
  const customers = useQuery(api.sales.customers.list, {});
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [variantKey, setVariantKey] = useState("product");
  const [currency, setCurrency] = useState("");
  const [qty, setQty] = useState("1");
  const [date, setDate] = useState(todayIso);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (currency !== "" || choices === undefined) return;
    const next = choices.baseCurrency ?? choices.currencies.find((row) => row.active)?.code ?? "";
    if (next !== "") setCurrency(next);
  }, [choices, currency]);

  const products = useQuery(api.catalog.products.picker, { search });
  const variants = useQuery(
    api.catalog.variants.list,
    productId !== "" ? { productId: productId as Id<"products"> } : "skip",
  );

  const qtyNumber = Number(qty);
  const qtyMessage = qty.trim() === "" ? "Quantity is required." : resolveQtyError(qtyNumber);
  const day = priceDayFromInput(date);
  const ready =
    customerId !== "" &&
    productId !== "" &&
    currency !== "" &&
    qtyMessage === null &&
    !("error" in day);

  const preview = useQuery(
    api.sales.prices.linePreview,
    ready
      ? {
          customerId: customerId as Id<"customers">,
          productId: productId as Id<"products">,
          variantId: variantKey === "product" ? null : (variantKey as Id<"variants">),
          qty: qtyNumber,
          date: day.ms,
          currency,
        }
      : "skip",
  );

  if (choices === undefined || customers === undefined) return <Skeleton className="h-80" />;

  const productItems = (products ?? []).map((row) => ({
    id: row._id,
    label: row.name,
    supportingText: row.sku,
    avatarUrl: row.coverUrl ?? undefined,
  }));
  const variantItems = [
    { id: "product", label: "Product" },
    ...(variants ?? []).map((row) => ({ id: row._id, label: row.sku })),
  ];

  return (
    <section className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
      <div>
        <h2 className="text-primary text-md font-semibold">Sales line</h2>
        <p className="text-tertiary mt-1 text-sm">
          The price a line would charge, and the margin against the product&apos;s display cost.
        </p>
      </div>
      <Select
        label="Customer"
        size="sm"
        placeholder="Choose a customer"
        items={customers.map((row) => ({ id: row._id, label: row.name, supportingText: row.code }))}
        value={customerId === "" ? null : customerId}
        onChange={(key) => setCustomerId(key == null ? "" : String(key))}
      >
        {(item) => (
          <Select.Item id={item.id} supportingText={item.supportingText}>
            {item.label}
          </Select.Item>
        )}
      </Select>
      <Input
        label="Find a product"
        size="sm"
        placeholder="Name or SKU"
        value={searchInput}
        onChange={setSearchInput}
      />
      <Select
        label="Product"
        size="sm"
        placeholder={products === undefined ? "Loading products" : "Choose a product"}
        items={productItems}
        value={productId === "" ? null : productId}
        onChange={(key) => {
          setProductId(key == null ? "" : String(key));
          setVariantKey("product");
        }}
      >
        {(item) => (
          <Select.Item id={item.id} supportingText={item.supportingText} avatarUrl={item.avatarUrl}>
            {item.label}
          </Select.Item>
        )}
      </Select>
      <Select
        label="Variant"
        size="sm"
        items={variantItems}
        value={variantKey}
        isDisabled={productId === ""}
        onChange={(key) => setVariantKey(key == null ? "product" : String(key))}
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Quantity" size="sm" type="number" value={qty} onChange={setQty} />
        <Input label="Date" size="sm" type="date" value={date} onChange={setDate} />
      </div>
      <Select
        label="Currency"
        size="sm"
        placeholder="Currency"
        items={choices.currencies
          .filter((row) => row.active)
          .map((row) => ({ id: row.code, label: `${row.code} · ${row.name}` }))}
        value={currency === "" ? null : currency}
        onChange={(key) => setCurrency(key == null ? "" : String(key))}
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
      {qtyMessage !== null && qty.trim() !== "" ? (
        <p className="text-fg-error-primary text-sm">{qtyMessage}</p>
      ) : null}
      {"error" in day && date.trim() !== "" ? (
        <p className="text-fg-error-primary text-sm">{day.error}</p>
      ) : null}
      {!ready ? (
        <p className="text-tertiary text-sm">Choose a customer, a product, and a quantity.</p>
      ) : preview === undefined ? (
        <Skeleton className="h-24" />
      ) : preview.unitPrice === null ? (
        <p className="text-tertiary text-sm">No price for this line.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-tertiary">Unit</dt>
            <dd className="text-primary font-medium tabular-nums">
              {formatUnitPrice(preview.unitPrice, preview.decimalPlaces)} {preview.currency}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-tertiary">Line</dt>
            <dd className="text-primary font-medium tabular-nums">
              {preview.lineAmount === null
                ? "—"
                : `${formatUnitPrice(preview.lineAmount, preview.decimalPlaces)} ${preview.currency}`}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-tertiary">Source</dt>
            <dd className="text-secondary">{sourceLabel(preview.source, preview.breakId)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-tertiary">Cost</dt>
            <dd className="text-secondary tabular-nums">
              {preview.costPrice === null
                ? "—"
                : formatUnitPrice(preview.costPrice, preview.decimalPlaces)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-tertiary">Margin</dt>
            <dd
              className={
                preview.marginPercent === null
                  ? "text-tertiary"
                  : preview.marginPercent < 0
                    ? "text-fg-error-primary font-medium tabular-nums"
                    : "text-fg-success-primary font-medium tabular-nums"
              }
            >
              {preview.marginPercent === null ? "—" : `${preview.marginPercent.toFixed(1)}%`}
            </dd>
          </div>
        </dl>
      )}
      {ready &&
      preview !== undefined &&
      preview.marginPercent === null &&
      preview.unitPrice !== null ? (
        <p className="text-tertiary text-sm">Margin needs a display cost and a price above zero.</p>
      ) : null}
    </section>
  );
}
