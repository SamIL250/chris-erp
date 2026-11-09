"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
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
import { CreditForm } from "@/components/sales/credit-form";
import { ReturnRequestForm } from "@/components/sales/return-form";
import { paymentTermsLabel } from "@/lib/customers";
import { toUserMessage } from "@/lib/errors";
import { formatQty } from "@/lib/inventory-display";
import { invoicePdf } from "@/lib/invoicePdf";
import { invoiceStatusLabel, taxCategoryLabel, type InvoiceStatus } from "@/lib/invoices";
import { pdfCompany } from "@/lib/pdfKit";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";

function statusColor(status: InvoiceStatus): "gray" | "brand" | "success" | "error" {
  switch (status) {
    case "draft":
      return "gray";
    case "posted":
      return "brand";
    case "paid":
      return "success";
    case "void":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function addressText(
  address: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country: string;
  } | null,
): string | null {
  if (address === null) return null;
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ].filter((part) => part !== undefined && part !== "");
  return parts.length === 0 ? null : parts.join(", ");
}

/** One sales invoice: the snapped prices, the tax, and post / void / paid. */
export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const detail = useQuery(api.sales.invoices.get, {
    invoiceId: invoiceId as Id<"salesInvoices">,
  });
  const org = useQuery(api.organization.get, {});
  const post = useMutation(api.sales.invoices.post);
  const voidInvoice = useMutation(api.sales.invoices.voidInvoice);
  const markPaid = useMutation(api.sales.invoices.markPaid);
  const canCreate = useCan("sales", "create");
  const [error, setError] = useState<string | null>(null);
  usePageLabel(detail?.invoice.docNumber);
  const covers = useProductCovers((detail?.lines ?? []).map((line) => line.productId));

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Invoice not found" description="That invoice is not on file." />;
  }

  const { invoice } = detail;
  const money = (amount: number) =>
    `${formatUnitPrice(amount, invoice.decimalPlaces)} ${invoice.currency}`;

  const download = async () => {
    const company = await pdfCompany(org, "Company");
    const bytes = await invoicePdf({
      companyName: company.companyName,
      logo: company.logo,
      footer: company.footer,
      docNumber: invoice.docNumber,
      status: invoice.status,
      customerName: invoice.customerName,
      customerCode: invoice.customerCode,
      currency: invoice.currency,
      decimalPlaces: invoice.decimalPlaces,
      invoiceDate: priceDayLabel(invoice.invoiceDate),
      dueDate: priceDayLabel(invoice.dueDate),
      orderNumber: invoice.orderNumber,
      deliveryNumber: invoice.deliveryNumber,
      billTo: addressText(invoice.billTo),
      lines: detail.lines.map((line) => ({
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        net: line.net,
        tax: line.tax,
        gross: line.gross,
      })),
      breakdown: detail.breakdown,
      net: detail.totals.net,
      tax: detail.totals.tax,
      gross: detail.totals.gross,
    });
    const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${invoice.docNumber}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
      <SalesDocFlow invoiceId={invoice._id} />
      <PageHeader
        title={invoice.docNumber}
        description={`${invoice.customerName} · ${paymentTermsLabel(invoice.paymentTermsDays)}`}
        actions={
          <Badge color={statusColor(invoice.status)} size="md">
            {invoiceStatusLabel(invoice.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the invoice" message={error} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button color="secondary" onPress={() => void download()}>
          Download PDF
        </Button>
        {canCreate && invoice.status === "draft" ? (
          <Button
            color="primary"
            onPress={() => void run(() => post({ invoiceId: invoice._id }), "Invoice posted")}
          >
            Post
          </Button>
        ) : null}
        {canCreate && invoice.status === "draft" ? (
          <Button
            color="secondary"
            onPress={() =>
              void run(() => voidInvoice({ invoiceId: invoice._id }), "Invoice voided")
            }
          >
            Void
          </Button>
        ) : null}
        {canCreate && invoice.status === "posted" ? (
          <Button
            color="secondary"
            onPress={() => void run(() => markPaid({ invoiceId: invoice._id }), "Invoice paid")}
          >
            Mark paid
          </Button>
        ) : null}
      </div>
      <section className="grid gap-4 sm:grid-cols-3">
        <Fact label="Invoice date">{priceDayLabel(invoice.invoiceDate)}</Fact>
        <Fact label="Due">{priceDayLabel(invoice.dueDate)}</Fact>
        <Fact label="Bill to">{addressText(invoice.billTo) ?? "—"}</Fact>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <Total label="Net" value={money(detail.totals.net)} />
        <Total label="Tax" value={money(detail.totals.tax)} />
        <Total label="Total" value={money(detail.totals.gross)} />
      </section>
      <section className="space-y-2">
        <h2 className="text-primary text-md font-semibold">Tax</h2>
        <ul className="divide-secondary divide-y">
          {detail.breakdown.map((slice) => (
            <li
              key={`${slice.taxCategory}-${slice.rateBps}-${slice.inclusive ? "in" : "ex"}`}
              className="flex items-center justify-between gap-3 py-3"
            >
              <p className="text-primary text-sm">
                {taxCategoryLabel(slice.taxCategory)}{" "}
                {(slice.rateBps / 100).toLocaleString("en-GB")}%{" "}
                {slice.inclusive ? "inclusive" : "exclusive"}
              </p>
              <p className="text-secondary text-sm tabular-nums">
                {money(slice.net)} net · {money(slice.tax)} tax
              </p>
            </li>
          ))}
        </ul>
      </section>
      {canCreate && (invoice.status === "posted" || invoice.status === "paid") ? (
        <CreditForm
          invoiceId={invoice._id}
          lines={detail.lines.map((line) => ({
            _id: line._id,
            description: line.description,
            sku: line.sku,
          }))}
        />
      ) : null}
      {canCreate && (invoice.status === "posted" || invoice.status === "paid") ? (
        <ReturnRequestForm
          source="invoice"
          invoiceId={invoice._id}
          lines={detail.lines.map((line) => ({
            _id: line._id,
            description: line.description,
            sku: line.sku,
          }))}
        />
      ) : null}
      {detail.intent !== null ? (
        <p className="text-tertiary text-sm">
          Sales invoice {money(detail.intent.amount)} · {detail.intent.period} ·{" "}
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
                href={`/sales/orders/${invoice.salesOrderId}`}
                className="text-brand-secondary text-sm font-medium"
              >
                {invoice.orderNumber}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: string }) {
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
