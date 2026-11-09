"use client";

import { useQuery } from "convex/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type DraftLine = {
  key: string;
  productId: string;
  variantId: string;
  qty: string;
  unitCost: string;
};

export function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), productId: "", variantId: "", qty: "", unitCost: "" };
}

/**
 * Product lines for a transfer or a goods receipt. The variant select
 * appears only when the chosen product has a matrix.
 */
export function DocumentLines({
  lines,
  products,
  onChange,
  showCost = false,
}: {
  lines: DraftLine[];
  products: { _id: string; name: string; sku: string; coverUrl?: string | null }[] | undefined;
  onChange: (lines: DraftLine[]) => void;
  showCost?: boolean;
}) {
  const items = (products ?? []).map((product) => ({
    id: product._id,
    label: `${product.name} · ${product.sku}`,
    avatarUrl: product.coverUrl ?? undefined,
  }));

  const update = (key: string, patch: Partial<DraftLine>) => {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  return (
    <div className="space-y-4">
      {lines.map((line, index) => (
        <div key={line.key} className="ring-primary space-y-3 rounded-xl p-4 ring-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-secondary text-sm font-medium">Line {index + 1}</p>
            {lines.length > 1 ? (
              <Button
                type="button"
                size="sm"
                color="tertiary"
                onPress={() => onChange(lines.filter((item) => item.key !== line.key))}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <Select
            aria-label={`Product for line ${index + 1}`}
            placeholder={products === undefined ? "Loading products…" : "Choose a product"}
            items={items}
            value={line.productId}
            onChange={(key) =>
              update(line.key, { productId: key == null ? "" : String(key), variantId: "" })
            }
          >
            {(item) => (
              <Select.Item id={item.id} key={item.id} avatarUrl={item.avatarUrl}>
                {item.label}
              </Select.Item>
            )}
          </Select>
          <VariantSelect
            productId={line.productId}
            value={line.variantId}
            onChange={(variantId) => update(line.key, { variantId })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Quantity"
              type="number"
              inputMode="decimal"
              placeholder="1"
              value={line.qty}
              onChange={(value) => update(line.key, { qty: value })}
            />
            {showCost ? (
              <Input
                label="Unit cost"
                type="number"
                inputMode="decimal"
                placeholder="Optional"
                hint="Recorded on the ledger line."
                value={line.unitCost}
                onChange={(value) => update(line.key, { unitCost: value })}
              />
            ) : null}
          </div>
        </div>
      ))}
      <Button type="button" color="secondary" onPress={() => onChange([...lines, emptyLine()])}>
        Add line
      </Button>
    </div>
  );
}

function VariantSelect({
  productId,
  value,
  onChange,
}: {
  productId: string;
  value: string;
  onChange: (variantId: string) => void;
}) {
  const variants = useQuery(
    api.catalog.variants.list,
    productId === "" ? "skip" : { productId: productId as Id<"products"> },
  );
  if (productId === "" || variants === undefined || variants.length === 0) return null;
  return (
    <Select
      aria-label="Variant"
      placeholder="Choose a variant"
      items={variants.map((variant) => ({
        id: variant._id,
        label: `${variant.sku}${variant.optionValues.length > 0 ? ` · ${variant.optionValues.map((option) => option.value).join(" / ")}` : ""}`,
      }))}
      value={value}
      onChange={(key) => onChange(key == null ? "" : String(key))}
    >
      {(item) => (
        <Select.Item id={item.id} key={item.id}>
          {item.label}
        </Select.Item>
      )}
    </Select>
  );
}
