import { PurchaseReturnDetail } from "@/components/procurement/purchase-return-detail";
import type { Id } from "@/convex/_generated/dataModel";

/** One vendor return (PH2-24). */
export default async function PurchaseReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseReturnDetail purchaseReturnId={id as Id<"purchaseReturns">} />;
}
