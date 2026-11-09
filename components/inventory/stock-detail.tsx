"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/base/badges/badges";
import { Select } from "@/components/base/select/select";
import { ProductCover } from "@/components/catalog/product-cover";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ReorderPoint } from "@/components/inventory/reorder-point";
import { usePageLabel } from "@/components/shared/page-label";
import { useProductCovers } from "@/hooks/use-product-covers";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  formatQty,
  formatValue,
  formatWhen,
  movementLabel,
  reasonLabel,
} from "@/lib/inventory-display";
import { isLowStock, reorderPointFor } from "@/lib/reorder";

type Movement = Doc<"stockMovements">;

/**
 * Product stock (PH1-23): the balance at one warehouse, every ledger
 * line, and the reservations that make up the hold.
 */
export function StockDetail({ productId }: { productId: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const warehouses = useQuery(api.inventory.warehouses.list);
  const product = useQuery(api.catalog.products.get, { id: productId });
  const [picked, setPicked] = useState(search.get("warehouse") ?? "");
  const variantId = search.get("variant") ?? "";
  const warehouseId =
    picked !== ""
      ? picked
      : (warehouses?.find((row) => row.isDefault)?._id ?? warehouses?.[0]?._id ?? "");
  const productReady = product !== undefined && product !== null;
  const reorder = useQuery(
    api.inventory.reorderPoints.forProduct,
    productReady ? { productId: productId as Id<"products"> } : "skip",
  );
  const warehouseActive = warehouses?.find((row) => row._id === warehouseId)?.active === true;
  const reorderPoint =
    reorder === undefined || !warehouseActive
      ? undefined
      : reorderPointFor(
          reorder.map((row) => ({
            productId,
            warehouseId: row.warehouseId,
            qty: row.qty,
          })),
          productId,
          warehouseId,
        );

  usePageLabel(product?.product?.name);
  const covers = useProductCovers(productReady ? [productId] : []);

  const balance = useQuery(
    api.inventory.stock.balance,
    !productReady || warehouseId === ""
      ? "skip"
      : {
          productId: productId as Id<"products">,
          warehouseId: warehouseId as Id<"warehouses">,
          ...(variantId === "" ? {} : { variantId: variantId as Id<"variants"> }),
        },
  );
  const movements = useQuery(
    api.inventory.stock.list,
    !productReady
      ? "skip"
      : {
          productId: productId as Id<"products">,
          ...(warehouseId === "" ? {} : { warehouseId: warehouseId as Id<"warehouses"> }),
        },
  );
  const shown = (movements ?? []).filter((row) =>
    variantId === "" ? true : row.variantId === variantId,
  );

  const reserves = shown.filter((row) => row.type === "reservation" || row.type === "release");

  const columns: DataTableColumn<Movement>[] = [
    {
      id: "when",
      header: "When",
      cell: (row) => <span className="text-secondary text-sm">{formatWhen(row.createdAt)}</span>,
    },
    {
      id: "type",
      header: "Type",
      cell: (row) => (
        <span className="text-primary text-sm">
          {movementLabel(row.type)}
          {row.reason ? ` · ${reasonLabel(row.reason)}` : ""}
        </span>
      ),
    },
    {
      id: "qty",
      header: "Qty",
      cell: (row) => (
        <span className="text-primary font-mono text-sm tabular-nums">{formatQty(row.qty)}</span>
      ),
    },
    {
      id: "reference",
      header: "Reference",
      cell: (row) => (
        <span className="text-tertiary text-sm">
          {row.referenceType ? `${row.referenceType} ${row.referenceId ?? ""}` : (row.note ?? "—")}
        </span>
      ),
    },
  ];

  if (product === null) {
    return (
      <PageHeader
        title="Product not found"
        description="This product is no longer on file. Its ledger lines, if any, stay in the stock list."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <ProductCover src={covers.get(productId)} className="size-16" />
        <PageHeader
          title={product === undefined ? "Stock" : product.product.name}
          description={
            product === undefined
              ? undefined
              : `${product.product.sku} · on hand, what is reserved, and the ledger that produced them.`
          }
        />
      </div>

      <div className="w-64">
        <Select
          aria-label="Warehouse"
          label="Warehouse"
          placeholder="Choose a warehouse"
          items={(warehouses ?? []).map((row) => ({
            id: row._id as string,
            label: `${row.code} · ${row.name}`,
          }))}
          value={warehouseId}
          onChange={(key) => {
            const next = key == null ? "" : String(key);
            setPicked(next);
            const params = new URLSearchParams(search.toString());
            if (next === "") params.delete("warehouse");
            else params.set("warehouse", next);
            const query = params.toString();
            router.replace(
              query === ""
                ? `/inventory/stock/${productId}`
                : `/inventory/stock/${productId}?${query}`,
            );
          }}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      </div>

      {warehouses === undefined || product === undefined ? (
        <Skeleton className="h-40" />
      ) : warehouses.length === 0 ? (
        <p className="text-tertiary text-sm">Add a warehouse before stock can be read here.</p>
      ) : balance === undefined || movements === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="On hand" value={formatQty(balance.onHand)} />
            <Stat label="Reserved" value={formatQty(balance.reserved)} />
            <Stat
              label="Available"
              value={formatQty(balance.available)}
              tone={isLowStock(balance.available, reorderPoint) ? "low" : "ok"}
            />
            <Stat label="Value" value={formatValue(balance.value)} />
            <Stat
              label="Reorder point"
              value={reorderPoint === undefined ? "—" : formatQty(reorderPoint)}
            />
          </div>

          <ReorderPoint
            key={warehouseId}
            productId={productId}
            warehouseId={warehouseId}
            points={reorder}
          />

          <DataTable
            title="Reservations"
            description="Holds against documents, and the releases that give them back."
            columns={columns}
            rows={reserves}
            rowId={(row) => row._id}
            empty={{
              title: "Nothing reserved",
              description: "A sales order that holds stock will show up here.",
            }}
          />

          <DataTable
            title="Ledger"
            description="Every movement at this warehouse, newest last. A correction is another line."
            columns={columns}
            rows={shown}
            rowId={(row) => row._id}
            empty={{
              title: "No movements",
              description: "This product has not moved at this warehouse.",
            }}
          />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "low";
}) {
  return (
    <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
      <p className="text-tertiary text-sm">{label}</p>
      {tone === "low" ? (
        <Badge color="error" size="md" className="mt-2">
          {value}
        </Badge>
      ) : (
        <p className="text-primary text-display-xs mt-1 font-semibold tabular-nums">{value}</p>
      )}
    </div>
  );
}
