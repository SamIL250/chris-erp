"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Select } from "@/components/base/select/select";
import { PurchaseReturnPanel } from "@/components/procurement/purchase-return-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/** Pick a goods receipt, then return quantity that entered on it (PH2-24). */
export function NewPurchaseReturn() {
  const receipts = useQuery(api.inventory.goodsReceipts.list, {});
  const products = useQuery(api.catalog.products.picker, { search: "" });
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const receipt = useQuery(
    api.inventory.goodsReceipts.get,
    receiptId === null ? "skip" : { receiptId: receiptId as Id<"goodsReceipts"> },
  );

  if (receipts === undefined || products === undefined) return <Skeleton className="h-96" />;

  const lines =
    receipt === undefined
      ? []
      : receipt.lines.map((line) => {
          const product = products.find((item) => item._id === line.productId);
          return {
            lineId: line.lineId,
            name: product?.name ?? "Product",
            sku: product?.sku ?? line.productId,
            receivedQty: line.qty,
            unitCost: line.unitCost ?? null,
          };
        });

  return (
    <div className="space-y-8">
      <PageHeader
        title="New return"
        description="Choose the receipt the goods arrived on. Quantity that was rejected never entered stock, so it is not here."
      />
      <Select
        label="Receipt"
        placeholder="Choose a receipt"
        items={receipts.map((row) => ({
          id: row.receiptId,
          label: `${row.number} · ${row.referenceNote}`,
        }))}
        value={receiptId}
        onChange={(key) => setReceiptId(key == null ? null : String(key))}
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
      {receiptId !== null && receipt === undefined ? <Skeleton className="h-40" /> : null}
      {receiptId !== null && receipt !== undefined ? (
        <PurchaseReturnPanel receiptId={receiptId as Id<"goodsReceipts">} lines={lines} />
      ) : null}
    </div>
  );
}
