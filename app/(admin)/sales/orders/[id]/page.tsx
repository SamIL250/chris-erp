import { OrderDetail } from "@/components/sales/order-detail";

/** One sales order copied from a quote (PH2-11). */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail salesOrderId={id} />;
}
