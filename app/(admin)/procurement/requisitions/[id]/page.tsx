import { RequisitionDetail } from "@/components/procurement/requisition-detail";
import type { Id } from "@/convex/_generated/dataModel";

/** One requisition (PH2-20). */
export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequisitionDetail requisitionId={id as Id<"requisitions">} />;
}
