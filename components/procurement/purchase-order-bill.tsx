"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { FormAlert } from "@/components/ui/form";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { priceDayFromInput, priceDayLabel } from "@/lib/pricing";
import type { PurchaseOrderStatus } from "@/lib/purchaseOrders";
import { vendorBillStatusLabel } from "@/lib/vendorBills";

/** Link to the bill on a purchase order, or record one once it is received. */
export function PurchaseOrderBill({
  purchaseOrderId,
  status,
}: {
  purchaseOrderId: Id<"purchaseOrders">;
  status: PurchaseOrderStatus;
}) {
  const bill = useQuery(api.procurement.vendorBills.forPurchaseOrder, { purchaseOrderId });
  const create = useMutation(api.procurement.vendorBills.createFromPurchaseOrder);
  const canEdit = useCan("procurement", "edit");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (bill === undefined) return <span>—</span>;
  if (bill !== null) {
    return (
      <Button color="link-color" href={`/procurement/bills/${bill._id}`}>
        {bill.docNumber} · {vendorBillStatusLabel(bill.status)}
      </Button>
    );
  }
  if (status !== "received" || !canEdit) return <span>—</span>;

  const record = async () => {
    const day = priceDayFromInput(priceDayLabel(Date.now()));
    if ("error" in day) {
      setError(day.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const vendorBillId = await create({ purchaseOrderId, billDate: day.ms });
      router.push(`/procurement/bills/${vendorBillId}`);
    } catch (err) {
      setError(toUserMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {error ? <FormAlert title="Couldn't record the bill" message={error} /> : null}
      <Button color="secondary" size="sm" isLoading={busy} onPress={() => void record()}>
        Record bill
      </Button>
    </div>
  );
}
