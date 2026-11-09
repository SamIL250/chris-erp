import { DeliveryDetail } from "@/components/sales/delivery-detail";

/** One packing slip (PH2-14). */
export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeliveryDetail deliveryId={id} />;
}
