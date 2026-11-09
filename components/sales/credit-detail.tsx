"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { SalesDocFlow } from "@/components/shared/doc-flow";
import { usePageLabel } from "@/components/shared/page-label";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { useProductCovers } from "@/hooks/use-product-covers";
import { creditKindLabel, creditStatusLabel, type CreditStatus } from "@/lib/creditNotes";
import { toUserMessage } from "@/lib/errors";
import { formatQty } from "@/lib/inventory-display";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";

function statusColor(status: CreditStatus): "gray" | "brand" | "error" {
  switch (status) {
    case "draft":
      return "gray";
    case "posted":
      return "brand";
    case "void":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** One credit note: the invoice it reduces, and whether the goods come back. */
export function CreditDetail({ creditNoteId }: { creditNoteId: string }) {
  const detail = useQuery(api.sales.creditNotes.get, {
    creditNoteId: creditNoteId as Id<"creditNotes">,
  });
  const post = useMutation(api.sales.creditNotes.post);
  const voidCredit = useMutation(api.sales.creditNotes.voidCredit);
  const canCreate = useCan("sales", "create");
  const [error, setError] = useState<string | null>(null);
  usePageLabel(detail?.credit.docNumber);
  const covers = useProductCovers((detail?.lines ?? []).map((line) => line.productId));

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return (
      <PageHeader title="Credit note not found" description="That credit note is not on file." />
    );
  }

  const { credit } = detail;
  const money = (amount: number) =>
    `${formatUnitPrice(amount, credit.decimalPlaces)} ${credit.currency}`;

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await work();
      toast.success(done);
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  return (
    <div className="space-y-8">
      <SalesDocFlow creditNoteId={credit._id} />
      <PageHeader
        title={credit.docNumber}
        description={`${credit.customerName} · ${creditKindLabel(credit.kind)}`}
        actions={
          <Badge color={statusColor(credit.status)} size="md">
            {creditStatusLabel(credit.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the credit note" message={error} /> : null}
      <div className="flex flex-wrap gap-3">
        {canCreate && credit.status === "draft" ? (
          <Button
            color="primary"
            onPress={() => void run(() => post({ creditNoteId: credit._id }), "Credit posted")}
          >
            Post
          </Button>
        ) : null}
        {canCreate && credit.status === "draft" ? (
          <Button
            color="secondary"
            onPress={() =>
              void run(() => voidCredit({ creditNoteId: credit._id }), "Credit voided")
            }
          >
            Void
          </Button>
        ) : null}
      </div>
      <section className="grid gap-4 sm:grid-cols-3">
        <Fact label="Date">{priceDayLabel(credit.creditDate)}</Fact>
        <Fact label="Reason">{credit.reason}</Fact>
        <Fact label="Stock">
          {credit.restock
            ? credit.warehouseCode === null
              ? "Goes back into stock"
              : `Back at ${credit.warehouseCode}`
            : "Stays out of stock"}
        </Fact>
        {credit.salesReturnId !== null ? (
          <Fact label="Return">
            <Link href={`/sales/returns/${credit.salesReturnId}`} className="hover:underline">
              {credit.returnNumber}
            </Link>
          </Fact>
        ) : null}
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <Total label="Net" value={money(detail.totals.net)} />
        <Total label="Tax" value={money(detail.totals.tax)} />
        <Total label="Total" value={money(detail.totals.gross)} />
      </section>
      {detail.intent !== null ? (
        <p className="text-tertiary text-sm">
          Credit note {money(detail.intent.amount)} · {detail.intent.period} ·{" "}
          {detail.intent.status}
        </p>
      ) : null}
      <ul className="divide-secondary divide-y">
        {detail.lines.map((line) => (
          <li key={line._id} className="flex items-center justify-between gap-3 py-3">
            <ProductIdentity
              name={line.description}
              meta={line.sku}
              src={covers.get(line.productId) ?? null}
            />
            <div className="text-right">
              <p className="text-secondary text-sm tabular-nums">
                {formatQty(line.qty)} × {money(line.unitPrice)}
              </p>
              <p className="text-primary text-sm font-medium tabular-nums">{money(line.gross)}</p>
              <Link
                href={`/sales/invoices/${credit.invoiceId}`}
                className="text-brand-secondary text-sm font-medium"
              >
                {credit.invoiceNumber}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-tertiary text-sm">{label}</p>
      <p className="text-primary text-sm font-medium">{children}</p>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-primary ring-primary rounded-xl p-4 ring-1">
      <p className="text-tertiary text-sm">{label}</p>
      <p className="text-primary text-md font-semibold tabular-nums">{value}</p>
    </div>
  );
}
