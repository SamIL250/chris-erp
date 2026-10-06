import { redirect } from "next/navigation";

/**
 * Products index stub (PH1-07): the reactive list — filters, search, bulk
 * status — lands with PH1-08. Until then the sidebar's Products entry
 * funnels here into the editor, mirroring the PH1-02 `/catalog` →
 * Categories redirect precedent.
 */
export default function ProductsIndexPage() {
  redirect("/catalog/products/new");
}
