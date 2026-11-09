"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { usePageLabel } from "@/components/shared/page-label";
import { useProductCovers } from "@/hooks/use-product-covers";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { formatQty, transferStatusLabel } from "@/lib/inventory-display";

const STATUS_COLOR = {
  draft: "warning",
  inTransit: "brand",
  received: "success",
  cancelled: "gray",
} as const;

/** Ship a draft, receive part or all of an in-transit transfer, or cancel. */
export function TransferDetail({ id }: { id: string }) {
  const transfer = useQuery(api.inventory.transfers.get, {
    transferId: id as Id<"stockTransfers">,
  });
  const warehouses = useQuery(api.inventory.warehouses.list);
  const products = useQuery(api.catalog.products.picker, { search: "" });
  const covers = useProductCovers((transfer?.lines ?? []).map((line) => line.productId));
  const ship = useMutation(api.inventory.transfers.ship);
  const receive = useMutation(api.inventory.transfers.receive);
  const cancel = useMutation(api.inventory.transfers.cancel);
  const canEdit = useCan("inventory", "edit");
  const canDelete = useCan("inventory", "delete");
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePageLabel(transfer?.number);

  const nameOf = (warehouseId: string) => {
    const warehouse = warehouses?.find((row) => row._id === warehouseId);
    return warehouse ? `${warehouse.code} · ${warehouse.name}` : "—";
  };
  const productOf = (productId: string) => {
    const product = products?.find((row) => row._id === productId);
    return product ? `${product.name} · ${product.sku}` : productId;
  };

  if (transfer === undefined) return <Skeleton className="h-96" />;

  const run = async (action: () => Promise<unknown>, success: string) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setQtyByLine({});
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const receiveLines = () => {
    const lines = transfer.lines.flatMap((line) => {
      const raw = qtyByLine[line.lineId];
      if (raw === undefined || raw.trim() === "") return [];
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty <= 0) return [];
      return [{ lineId: line.lineId, qty }];
    });
    if (lines.length === 0) {
      setError("Enter the quantity that arrived on at least one line.");
      return;
    }
    void run(() => receive({ transferId: transferId(id), lines }), "Receipt posted");
  };

  const lineRows = transfer.lines.map((row) => {
    const product = products?.find((item) => item._id === row.productId);
    return {
      ...row,
      coverSrc: covers.get(row.productId) ?? product?.coverUrl ?? null,
      productName: product?.name ?? "Product",
      productSku: product?.sku ?? row.productId,
    };
  });

  const columns: DataTableColumn<(typeof lineRows)[number]>[] = [
    {
      id: "product",
      header: "Product",
      cell: (row) => (
        <ProductIdentity name={row.productName} meta={row.productSku} src={row.coverSrc} />
      ),
    },
    {
      id: "qty",
      header: "Shipped",
      cell: (row) => <span className="text-sm tabular-nums">{formatQty(row.qty)}</span>,
    },
    {
      id: "received",
      header: "Received",
      cell: (row) => <span className="text-sm tabular-nums">{formatQty(row.receivedQty)}</span>,
    },
    {
      id: "outstanding",
      header: "Still to arrive",
      cell: (row) => <span className="text-sm tabular-nums">{formatQty(row.outstanding)}</span>,
    },
    {
      id: "now",
      header: "Receive now",
      cell: (row) =>
        transfer.status === "inTransit" && canEdit && row.outstanding > 0 ? (
          <Input
            aria-label={`Receive quantity for ${productOf(row.productId)}`}
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={qtyByLine[row.lineId] ?? ""}
            onChange={(value) => setQtyByLine((current) => ({ ...current, [row.lineId]: value }))}
          />
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={transfer.number}
        description={`${nameOf(transfer.fromWarehouseId)} → ${nameOf(transfer.toWarehouseId)}${transfer.note ? ` · ${transfer.note}` : ""}`}
        actions={
          <Badge color={STATUS_COLOR[transfer.status]} size="md">
            {transferStatusLabel(transfer.status)}
          </Badge>
        }
      />
      {error ? <FormAlert message={error} /> : null}
      <DataTable
        title="Lines"
        columns={columns}
        rows={lineRows}
        rowId={(row) => row.lineId}
        empty={{ title: "No lines", description: "This transfer has nothing to move." }}
      />
      <div className="flex flex-wrap justify-end gap-3">
        {transfer.status === "draft" && canDelete ? (
          <Button
            color="tertiary-destructive"
            isLoading={busy}
            onPress={() =>
              void run(() => cancel({ transferId: transferId(id) }), "Transfer cancelled")
            }
          >
            Cancel transfer
          </Button>
        ) : null}
        {transfer.status === "draft" && canEdit ? (
          <Button
            color="primary"
            isLoading={busy}
            onPress={() => void run(() => ship({ transferId: transferId(id) }), "Goods shipped")}
          >
            Ship
          </Button>
        ) : null}
        {transfer.status === "inTransit" && canEdit ? (
          <Button color="primary" isLoading={busy} onPress={receiveLines}>
            Receive
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function transferId(id: string): Id<"stockTransfers"> {
  return id as Id<"stockTransfers">;
}
