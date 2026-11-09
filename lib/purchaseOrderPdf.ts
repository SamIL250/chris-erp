import { openPdf, pdfMoney, pricedColumns, type PdfLogo } from "./pdfKit";
import { purchaseOrderStatusLabel, type PurchaseOrderStatus } from "./purchaseOrders";

/**
 * A one-document purchase order PDF (PH2-21). The letterhead, table,
 * totals, and footer come from the shared kit (PH2-28). Email waits
 * until Phase 4 wires Resend.
 */

export type PurchaseOrderPdfLine = {
  description: string;
  sku: string;
  qty: number;
  unitPrice: number;
  net: number;
  tax: number;
  gross: number;
};

export type PurchaseOrderPdfInput = {
  companyName: string;
  logo?: PdfLogo | null;
  footer?: string | null;
  docNumber: string;
  status: PurchaseOrderStatus;
  vendorName: string;
  vendorCode: string;
  currency: string;
  decimalPlaces: number;
  expectedDate: string;
  requisitionNumber: string | null;
  lines: PurchaseOrderPdfLine[];
  net: number;
  tax: number;
  gross: number;
};

/** PDF bytes for one purchase order. Helvetica, A4, a further page when the lines run on. */
export async function purchaseOrderPdf(input: PurchaseOrderPdfInput): Promise<Uint8Array> {
  const money = (amount: number) => pdfMoney(amount, input.decimalPlaces, input.currency);
  const doc = await openPdf({
    companyName: input.companyName,
    logo: input.logo ?? null,
    footer: input.footer ?? null,
  });
  doc.title(`Purchase order ${input.docNumber}`);
  doc.line(purchaseOrderStatusLabel(input.status));
  doc.gap();
  doc.line(`${input.vendorName} (${input.vendorCode})`, 12, "bold");
  doc.line(`Expected ${input.expectedDate}`);
  if (input.requisitionNumber !== null) doc.line(`Requisition ${input.requisitionNumber}`);
  doc.line(`Currency ${input.currency}`);
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
  return doc.save();
}
