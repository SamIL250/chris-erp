import { taxCategoryLabel, type InvoiceStatus, invoiceStatusLabel } from "./invoices";
import { openPdf, pdfMoney, pricedColumns, type PdfLogo } from "./pdfKit";
import type { TaxCategory } from "./quotes";

/**
 * A one-document invoice PDF (PH2-16). The letterhead, table, totals, and
 * footer come from the shared kit (PH2-28). The page names who is billed,
 * the snapped prices, and the tax breakdown. It does not print the unit cost.
 */

export type InvoicePdfLine = {
  description: string;
  sku: string;
  qty: number;
  unitPrice: number;
  net: number;
  tax: number;
  gross: number;
};

export type InvoicePdfTax = {
  taxCategory: TaxCategory;
  rateBps: number;
  inclusive: boolean;
  net: number;
  tax: number;
};

export type InvoicePdfInput = {
  companyName: string;
  logo?: PdfLogo | null;
  footer: string | null;
  docNumber: string;
  status: InvoiceStatus;
  customerName: string;
  customerCode: string;
  currency: string;
  decimalPlaces: number;
  invoiceDate: string;
  dueDate: string;
  orderNumber: string;
  deliveryNumber: string | null;
  billTo: string | null;
  lines: InvoicePdfLine[];
  breakdown: InvoicePdfTax[];
  net: number;
  tax: number;
  gross: number;
};

function rateLabel(slice: InvoicePdfTax): string {
  const percent = (slice.rateBps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  const treatment = slice.inclusive ? "inclusive" : "exclusive";
  return `${taxCategoryLabel(slice.taxCategory)} ${percent}% ${treatment}`;
}

/** PDF bytes for one invoice. Helvetica, A4, a further page when the lines run on. */
export async function invoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const money = (amount: number) => pdfMoney(amount, input.decimalPlaces, input.currency);
  const doc = await openPdf({
    companyName: input.companyName,
    logo: input.logo ?? null,
    footer: input.footer,
  });
  doc.title(`Invoice ${input.docNumber}`);
  doc.line(invoiceStatusLabel(input.status));
  doc.gap();
  doc.line(`${input.customerName} (${input.customerCode})`, 12, "bold");
  doc.line(`Date ${input.invoiceDate} · Due ${input.dueDate}`);
  doc.line(`Order ${input.orderNumber}`);
  if (input.deliveryNumber !== null) doc.line(`Delivery ${input.deliveryNumber}`);
  doc.line(input.billTo === null ? "No bill-to address" : `Bill to ${input.billTo}`, 10);
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
  if (input.breakdown.length > 0) {
    doc.gap();
    doc.line("Tax", 11, "bold");
    for (const slice of input.breakdown) {
      doc.line(`${rateLabel(slice)} · net ${money(slice.net)} · tax ${money(slice.tax)}`, 10);
    }
  }
  doc.totals([
    { label: "Net", value: money(input.net) },
    { label: "Tax", value: money(input.tax) },
    { label: "Total", value: money(input.gross), emphasize: true },
  ]);
  return doc.save();
}
