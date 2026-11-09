"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { ProductIdentity } from "@/components/catalog/product-cover";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
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
import { toUserMessage } from "@/lib/errors";
import { pdfCompany } from "@/lib/pdfKit";
import { formatUnitPrice, priceDayLabel } from "@/lib/pricing";
import { quotePdf } from "@/lib/quotePdf";
import { quoteStatusLabel, type QuoteStatus } from "@/lib/quotes";

function statusColor(status: QuoteStatus): "gray" | "brand" | "success" | "error" {
  switch (status) {
    case "draft":
    case "expired":
      return "gray";
    case "sent":
      return "brand";
    case "accepted":
      return "success";
    case "rejected":
      return "error";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function addressText(
  address:
    | {
        line1: string;
        line2?: string;
        city: string;
        region?: string;
        postalCode?: string;
        country: string;
      }
    | undefined,
): string | null {
  if (address === undefined) return null;
  return [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(", ");
}

/** One quote: lines, discount, tax, validity, PDF, and convert (PH2-11). */
export function QuoteDetail({ quoteId }: { quoteId: string }) {
  const canCreate = useCan("sales", "create");
  const detail = useQuery(api.sales.quotes.get, { quoteId: quoteId as Id<"quotes"> });
  usePageLabel(detail?.quote.docNumber);

  if (detail === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Quote not found" description="That quote is not on file." />;
  }

  return <QuoteBody detail={detail} canCreate={canCreate} />;
}

function QuoteBody({
  detail,
  canCreate,
}: {
  detail: Exclude<ReturnType<typeof useQuery<typeof api.sales.quotes.get>>, undefined | null>;
  canCreate: boolean;
}) {
  const router = useRouter();
  const org = useQuery(api.organization.get, {});
  const covers = useProductCovers(detail.lines.map((line) => line.productId));
  const quote = detail.quote;
  const draft = quote.status === "draft" && canCreate;
  const [error, setError] = useState<string | null>(null);
  const send = useMutation(api.sales.quotes.send);
  const accept = useMutation(api.sales.quotes.accept);
  const reject = useMutation(api.sales.quotes.reject);
  const expire = useMutation(api.sales.quotes.expire);
  const convert = useMutation(api.sales.quotes.convert);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await work();
      toast.success(done);
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  const download = async () => {
    const company = await pdfCompany(org, detail.companyName);
    const bytes = await quotePdf({
      companyName: company.companyName,
      logo: company.logo,
      footer: company.footer,
      docNumber: quote.docNumber,
      status: quote.status,
      customerName: quote.customerName,
      customerCode: quote.customerCode,
      currency: quote.currency,
      decimalPlaces: quote.decimalPlaces,
      quoteDate: priceDayLabel(quote.quoteDate),
      validUntil: priceDayLabel(quote.validUntil),
      notes: quote.notes ?? null,
      billTo: addressText(quote.billTo),
      shipTo: addressText(quote.shipTo),
      lines: detail.lines.map((line) => ({
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        net: line.net,
        tax: line.tax,
        gross: line.gross,
      })),
      net: detail.totals.net,
      tax: detail.totals.tax,
      gross: detail.totals.gross,
    });
    const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${quote.docNumber}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const money = (amount: number) =>
    `${formatUnitPrice(amount, quote.decimalPlaces)} ${quote.currency}`;

  return (
    <div className="space-y-8">
      <SalesDocFlow quoteId={quote._id} />
      <PageHeader
        title={quote.docNumber}
        description={`${quote.customerName} · ${quote.customerCode} · valid until ${priceDayLabel(quote.validUntil)}`}
        actions={
          <Badge color={statusColor(quote.status)} size="md">
            {quoteStatusLabel(quote.status)}
          </Badge>
        }
      />
      {error ? <FormAlert title="Couldn't update the quote" message={error} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button color="secondary" onPress={() => void download()}>
          Download PDF
        </Button>
        {canCreate && quote.status === "draft" ? (
          <Button
            color="primary"
            onPress={() => void run(() => send({ quoteId: quote._id }), "Quote sent")}
          >
            Send
          </Button>
        ) : null}
        {canCreate && quote.status === "sent" ? (
          <Button
            color="primary"
            onPress={() => void run(() => accept({ quoteId: quote._id }), "Quote accepted")}
          >
            Accept
          </Button>
        ) : null}
        {canCreate && (quote.status === "draft" || quote.status === "sent") ? (
          <Button
            color="secondary"
            onPress={() => void run(() => reject({ quoteId: quote._id }), "Quote rejected")}
          >
            Reject
          </Button>
        ) : null}
        {canCreate && (quote.status === "draft" || quote.status === "sent") ? (
          <Button
            color="secondary"
            onPress={() => void run(() => expire({ quoteId: quote._id }), "Quote expired")}
          >
            Expire
          </Button>
        ) : null}
        {canCreate && quote.status === "accepted" && detail.salesOrder === null ? (
          <Button
            color="primary"
            onPress={() =>
              void run(async () => {
                const orderId = await convert({ quoteId: quote._id });
                router.push(`/sales/orders/${orderId}`);
              }, "Order opened")
            }
          >
            Convert to order
          </Button>
        ) : null}
        {detail.salesOrder !== null ? (
          <Button color="secondary" href={`/sales/orders/${detail.salesOrder._id}`}>
            {detail.salesOrder.docNumber}
          </Button>
        ) : null}
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Total label="Net" value={money(detail.totals.net)} />
        <Total label="Tax" value={money(detail.totals.tax)} />
        <Total label="Total" value={money(detail.totals.gross)} />
      </section>

      {draft ? (
        <QuoteHeaderForm quote={quote} />
      ) : (
        <section className="text-secondary space-y-1 text-sm">
          <p>
            {addressText(quote.billTo)
              ? `Bill to ${addressText(quote.billTo)}`
              : "No bill-to address."}
          </p>
          <p>
            {addressText(quote.shipTo)
              ? `Ship to ${addressText(quote.shipTo)}`
              : "No ship-to address."}
          </p>
          {quote.notes ? <p>{quote.notes}</p> : null}
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-primary text-md font-semibold">Lines</h2>
        {detail.lines.length === 0 ? (
          <p className="text-tertiary text-sm">No lines yet. Add a product to price the quote.</p>
        ) : (
          <ul className="divide-secondary divide-y">
            {detail.lines.map((line) => (
              <QuoteLine
                key={line._id}
                line={line}
                draft={draft}
                money={money}
                coverSrc={covers.get(line.productId) ?? null}
              />
            ))}
          </ul>
        )}
        {draft ? <AddLine quoteId={quote._id} /> : null}
      </section>
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

function QuoteHeaderForm({
  quote,
}: {
  quote: {
    _id: Id<"quotes">;
    customerId: Id<"customers">;
    validUntil: number;
    notes?: string;
  };
}) {
  const update = useMutation(api.sales.quotes.update);
  const customer = useQuery(api.sales.customers.get, { customerId: quote.customerId });
  const [validUntil, setValidUntil] = useState(priceDayLabel(quote.validUntil));
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [billTo, setBillTo] = useState("keep");
  const [shipTo, setShipTo] = useState("keep");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addresses = customer?.addresses ?? [];
  const addressItems = [
    { id: "keep", label: "Keep the address on the quote" },
    { id: "none", label: "No address" },
    ...addresses.map((row) => ({ id: row._id, label: `${row.line1}, ${row.city}` })),
  ];

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await update({
        quoteId: quote._id,
        validUntil,
        notes: notes.trim() === "" ? null : notes,
        ...(billTo === "keep"
          ? {}
          : { billToAddressId: billTo === "none" ? null : (billTo as Id<"customerAddresses">) }),
        ...(shipTo === "keep"
          ? {}
          : { shipToAddressId: shipTo === "none" ? null : (shipTo as Id<"customerAddresses">) }),
      });
      toast.success("Quote saved");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
      <h2 className="text-primary text-md font-semibold">Quote</h2>
      {error ? <FormAlert title="Couldn't save the quote" message={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Valid until" type="date" value={validUntil} onChange={setValidUntil} />
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={3} />
        <Select
          label="Bill to"
          items={addressItems}
          value={billTo}
          onChange={(key) => setBillTo(key == null ? "keep" : String(key))}
        >
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
        <Select
          label="Ship to"
          items={addressItems}
          value={shipTo}
          onChange={(key) => setShipTo(key == null ? "keep" : String(key))}
        >
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
      </div>
      <div className="flex justify-end">
        <Button color="primary" isLoading={busy} onPress={() => void save()}>
          Save
        </Button>
      </div>
    </section>
  );
}

function QuoteLine({
  line,
  draft,
  money,
  coverSrc,
}: {
  coverSrc: string | null;
  line: {
    _id: Id<"quoteLines">;
    description: string;
    sku: string;
    qty: number;
    unitPrice: number;
    resolvedUnitPrice: number;
    discountPercent: number;
    net: number;
    tax: number;
    gross: number;
    rateBps: number;
    overrideStatus: "applied" | "pending" | "approved" | "rejected" | null;
  };
  draft: boolean;
  money: (amount: number) => string;
}) {
  const remove = useMutation(api.sales.quotes.removeLine);
  const setDiscount = useMutation(api.sales.quotes.setDiscount);
  const clearDiscount = useMutation(api.sales.quotes.clearDiscount);
  const [percent, setPercent] = useState(
    line.discountPercent > 0 ? String(line.discountPercent) : "",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    const discountPercent = Number(percent);
    if (!Number.isFinite(discountPercent) || discountPercent <= 0) {
      setError("Enter a discount above zero.");
      return;
    }
    setError(null);
    try {
      await setDiscount({ lineId: line._id, discountPercent, reason });
      toast.success(discountPercent > 10 ? "Discount waiting for approval" : "Discount applied");
      setReason("");
    } catch (err) {
      setError(toUserMessage(err));
    }
  };

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <ProductIdentity name={line.description} src={coverSrc} />
          <p className="text-tertiary mt-1 text-sm">
            {line.sku} · {line.qty} × {money(line.unitPrice)}
            {line.discountPercent > 0
              ? ` · ${line.discountPercent}% off the resolved ${money(line.resolvedUnitPrice)}`
              : ""}
            {line.rateBps > 0 ? ` · tax ${(line.rateBps / 100).toFixed(2)}%` : " · no tax"}
          </p>
          {line.overrideStatus === "pending" ? (
            <p className="text-fg-warning-primary text-sm">
              Waiting for a second person. The line still charges the resolved price.
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-primary text-sm font-medium tabular-nums">{money(line.gross)}</p>
          <p className="text-tertiary text-sm tabular-nums">
            Net {money(line.net)} · Tax {money(line.tax)}
          </p>
        </div>
      </div>
      {error ? <FormAlert title="Couldn't change the line" message={error} /> : null}
      {draft ? (
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Discount %"
            size="sm"
            value={percent}
            onChange={setPercent}
            className="w-28"
          />
          <Input
            label="Reason"
            size="sm"
            value={reason}
            onChange={setReason}
            className="min-w-48 flex-1"
          />
          <Button size="sm" color="secondary" onPress={() => void apply()}>
            Apply discount
          </Button>
          {line.discountPercent > 0 ? (
            <Button
              size="sm"
              color="secondary"
              onPress={() =>
                void clearDiscount({ lineId: line._id })
                  .then(() => toast.success("Discount cleared"))
                  .catch((err: unknown) => setError(toUserMessage(err)))
              }
            >
              Clear
            </Button>
          ) : null}
          <Button
            size="sm"
            color="secondary"
            onPress={() =>
              void remove({ lineId: line._id })
                .then(() => toast.success("Line removed"))
                .catch((err: unknown) => setError(toUserMessage(err)))
            }
          >
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function AddLine({ quoteId }: { quoteId: Id<"quotes"> }) {
  const add = useMutation(api.sales.quotes.addLine);
  const [search, setSearch] = useState("");
  const products = useQuery(api.catalog.products.picker, { search });
  const [productId, setProductId] = useState("");
  const variants = useQuery(
    api.catalog.variants.list,
    productId === "" ? "skip" : { productId: productId as Id<"products"> },
  );
  const [variantId, setVariantId] = useState("product");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (productId === "") {
      setError("Choose a product.");
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await add({
        quoteId,
        productId: productId as Id<"products">,
        variantId: variantId === "product" ? null : (variantId as Id<"variants">),
        qty: quantity,
      });
      toast.success("Line added");
      setQty("1");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const productItems = (products ?? []).map((row) => ({
    id: row._id,
    label: `${row.name} · ${row.sku}`,
    avatarUrl: row.coverUrl ?? undefined,
  }));
  const variantItems = [
    { id: "product", label: "Product" },
    ...(variants ?? []).map((row) => ({ id: row._id, label: row.sku })),
  ];

  return (
    <div className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
      <h3 className="text-primary text-sm font-semibold">Add a line</h3>
      {error ? <FormAlert title="Couldn't add the line" message={error} /> : null}
      <Input label="Find a product" placeholder="Name or SKU" value={search} onChange={setSearch} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Product"
          placeholder="Choose a product"
          items={productItems}
          value={productId === "" ? null : productId}
          onChange={(key) => {
            setProductId(key == null ? "" : String(key));
            setVariantId("product");
          }}
        >
          {(item) => (
            <Select.Item id={item.id} avatarUrl={item.avatarUrl}>
              {item.label}
            </Select.Item>
          )}
        </Select>
        <Select
          label="Variant"
          items={variantItems}
          value={variantId}
          isDisabled={productId === ""}
          onChange={(key) => setVariantId(key == null ? "product" : String(key))}
        >
          {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
        </Select>
        <Input label="Quantity" type="number" value={qty} onChange={setQty} />
      </div>
      <div className="flex justify-end">
        <Button color="primary" isLoading={busy} onPress={() => void save()}>
          Add line
        </Button>
      </div>
    </div>
  );
}
