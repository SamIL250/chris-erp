import { QuoteDetail } from "@/components/sales/quote-detail";

/** One quote (PH2-11). */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteDetail quoteId={id} />;
}
