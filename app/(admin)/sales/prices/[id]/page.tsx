import { PriceListDetail } from "@/components/sales/price-list-detail";

/** One price list (PH2-09). The id is the Convex document id. */
export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PriceListDetail listId={id} />;
}
