import { openPdf, pdfMoney, pricedColumns, type PdfLogo } from "./pdfKit";
import { quoteStatusLabel, type QuoteStatus } from "./quotes";

/**
 * A one-document quote PDF (PH2-11). The letterhead, table, totals, and
 * footer come from the shared kit (PH2-28).
 */

export type QuotePdfLine = {
  description: string;
  sku: string;
  qty: number;
  unitPrice: number;
  net: number;
  tax: number;
  gross: number;
};

export type QuotePdfInput = {
  companyName: string;
  logo?: PdfLogo | null;
  footer?: string | null;
  docNumber: string;
  status: QuoteStatus;
  customerName: string;
  customerCode: string;
  currency: string;
  decimalPlaces: number;
  quoteDate: string;
  validUntil: string;
  notes: string | null;
  billTo: string | null;
  shipTo: string | null;
  lines: QuotePdfLine[];
  net: number;
  tax: number;
  gross: number;
};

/** PDF bytes for one quote. Helvetica, A4, a further page when the lines run on. */
export async function quotePdf(input: QuotePdfInput): Promise<Uint8Array> {
  const money = (amount: number) => pdfMoney(amount, input.decimalPlaces, input.currency);
  const doc = await openPdf({
    companyName: input.companyName,
    logo: input.logo ?? null,
    footer: input.footer ?? null,
  });
  doc.title(`Quote ${input.docNumber}`);
  doc.line(quoteStatusLabel(input.status));
  doc.gap();
  doc.line(`${input.customerName} (${input.customerCode})`, 12, "bold");
  doc.line(`Date ${input.quoteDate} · Valid until ${input.validUntil}`);
  doc.line(`Currency ${input.currency}`);
  if (input.billTo !== null) doc.line(`Bill to ${input.billTo}`, 10);
  if (input.shipTo !== null) doc.line(`Ship to ${input.shipTo}`, 10);
  doc.gap();
  doc.table(
    pricedColumns(),
    input.lines.map((line) => [
      `${line.description} · ${line.sku}`,
      String(line.qty),
      money(line.unitPrice),
      money(line.net),
      money(line.tax),
      money(line.gross),
    ]),
  );
  doc.totals([
    { label: "Net", value: money(input.net) },
    { label: "Tax", value: money(input.tax) },
    { label: "Total", value: money(input.gross), emphasize: true },
  ]);
  doc.notes(input.notes);
  return doc.save();
}
