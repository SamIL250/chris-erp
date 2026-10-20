import { VariantsEditor } from "@/components/catalog/variants-editor";

/** Variant matrix editor (PH1-09) — `/catalog/products/:id/variants`. */
export default async function VariantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VariantsEditor id={id} />;
}
