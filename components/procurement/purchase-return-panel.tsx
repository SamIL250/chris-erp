"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { FormAlert } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { formatQty, formatValue } from "@/lib/inventory-display";
import { purchaseReturnQtyError, purchaseReturnReasonError } from "@/lib/purchaseReturns";

type SourceLine = {
  lineId: Id<"goodsReceiptLines">;
  name: string;
  sku: string;
  receivedQty: number;
  unitCost: number | null;
};

/**
 * Return quantity from one goods receipt. Each line that leaves posts
 * a stock issue. The debit note number is assigned when this posts.
 */
export function PurchaseReturnPanel({
  receiptId,
  lines,
}: {
  receiptId: Id<"goodsReceipts">;
  lines: SourceLine[];
}) {
  const router = useRouter();
  const progress = useQuery(api.procurement.purchaseReturns.forReceipt, {
    goodsReceiptId: receiptId,
  });
  const create = useMutation(api.procurement.purchaseReturns.create);
  const canReturn = useCan("inventory", "create");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (progress === undefined) return null;

  const openLines = lines.flatMap((line) => {
    const row = progress.lines.find((item) => item.goodsReceiptLineId === line.lineId);
    if (row === undefined || row.returnableQty <= 0) return [];
    return [{ ...line, returnableQty: row.returnableQty, returnedQty: row.returnedQty }];
  });

  const save = async () => {
    const reasonError = purchaseReturnReasonError(reason);
    if (reasonError !== null) {
      setError(reasonError);
      return;
    }
    const payload: { goodsReceiptLineId: Id<"goodsReceiptLines">; qty: number }[] = [];
    for (const line of openLines) {
      const entered = qty[line.lineId] ?? "";
      if (entered.trim() === "") continue;
      const quantity = Number(entered);
      const lineError = purchaseReturnQtyError({
        received: line.receivedQty,
        alreadyReturned: line.returnedQty,
        qty: quantity,
      });
      if (lineError !== null) {
        setError(`${line.sku}: ${lineError}`);
        return;
      }
      payload.push({ goodsReceiptLineId: line.lineId, qty: quantity });
    }
    if (payload.length === 0) {
      setError("Enter a quantity to return.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await create({ goodsReceiptId: receiptId, reason, lines: payload });
      toast.success("Returned to the vendor");
      router.push(`/procurement/returns/${id}`);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {progress.returns.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {progress.returns.map((row) => (
            <Button key={row._id} color="link-color" href={`/procurement/returns/${row._id}`}>
              {row.docNumber}
            </Button>
          ))}
        </div>
      ) : null}
      {canReturn && openLines.length > 0 ? (
        <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
          <div>
            <h3 className="text-primary text-sm font-semibold">Return to vendor</h3>
            <p className="text-tertiary text-sm">
              Quantity that entered on this receipt can leave stock. The debit note number is the
              reference.
            </p>
          </div>
          {error ? <FormAlert title="Couldn't return the goods" message={error} /> : null}
          <Input label="Reason" value={reason} onChange={setReason} />
          <ul className="divide-secondary divide-y">
            {openLines.map((line) => (
              <li key={line.lineId} className="grid gap-3 py-4 sm:grid-cols-[1fr_8rem]">
                <div>
                  <p className="text-primary text-sm font-medium">{line.name}</p>
                  <p className="text-tertiary text-sm">
                    {line.sku} · {formatQty(line.returnableQty)} still here of{" "}
                    {formatQty(line.receivedQty)}
                    {line.unitCost !== null ? ` · ${formatValue(line.unitCost)}` : ""}
                  </p>
                </div>
                <Input
                  label="Return"
                  type="number"
                  value={qty[line.lineId] ?? ""}
                  onChange={(value) => setQty((current) => ({ ...current, [line.lineId]: value }))}
                />
              </li>
            ))}
          </ul>
          <Button color="primary" isLoading={busy} onPress={() => void save()}>
            Return
          </Button>
        </div>
      ) : null}
    </div>
  );
}
