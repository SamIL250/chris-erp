import { CustomerDetail } from "@/components/sales/customer-detail";

/** Customer page (PH2-01). The id is the Convex document id. */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetail customerId={id} />;
}
