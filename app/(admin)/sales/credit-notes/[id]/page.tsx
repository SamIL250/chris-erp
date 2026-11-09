import { CreditDetail } from "@/components/sales/credit-detail";

/** One credit note (PH2-17). */
export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CreditDetail creditNoteId={id} />;
}
