import { VendorBillDetail } from "@/components/procurement/vendor-bill-detail";
import type { Id } from "@/convex/_generated/dataModel";

/** One vendor bill (PH2-23). */
export default async function VendorBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorBillDetail vendorBillId={id as Id<"vendorBills">} />;
}
