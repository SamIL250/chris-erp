import { ReceiptDetail } from "@/components/inventory/receipt-detail";

/** A posted goods receipt (PH1-23). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptDetail id={id} />;
}
