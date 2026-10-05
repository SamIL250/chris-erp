import { StatTileGrid } from "@/components/ui/charts";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Dashboard placeholder (PH0-15): KPI tiles show `—` until the modules that
 * produce the data ship (sales, inventory, finance, service).
 */
const KPIS = [
  { label: "Revenue (month to date)", value: "—" },
  { label: "Open sales orders", value: "—" },
  { label: "Awaiting fulfillment", value: "—" },
  { label: "Inventory value", value: "—" },
  { label: "Low-stock items", value: "—" },
  { label: "Open service tickets", value: "—" },
  { label: "Warranty claims", value: "—" },
  { label: "Cash balance", value: "—" },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Business overview — tiles populate as each module goes live."
      />
      <StatTileGrid items={KPIS} />
    </div>
  );
}
