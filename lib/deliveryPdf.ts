import { deliveryStatusLabel, type DeliveryStatus } from "./deliveries";
import { openPdf, qtyColumns, type PdfLogo } from "./pdfKit";

/**
 * Packing-slip and pick-list PDFs (PH2-15). The letterhead and table come
 * from the shared kit (PH2-28). A slip names what to pack and where it
 * goes. It does not print the unit cost.
 */

export type DeliveryPdfLine = {
  description: string;
  sku: string;
  qty: number;
};

export type DeliveryPdfInput = {
  companyName: string;
  logo?: PdfLogo | null;
  footer?: string | null;
  docNumber: string;
  status: DeliveryStatus;
  orderNumber: string;
  customerName: string;
  customerCode: string;
  warehouseCode: string;
  warehouseName: string;
  shipTo: string | null;
  shippedOn: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  lines: DeliveryPdfLine[];
};

export type PickListPdfLine = {
  description: string;
  sku: string;
  qty: number;
};

export type PickListPdfOrder = {
  docNumber: string;
  customerName: string;
  lines: PickListPdfLine[];
};

export type PickListPdfGroup = {
  code: string;
  name: string;
  orders: PickListPdfOrder[];
};

export type PickListPdfInput = {
  companyName: string;
  logo?: PdfLogo | null;
  footer?: string | null;
  printedOn: string;
  groups: PickListPdfGroup[];
};

/** PDF bytes for one packing slip. Helvetica, A4. */
export async function deliveryPdf(input: DeliveryPdfInput): Promise<Uint8Array> {
  const doc = await openPdf({
    companyName: input.companyName,
    logo: input.logo ?? null,
    footer: input.footer ?? null,
  });
  doc.title(`Packing slip ${input.docNumber}`);
  doc.line(deliveryStatusLabel(input.status));
  doc.line(`Order ${input.orderNumber}`);
  doc.line(`${input.customerName} (${input.customerCode})`, 12, "bold");
  doc.line(`Warehouse ${input.warehouseCode} · ${input.warehouseName}`);
  doc.line(input.shipTo === null ? "No ship-to address" : `Ship to ${input.shipTo}`, 10);
  if (input.shippedOn !== null) doc.line(`Shipped ${input.shippedOn}`);
  if (input.carrier !== null) doc.line(`Carrier ${input.carrier}`);
  if (input.trackingNumber !== null) doc.line(`Tracking ${input.trackingNumber}`);
  doc.gap();
  doc.table(
    qtyColumns(),
    input.lines.map((line) => [`${line.description} · ${line.sku}`, String(line.qty)]),
  );
  return doc.save();
}

/** PDF bytes for the pick list, one section per warehouse. */
export async function pickListPdf(input: PickListPdfInput): Promise<Uint8Array> {
  const doc = await openPdf({
    companyName: input.companyName,
    logo: input.logo ?? null,
    footer: input.footer ?? null,
  });
  doc.title("Pick list");
  doc.line(input.printedOn);
  if (input.groups.length === 0) {
    doc.line("Nothing is waiting to pick.");
    return doc.save();
  }
  for (const group of input.groups) {
    doc.gap();
    doc.line(`${group.code} · ${group.name}`, 13, "bold");
    for (const order of group.orders) {
      doc.line(`${order.docNumber} · ${order.customerName}`, 11, "bold");
      doc.table(
        qtyColumns(),
        order.lines.map((line) => [`${line.description} · ${line.sku}`, String(line.qty)]),
      );
    }
  }
  return doc.save();
}
