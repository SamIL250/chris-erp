import { VendorDetail } from "@/components/procurement/vendor-detail";

/** Vendor page (PH2-03). The id is the Convex document id. */
export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorDetail vendorId={id} />;
}
