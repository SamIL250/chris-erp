import { ReturnDetail } from "@/components/sales/return-detail";

/** One sales return (PH2-18). */
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnDetail salesReturnId={id} />;
}
