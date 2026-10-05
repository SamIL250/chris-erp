import { redirect } from "next/navigation";

/**
 * Catalog index (PH1-02): Categories is the only section for now — this
 * landing route keeps the sidebar's `/catalog` link useful and hands over
 * to Products when PH1-08 lands.
 */
export default function CatalogIndexPage() {
  redirect("/catalog/categories");
}
