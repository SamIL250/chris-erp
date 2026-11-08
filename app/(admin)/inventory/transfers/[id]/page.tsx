import { TransferDetail } from "@/components/inventory/transfer-detail";

/** One transfer: ship, receive, or cancel (PH1-23). */
export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferDetail id={id} />;
}
