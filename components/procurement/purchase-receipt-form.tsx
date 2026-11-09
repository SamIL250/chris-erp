"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { FormAlert } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { purchaseReceiptLineError } from "@/lib/purchaseReceipts";

type ReceiptLine = {
  _id: Id<"purchaseOrderLines">;
  description: string;
  sku: string;
  qty: number;
  acceptedQty: number;
  rejectedQty: number;
};

/**
 * Receive against a sent purchase order. Accepted quantity enters
 * stock. Rejected quantity is recorded and stays out. Serials and lots
 * stay off this form until Phase 5.
 */
export function PurchaseReceiptForm({
  purchaseOrderId,
  lines,
}: {
  purchaseOrderId: Id<"purchaseOrders">;
  lines: ReceiptLine[];
}) {
  const receive = useMutation(api.procurement.purchaseReceipts.receive);
  const warehouses = useQuery(api.inventory.warehouses.list);
  const active = (warehouses ?? []).filter((row) => row.active);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, { accepted: string; rejected: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected =
    warehouseId ?? active.find((row) => row.isDefault)?._id ?? active[0]?._id ?? null;

  const save = async () => {
    if (selected === null) {
      setError("Choose an active warehouse.");
      return;
    }
    const payload: {
      purchaseOrderLineId: Id<"purchaseOrderLines">;
      qtyAccepted: number;
      qtyRejected: number;
    }[] = [];
    for (const line of lines) {
      const entered = qty[line._id] ?? { accepted: "", rejected: "" };
      const accepted = entered.accepted.trim() === "" ? 0 : Number(entered.accepted);
      const rejected = entered.rejected.trim() === "" ? 0 : Number(entered.rejected);
      if (accepted === 0 && rejected === 0) continue;
      const lineError = purchaseReceiptLineError({
        ordered: line.qty,
        alreadyAccepted: line.acceptedQty,
        accepted,
        rejected,
      });
      if (lineError !== null) {
        setError(`${line.sku}: ${lineError}`);
        return;
      }
      payload.push({ purchaseOrderLineId: line._id, qtyAccepted: accepted, qtyRejected: rejected });
    }
    if (payload.length === 0) {
      setError("Enter an accepted or a rejected quantity.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await receive({
        purchaseOrderId,
        warehouseId: selected as Id<"warehouses">,
        lines: payload,
      });
      setQty({});
      toast.success("Goods received");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
      <div>
        <h3 className="text-primary text-sm font-semibold">Receive</h3>
        <p className="text-tertiary text-sm">
          Accepted quantity enters stock at the agreed price. Rejected quantity stays out.
        </p>
      </div>
      {error ? <FormAlert title="Couldn't receive the goods" message={error} /> : null}
      <Select
        label="Warehouse"
        placeholder="Choose a warehouse"
        items={active.map((row) => ({ id: row._id, label: `${row.code} · ${row.name}` }))}
        value={selected}
        onChange={(key) => setWarehouseId(key == null ? null : String(key))}
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
      <ul className="divide-secondary divide-y">
        {lines.map((line) => {
          const open = line.qty - line.acceptedQty;
          const entered = qty[line._id] ?? { accepted: "", rejected: "" };
          return (
            <li key={line._id} className="grid gap-3 py-4 sm:grid-cols-[1fr_8rem_8rem]">
              <div>
                <p className="text-primary text-sm font-medium">{line.description}</p>
                <p className="text-tertiary text-sm">
                  {line.sku} · {open} still open of {line.qty}
                  {line.rejectedQty > 0 ? ` · ${line.rejectedQty} rejected` : ""}
                </p>
              </div>
              <Input
                label="Accepted"
                type="number"
                value={entered.accepted}
                onChange={(value) =>
                  setQty((current) => ({
                    ...current,
                    [line._id]: { accepted: value, rejected: entered.rejected },
                  }))
                }
              />
              <Input
                label="Rejected"
                type="number"
                value={entered.rejected}
                onChange={(value) =>
                  setQty((current) => ({
                    ...current,
                    [line._id]: { accepted: entered.accepted, rejected: value },
                  }))
                }
              />
            </li>
          );
        })}
      </ul>
      <Button color="primary" isLoading={busy} isDisabled={selected === null} onPress={() => void save()}>
        Receive
      </Button>
    </div>
  );
}
