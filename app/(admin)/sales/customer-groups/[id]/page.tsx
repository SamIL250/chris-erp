import { CustomerGroupDetail } from "@/components/sales/customer-group-detail";

/** Customer group page (PH2-02). The id is the Convex document id. */
export default async function CustomerGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerGroupDetail groupId={id} />;
}
