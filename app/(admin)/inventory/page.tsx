import { redirect } from "next/navigation";

/** Inventory index: the stock list is the home of the module (PH1-23). */
export default function InventoryIndexPage() {
  redirect("/inventory/stock");
}
