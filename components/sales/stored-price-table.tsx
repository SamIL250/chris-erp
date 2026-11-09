"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { FormAlert } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { useProductCovers } from "@/hooks/use-product-covers";
import { toUserMessage } from "@/lib/errors";
import { breakQtyError, formatUnitPrice, priceError } from "@/lib/pricing";

/**
 * One stored price and the quantity breaks that hang off it (PH2-09).
 * The same table serves a price list, a customer group, and a customer.
 * Writes are `sales.create`. An inactive list or group, or a closed
 * customer, can still show its prices; a new one is refused.
 */

type PriceBreak = { _id: Id<"quantityBreaks">; minQty: number; price: number };

export type StoredPriceRow = {
  _id: string;
  productId: Id<"products">;
  productName: string;
  sku: string;
  variantId?: Id<"variants"> | null;
  variantSku: string | null;
  price: number;
  currency?: string;
  breaks: PriceBreak[];
};

type CurrencyChoice = { code: string; name: string; decimalPlaces: number; active: boolean };

type Scope =
  | { kind: "list"; listId: Id<"priceLists">; currency: string }
  | { kind: "group"; groupId: Id<"customerGroups"> }
  | { kind: "customer"; customerId: Id<"customers"> };

function parsedAmount(raw: string): { error: string } | { price: number } {
  if (raw.trim() === "") return { error: "Price is required." };
  const price = Number(raw);
  const message = priceError(price);
  if (message !== null) return { error: message };
  return { price };
}

function parsedQty(raw: string): { error: string } | { qty: number } {
  if (raw.trim() === "") return { error: "Quantity is required." };
  const qty = Number(raw);
  const message = breakQtyError(qty);
  if (message !== null) return { error: message };
  return { qty };
}

function placesOf(currencies: CurrencyChoice[], code: string) {
  return currencies.find((row) => row.code === code)?.decimalPlaces ?? 2;
}

export function StoredPriceTable({
  title,
  description,
  prices,
  scope,
  currencies,
  defaultCurrency,
  acceptsNew,
  canRemove,
  blockedReason,
}: {
  title: string;
  description: string;
  prices: StoredPriceRow[];
  scope: Scope;
  currencies: CurrencyChoice[];
  defaultCurrency: string;
  acceptsNew: boolean;
  canRemove: boolean;
  blockedReason: string | null;
}) {
  const setListPrice = useMutation(api.sales.prices.setListPrice);
  const removeListPrice = useMutation(api.sales.prices.removeListPrice);
  const setGroupPrice = useMutation(api.sales.prices.setGroupPrice);
  const removeGroupPrice = useMutation(api.sales.prices.removeGroupPrice);
  const setCustomerPrice = useMutation(api.sales.prices.setCustomerPrice);
  const removeCustomerPrice = useMutation(api.sales.prices.removeCustomerPrice);
  const setBreak = useMutation(api.sales.prices.setBreak);
  const removeBreak = useMutation(api.sales.prices.removeBreak);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [variantKey, setVariantKey] = useState("product");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const products = useQuery(api.catalog.products.picker, acceptsNew ? { search } : "skip");
  const covers = useProductCovers(prices.map((row) => row.productId));
  const variants = useQuery(
    api.catalog.variants.list,
    acceptsNew && productId !== "" ? { productId: productId as Id<"products"> } : "skip",
  );

  const activeCurrencies = currencies.filter((row) => row.active);
  const currencyCode = scope.kind === "list" ? scope.currency : currency;
  const places = placesOf(currencies, currencyCode);

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

  const variantId = (): Id<"variants"> | null =>
    variantKey === "product" ? null : (variantKey as Id<"variants">);

  const saveNew = () => {
    const parsed = parsedAmount(amount);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (productId === "") {
      setError("Choose a product.");
      return;
    }
    if (scope.kind !== "list" && currencyCode === "") {
      setError("Choose a currency.");
      return;
    }
    const product = productId as Id<"products">;
    const variant = variantId();
    void run(async () => {
      switch (scope.kind) {
        case "list":
          await setListPrice({
            priceListId: scope.listId,
            productId: product,
            variantId: variant,
            price: parsed.price,
          });
          break;
        case "group":
          await setGroupPrice({
            groupId: scope.groupId,
            productId: product,
            variantId: variant,
            currency: currencyCode,
            price: parsed.price,
          });
          break;
        case "customer":
          await setCustomerPrice({
            customerId: scope.customerId,
            productId: product,
            variantId: variant,
            currency: currencyCode,
            price: parsed.price,
          });
          break;
        default: {
          const unreachable: never = scope;
          return unreachable;
        }
      }
      setAmount("");
    }, "Price saved");
  };

  const saveExisting = (row: StoredPriceRow) => {
    const parsed = parsedAmount(editAmount);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const code = row.currency ?? (scope.kind === "list" ? scope.currency : "");
    void run(async () => {
      switch (scope.kind) {
        case "list":
          await setListPrice({
            priceListId: scope.listId,
            productId: row.productId,
            variantId: row.variantId ?? null,
            price: parsed.price,
          });
          break;
        case "group":
          await setGroupPrice({
            groupId: scope.groupId,
            productId: row.productId,
            variantId: row.variantId ?? null,
            currency: code,
            price: parsed.price,
          });
          break;
        case "customer":
          await setCustomerPrice({
            customerId: scope.customerId,
            productId: row.productId,
            variantId: row.variantId ?? null,
            currency: code,
            price: parsed.price,
          });
          break;
        default: {
          const unreachable: never = scope;
          return unreachable;
        }
      }
      setEditingId(null);
    }, "Price saved");
  };

  const removePrice = (row: StoredPriceRow) => {
    void run(async () => {
      switch (scope.kind) {
        case "list":
          await removeListPrice({ priceId: row._id as Id<"priceListPrices"> });
          break;
        case "group":
          await removeGroupPrice({ priceId: row._id as Id<"customerGroupPrices"> });
          break;
        case "customer":
          await removeCustomerPrice({ priceId: row._id as Id<"customerPrices"> });
          break;
        default: {
          const unreachable: never = scope;
          return unreachable;
        }
      }
    }, "Price removed");
  };

  const breakTarget = (row: StoredPriceRow) => {
    switch (scope.kind) {
      case "list":
        return { scope: "list" as const, priceId: row._id as Id<"priceListPrices"> };
      case "group":
        return { scope: "group" as const, priceId: row._id as Id<"customerGroupPrices"> };
      case "customer":
        return { scope: "customer" as const, priceId: row._id as Id<"customerPrices"> };
      default: {
        const unreachable: never = scope;
        return unreachable;
      }
    }
  };

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
        <h2 className="text-primary text-md font-semibold">{title}</h2>
        <p className="text-tertiary mt-1 text-sm">{description}</p>
      </div>
      {error ? <FormAlert title="Couldn't save the price" message={error} /> : null}
      {blockedReason ? <p className="text-tertiary text-sm">{blockedReason}</p> : null}
      {prices.length === 0 ? (
        <p className="text-tertiary text-sm">No prices yet.</p>
      ) : (
        <ul className="divide-secondary divide-y">
          {prices.map((row) => {
            const code = row.currency ?? (scope.kind === "list" ? scope.currency : "");
            const rowPlaces = placesOf(currencies, code);
            const open = openId === row._id;
            return (
              <li key={row._id} className="space-y-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <ProductIdentity
                      name={row.productName || row.sku}
                      src={covers.get(row.productId) ?? null}
                    />
                    <p className="text-tertiary mt-1 font-mono text-xs">
                      {row.sku}
                      {row.variantSku ? ` · ${row.variantSku}` : ""}
                      {code ? ` · ${code}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {editingId === row._id ? (
                      <>
                        <div className="w-28">
                          <Input
                            aria-label="Price"
                            size="sm"
                            type="number"
                            value={editAmount}
                            onChange={setEditAmount}
                          />
                        </div>
                        <Button
                          size="sm"
                          color="primary"
                          isLoading={busy}
                          isDisabled={!acceptsNew}
                          onPress={() => saveExisting(row)}
                        >
                          Save
                        </Button>
                        <Button size="sm" color="tertiary" onPress={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <span className="text-primary text-sm font-medium tabular-nums">
                        {formatUnitPrice(row.price, rowPlaces)}
                      </span>
                    )}
                    {editingId !== row._id && acceptsNew ? (
                      <Button
                        size="sm"
                        color="secondary"
                        onPress={() => {
                          setEditingId(row._id);
                          setEditAmount(String(row.price));
                        }}
                      >
                        Change
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      color="secondary"
                      onPress={() => setOpenId(open ? null : row._id)}
                    >
                      Breaks{row.breaks.length > 0 ? ` (${row.breaks.length})` : ""}
                    </Button>
                    {canRemove ? (
                      <Button size="sm" color="tertiary" onPress={() => removePrice(row)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                {open ? (
                  <BreakEditor
                    breaks={row.breaks}
                    places={rowPlaces}
                    acceptsNew={acceptsNew}
                    canRemove={canRemove}
                    busy={busy}
                    onAdd={(minQty, price) =>
                      void run(
                        () => setBreak({ target: breakTarget(row), minQty, price }),
                        "Quantity break saved",
                      )
                    }
                    onRemove={(breakId) =>
                      void run(() => removeBreak({ breakId }), "Quantity break removed")
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {acceptsNew ? (
        <div className="border-secondary space-y-3 border-t pt-4">
          <p className="text-secondary text-sm font-medium">Add a price</p>
          <div className="grid gap-3 sm:grid-cols-2">
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
                <Select.Item
                  id={item.id}
                  supportingText={item.supportingText}
                  avatarUrl={item.avatarUrl}
                >
                  {item.label}
                </Select.Item>
              )}
            </Select>
            <Select
              label="Variant"
              size="sm"
              placeholder="Product"
              items={variantItems}
              value={variantKey}
              isDisabled={productId === ""}
              onChange={(key) => setVariantKey(key == null ? "product" : String(key))}
            >
              {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
            </Select>
            {scope.kind === "list" ? (
              <Input label="Currency" size="sm" value={scope.currency} isDisabled />
            ) : (
              <Select
                label="Currency"
                size="sm"
                placeholder="Currency"
                items={activeCurrencies.map((row) => ({
                  id: row.code,
                  label: `${row.code} · ${row.name}`,
                }))}
                value={currency === "" ? null : currency}
                onChange={(key) => setCurrency(key == null ? "" : String(key))}
              >
                {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
              </Select>
            )}
            <Input
              label="Price"
              size="sm"
              type="number"
              value={amount}
              onChange={setAmount}
              hint={currencyCode ? `${currencyCode}, ${places} decimal places` : undefined}
            />
          </div>
          <Button color="secondary" size="sm" isLoading={busy} onPress={saveNew}>
            Save price
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function BreakEditor({
  breaks,
  places,
  acceptsNew,
  canRemove,
  busy,
  onAdd,
  onRemove,
}: {
  breaks: PriceBreak[];
  places: number;
  acceptsNew: boolean;
  canRemove: boolean;
  busy: boolean;
  onAdd: (minQty: number, price: number) => void;
  onRemove: (breakId: Id<"quantityBreaks">) => void;
}) {
  const [qty, setQty] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const parsedQtyResult = parsedQty(qty);
    if ("error" in parsedQtyResult) {
      setError(parsedQtyResult.error);
      return;
    }
    const parsed = parsedAmount(amount);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onAdd(parsedQtyResult.qty, parsed.price);
    setQty("");
    setAmount("");
  };

  return (
    <div className="bg-secondary space-y-3 rounded-lg p-3">
      <p className="text-secondary text-sm">
        A break replaces the unit from that quantity up. The first unit uses the price above.
      </p>
      {error ? <FormAlert title="Couldn't save the break" message={error} /> : null}
      {breaks.length === 0 ? (
        <p className="text-tertiary text-sm">No quantity breaks.</p>
      ) : (
        <ul className="space-y-2">
          {breaks.map((row) => (
            <li key={row._id} className="flex items-center justify-between gap-3">
              <span className="text-secondary text-sm tabular-nums">
                {row.minQty}+ · {formatUnitPrice(row.price, places)}
              </span>
              {canRemove ? (
                <Button size="sm" color="tertiary" onPress={() => onRemove(row._id)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {acceptsNew ? (
        <div className="grid gap-3 sm:grid-cols-[8rem_8rem_auto] sm:items-end">
          <Input label="From quantity" size="sm" type="number" value={qty} onChange={setQty} />
          <Input label="Unit price" size="sm" type="number" value={amount} onChange={setAmount} />
          <Button size="sm" color="secondary" isLoading={busy} onPress={add}>
            Add break
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CustomerPrices({
  customerId,
  status,
  currency,
}: {
  customerId: Id<"customers">;
  status: "active" | "onHold" | "closed";
  currency: string;
}) {
  const detail = useQuery(api.sales.prices.listCustomerPrices, { customerId });
  const choices = useQuery(api.sales.prices.currencyChoices, {});
  const canCreate = useCan("sales", "create");
  if (detail === undefined || choices === undefined) return <Skeleton className="h-40" />;
  if (detail === null) return null;
  const closed = status === "closed";
  return (
    <StoredPriceTable
      title="Prices"
      description="A price for this company beats their group and the price lists. A quantity break replaces the unit once the quantity is reached."
      prices={detail.prices}
      scope={{ kind: "customer", customerId }}
      currencies={choices.currencies}
      defaultCurrency={currency}
      acceptsNew={canCreate && !closed}
      canRemove={canCreate}
      blockedReason={
        canCreate && closed ? "This customer is closed. New prices are refused." : null
      }
    />
  );
}

export function GroupPrices({
  groupId,
  active,
}: {
  groupId: Id<"customerGroups">;
  active: boolean;
}) {
  const detail = useQuery(api.sales.prices.listGroupPrices, { groupId });
  const choices = useQuery(api.sales.prices.currencyChoices, {});
  const canCreate = useCan("sales", "create");
  if (detail === undefined || choices === undefined) return <Skeleton className="h-40" />;
  if (detail === null) return null;
  return (
    <StoredPriceTable
      title="Prices"
      description="A price for this tier beats the price lists. A price on the company still wins. A quantity break replaces the unit once the quantity is reached."
      prices={detail.prices}
      scope={{ kind: "group", groupId }}
      currencies={choices.currencies}
      defaultCurrency={
        choices.baseCurrency ?? choices.currencies.find((row) => row.active)?.code ?? ""
      }
      acceptsNew={canCreate && active}
      canRemove={canCreate}
      blockedReason={
        canCreate && !active ? "This group is inactive. New prices are refused." : null
      }
    />
  );
}
