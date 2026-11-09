"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Select } from "@/components/base/select/select";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProductCovers } from "@/hooks/use-product-covers";
import { formatQty, formatValue } from "@/lib/inventory-display";

type Position = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  warehouseId: Id<"warehouses">;
  warehouseCode: string;
  warehouseName: string;
  name: string;
  sku: string;
  lowStock: boolean;
  reorderPoint?: number;
  onHand: number;
  reserved: number;
  available: number;
  unitCost?: number;
  value?: number;
};

type StockRow = Position & { coverSrc: string | null };

/**
 * Stock on hand (PH1-23). Warehouse, category, and low stock are
 * filtered on the server. Low stock means available is at or below
 * the reorder point (PH1-24).
 */
export default function StockPage() {
  const router = useRouter();
  const warehouses = useQuery(api.inventory.warehouses.list);
  const categories = useQuery(api.catalog.categories.list);
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [lowStock, setLowStock] = useState("");

  const rows = useQuery(api.inventory.stock.positions, {
    ...(warehouseId === "" ? {} : { warehouseId: warehouseId as Id<"warehouses"> }),
    ...(categoryId === "" ? {} : { categoryId: categoryId as Id<"categories"> }),
    ...(lowStock === "yes" ? { lowStock: true } : {}),
  });
  const covers = useProductCovers((rows ?? []).map((row) => row.productId));
  const tableRows = useMemo(
    () => (rows ?? []).map((row) => ({ ...row, coverSrc: covers.get(row.productId) ?? null })),
    [rows, covers],
  );

  const columns = useMemo<DataTableColumn<StockRow>[]>(
    () => [
      {
        id: "product",
        header: "Product",
        cell: (row) => <ProductIdentity name={row.name} meta={row.sku} src={row.coverSrc} />,
      },
      {
        id: "warehouse",
        header: "Warehouse",
        cell: (row) => (
          <span className="text-secondary text-sm">
            {row.warehouseCode} · {row.warehouseName}
          </span>
        ),
      },
      {
        id: "onHand",
        header: "On hand",
        cell: (row) => (
          <span className="text-primary text-sm tabular-nums">{formatQty(row.onHand)}</span>
        ),
      },
      {
        id: "reserved",
        header: "Reserved",
        cell: (row) => (
          <span className="text-secondary text-sm tabular-nums">{formatQty(row.reserved)}</span>
        ),
      },
      {
        id: "available",
        header: "Available",
        cell: (row) =>
          row.lowStock ? (
            <Badge color="error" size="sm">
              {formatQty(row.available)}
            </Badge>
          ) : (
            <span className="text-primary text-sm tabular-nums">{formatQty(row.available)}</span>
          ),
      },
      {
        id: "reorder",
        header: "Reorder",
        cell: (row) => (
          <span className="text-secondary text-sm tabular-nums">
            {row.reorderPoint === undefined ? "—" : formatQty(row.reorderPoint)}
          </span>
        ),
      },
      {
        id: "value",
        header: "Value",
        cell: (row) => (
          <span className="text-secondary text-sm tabular-nums">{formatValue(row.value)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        description="On hand, reserved, and what is still free to promise. Value is on-hand times the latest unit cost — a placeholder until moving-average cost."
      />
      {rows === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          title="Positions"
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-44">
                <Select
                  aria-label="Filter by warehouse"
                  size="sm"
                  placeholder="All warehouses"
                  items={[
                    { id: "", label: "All warehouses" },
                    ...(warehouses ?? []).map((row) => ({
                      id: row._id as string,
                      label: `${row.code} · ${row.name}`,
                    })),
                  ]}
                  value={warehouseId}
                  onChange={(key) => setWarehouseId(key == null ? "" : String(key))}
                >
                  {(item) => (
                    <Select.Item id={item.id} key={item.id}>
                      {item.label}
                    </Select.Item>
                  )}
                </Select>
              </div>
              <div className="w-44">
                <Select
                  aria-label="Filter by category"
                  size="sm"
                  placeholder="All categories"
                  items={[
                    { id: "", label: "All categories" },
                    ...(categories ?? []).map((row) => ({
                      id: row._id as string,
                      label: `${"— ".repeat(Math.max(0, row.depth - 1))}${row.name}`,
                    })),
                  ]}
                  value={categoryId}
                  onChange={(key) => setCategoryId(key == null ? "" : String(key))}
                >
                  {(item) => (
                    <Select.Item id={item.id} key={item.id}>
                      {item.label}
                    </Select.Item>
                  )}
                </Select>
              </div>
              <div className="w-48">
                <Select
                  aria-label="Filter by reorder point"
                  size="sm"
                  placeholder="All stock"
                  items={[
                    { id: "", label: "All stock" },
                    { id: "yes", label: "Below reorder point" },
                  ]}
                  value={lowStock}
                  onChange={(key) => setLowStock(key == null ? "" : String(key))}
                >
                  {(item) => (
                    <Select.Item id={item.id} key={item.id}>
                      {item.label}
                    </Select.Item>
                  )}
                </Select>
              </div>
            </div>
          }
          columns={columns}
          rows={tableRows}
          rowId={(row) => `${row.productId}:${row.variantId ?? ""}:${row.warehouseId}`}
          onRowClick={(row) => {
            const params = new URLSearchParams({ warehouse: row.warehouseId });
            if (row.variantId !== undefined) params.set("variant", row.variantId);
            router.push(`/inventory/stock/${row.productId}?${params.toString()}`);
          }}
          empty={{
            title:
              warehouseId !== "" || categoryId !== "" || lowStock === "yes"
                ? "Nothing matches"
                : "No stock yet",
            description:
              warehouseId !== "" || categoryId !== "" || lowStock === "yes"
                ? "No position fits these filters."
                : "Receipts, transfers, and adjustments show up here once goods move.",
          }}
        />
      )}
    </div>
  );
}
