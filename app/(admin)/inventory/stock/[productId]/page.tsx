import { Suspense } from "react";
import { StockDetail } from "@/components/inventory/stock-detail";
import { Skeleton } from "@/components/ui/skeleton";

/** Ledger and reserves for one product (PH1-23). */
export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <StockDetail productId={productId} />
    </Suspense>
  );
}
