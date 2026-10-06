import { ProductEditor } from "@/components/catalog/product-editor";

/** Edit mode of the product editor (PH1-07) — `/catalog/products/:id`. */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductEditor id={id} />;
}
