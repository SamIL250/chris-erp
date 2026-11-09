"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { usePageLabel } from "@/components/shared/page-label";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { useProductCovers } from "@/hooks/use-product-covers";
import { toUserMessage } from "@/lib/errors";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";
import { requisitionStatusLabel, type RequisitionStatus } from "@/lib/requisitions";

function statusColor(status: RequisitionStatus): "gray" | "success" | "error" {
  switch (status) {
    case "draft":
      return "gray";
    case "approved":
      return "success";
    case "rejected":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-tertiary text-sm">{label}</dt>
      <dd className="text-primary text-sm font-medium">{children}</dd>
    </div>
  );
}

/** One requisition: approve, reject, or convert to a draft purchase order. */
export function RequisitionDetail({ requisitionId }: { requisitionId: Id<"requisitions"> }) {
  const detail = useQuery(api.procurement.requisitions.get, { requisitionId });
  const vendors = useQuery(api.procurement.vendors.list, { active: true });
  const canApprove = useCan("procurement", "approve");
  const approve = useMutation(api.procurement.requisitions.approve);
  const reject = useMutation(api.procurement.requisitions.reject);
  const convert = useMutation(api.procurement.requisitions.convert);
  const [reason, setReason] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  usePageLabel(detail?.docNumber);
  const covers = useProductCovers(detail?.lines.map((line) => line.productId) ?? []);

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Requisition" description="That requisition doesn't exist." />;
  }

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

  const vendorItems = (vendors ?? []).map((row) => ({
    id: row._id,
    label: `${row.name} · ${row.code}`,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title={detail.docNumber}
        description={`${detail.requesterName} asked for these goods.`}
        actions={
          <Badge color={statusColor(detail.status)} size="md">
            {requisitionStatusLabel(detail.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the requisition" message={error} /> : null}
      <dl className="bg-primary ring-primary grid gap-4 rounded-xl p-5 ring-1 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Requester">{detail.requesterName}</Fact>
        <Fact label="Need by">{priceDayLabel(detail.needBy)}</Fact>
        <Fact label="Note">{detail.note ?? "—"}</Fact>
        <Fact label="Purchase order">
          {detail.purchaseOrderId !== null && detail.purchaseOrderNumber !== null ? (
            <Button
              color="link-color"
              href={`/procurement/purchase-orders/${detail.purchaseOrderId}`}
            >
              {detail.purchaseOrderNumber}
            </Button>
          ) : (
            "—"
          )}
        </Fact>
      </dl>
      <ul className="bg-primary ring-primary divide-secondary divide-y rounded-xl ring-1">
        {detail.lines.map((line) => (
          <li key={line._id} className="flex items-center justify-between gap-4 px-5 py-4">
            <ProductIdentity
              name={line.description}
              meta={line.sku}
              src={covers.get(line.productId) ?? null}
            />
            <p className="text-primary text-sm">
              {line.qty} × {formatUnitPrice(line.unitPrice, 2)}
            </p>
          </li>
        ))}
      </ul>
      {detail.rejectReason !== null ? (
        <p className="text-tertiary text-sm">Rejected: {detail.rejectReason}</p>
      ) : null}
      {canApprove && detail.status === "draft" ? (
        <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
          <h3 className="text-primary text-sm font-semibold">Decide</h3>
          <div className="flex justify-end">
            <Button
              color="primary"
              isLoading={busy}
              onPress={() => void run(() => approve({ requisitionId }), "Requisition approved")}
            >
              Approve
            </Button>
          </div>
          <TextArea label="Rejection reason" value={reason} onChange={setReason} rows={3} />
          <div className="flex justify-end">
            <Button
              color="secondary"
              isDisabled={busy}
              onPress={() =>
                void run(() => reject({ requisitionId, reason }), "Requisition rejected")
              }
            >
              Reject
            </Button>
          </div>
        </div>
      ) : null}
      {canApprove && detail.status === "approved" && detail.purchaseOrderId === null ? (
        <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
          <h3 className="text-primary text-sm font-semibold">Convert to a purchase order</h3>
          <Select
            label="Vendor"
            placeholder="Choose a vendor"
            items={vendorItems}
            value={vendorId === "" ? null : vendorId}
            onChange={(key) => setVendorId(key == null ? "" : String(key))}
          >
            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
          </Select>
          <div className="flex justify-end">
            <Button
              color="primary"
              isLoading={busy}
              isDisabled={vendorId === ""}
              onPress={() =>
                void run(
                  () => convert({ requisitionId, vendorId: vendorId as Id<"vendors"> }),
                  "Draft purchase order created",
                )
              }
            >
              Convert
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
