import type { ReactNode } from "react";
import { AdminShell } from "@/components/shared/admin-shell";
import { PermissionGate } from "@/components/shared/permission-gate";

/** Admin chrome for all `/(admin)` pages (PH0-12), permission-gated (PH0-23). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminShell>
      <PermissionGate>{children}</PermissionGate>
    </AdminShell>
  );
}
