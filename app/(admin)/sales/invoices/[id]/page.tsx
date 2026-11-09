import { InvoiceDetail } from "@/components/sales/invoice-detail";

/** One sales invoice (PH2-16). */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetail invoiceId={id} />;
}
