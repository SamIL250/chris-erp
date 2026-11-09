import { PurchaseOrderDetail } from "@/components/procurement/purchase-order-detail";
import type { Id } from "@/convex/_generated/dataModel";

/** One draft purchase order (PH2-20). */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderDetail purchaseOrderId={id as Id<"purchaseOrders">} />;
}
