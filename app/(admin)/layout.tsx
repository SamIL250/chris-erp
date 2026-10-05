import type { ReactNode } from "react";
import { AdminShell } from "@/components/shared/admin-shell";

/** Admin chrome for all `/(admin)` pages (PH0-12). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
