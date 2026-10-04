"use client";

/**
 * Chart containers (PH0-11): KPI stat tile + line/bar/donut charts on recharts 3,
 * styled to the Untitled UI chart look (uses `charts-base` tooltip/legend content).
 *
 * Colors: `CHART_COLORS` is the default palette — pass `color` per series to override.
 * Axis/grid colors use theme CSS vars so charts follow light/dark automatically.
 */
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartLegendContent,
  ChartTooltipContent,
  selectEvenlySpacedItems,
} from "@/components/application/charts/charts-base";
import { Badge } from "@/components/base/badges/badges";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cx } from "@/utils/cx";

/** Untitled UI-style data-viz palette (brand purple first). */
export const CHART_COLORS = [
  "#6938EF",
  "#2E90FA",
  "#17B26A",
  "#F79009",
  "#EE46BC",
  "#15B79E",
  "#F04438",
] as const;

export interface ChartSeries {
  /** Field name in each data row. */
  key: string;
  label: string;
  color?: string;
  /** Bar only: stack id (rows with the same id stack). */
  stackId?: string;
}

const AXIS_TICK = { fill: "var(--text-color-quaternary)", fontSize: 12 } as const;
const GRID_STROKE = "var(--border-color-secondary)";

/* ── KPI stat tile ─────────────────────────────────────────────────────────── */

export interface StatTileProps {
  label: string;
  /** Pre-formatted display value ("$12,400.50", "128"). */
  value: string;
  /** Percent change vs previous period; renders an up/down badge. */
  delta?: number;
  /** Right-hand context, e.g. "vs. last month". */
  hint?: string;
  /** Small metric under the value, e.g. "12 open orders". */
  sub?: string;
  isLoading?: boolean;
  className?: string;
}

export function StatTile({ label, value, delta, hint, sub, isLoading, className }: StatTileProps) {
  const up = (delta ?? 0) >= 0;
  return (
    <Card className={className}>
      <div className="flex flex-col gap-1 p-5">
        <p className="text-secondary text-sm font-medium">{label}</p>
        {isLoading ? (
          <Skeleton className="mt-1 h-8 w-28" />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-display-sm text-primary font-semibold">{value}</span>
            {delta !== undefined ? (
              <Badge color={up ? "success" : "error"} size="sm">
                {up ? "▲" : "▼"} {Math.abs(delta)}%
              </Badge>
            ) : null}
          </div>
        )}
        {sub ? <p className="text-tertiary text-sm">{sub}</p> : null}
        {hint ? <p className="text-quaternary text-xs">{hint}</p> : null}
      </div>
    </Card>
  );
}

/* ── Chart card container ──────────────────────────────────────────────────── */

export function ChartCard({
  title,
  description,
  actions,
  isLoading,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  isLoading?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader actions={actions}>
        <div>
          <h3 className="text-md text-primary font-semibold">{title}</h3>
          {description ? <p className="text-secondary mt-0.5 text-sm">{description}</p> : null}
        </div>
      </CardHeader>
      <CardBody>{isLoading ? <Skeleton className="h-64 w-full" /> : children}</CardBody>
    </Card>
  );
}

/* ── Line chart ────────────────────────────────────────────────────────────── */

export interface ChartDataPoint {
  [key: string]: string | number | null | undefined;
}

export interface LineChartProps {
  data: ChartDataPoint[];
  xKey: string;
  series: ChartSeries[];
  height?: number;
  /** Format y values (ticks + tooltip), e.g. money. */
  format?: (value: number) => string;
  showLegend?: boolean;
  className?: string;
}

export function LineChartView({
  data,
  xKey,
  series,
  height = 260,
  format,
  showLegend,
  className,
}: LineChartProps) {
  const legend = showLegend ?? series.length > 1;
  const xTicks = selectEvenlySpacedItems(
    data.map((d) => String(d[xKey] ?? "")),
    6,
  );
  const tooltipFormatter = format
    ? (value: unknown) => (value == null ? "" : format(Number(value)))
    : undefined;

  return (
    <div className={cx("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey={xKey}
            ticks={xTicks}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            tickMargin={8}
            interval={0}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            width={52}
            tickFormatter={format}
          />
          <Tooltip
            content={<ChartTooltipContent />}
            formatter={tooltipFormatter}
            cursor={{ stroke: GRID_STROKE, strokeDasharray: "4 4" }}
          />
          {legend ? <Legend content={ChartLegendContent} /> : null}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Bar chart ─────────────────────────────────────────────────────────────── */

export interface BarChartProps extends Omit<LineChartProps, "className"> {
  /** Fixed bar width cap. */
  maxBarSize?: number;
  className?: string;
}

export function BarChartView({
  data,
  xKey,
  series,
  height = 260,
  format,
  showLegend,
  maxBarSize,
  className,
}: BarChartProps) {
  const legend = showLegend ?? series.length > 1;
  const tooltipFormatter = format
    ? (value: unknown) => (value == null ? "" : format(Number(value)))
    : undefined;

  return (
    <div className={cx("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            width={52}
            tickFormatter={format}
          />
          <Tooltip
            content={<ChartTooltipContent />}
            formatter={tooltipFormatter}
            cursor={{ fill: "var(--background-color-secondary)" }}
          />
          {legend ? <Legend content={ChartLegendContent} /> : null}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              radius={series.length > 1 ? [4, 4, 0, 0] : [6, 6, 0, 0]}
              stackId={s.stackId}
              maxBarSize={maxBarSize}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Donut chart ───────────────────────────────────────────────────────────── */

export interface DonutDatum {
  name: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  height?: number;
  /** Big number in the donut hole, e.g. total revenue. */
  centerValue?: string;
  centerLabel?: string;
  format?: (value: number) => string;
  showLegend?: boolean;
  className?: string;
}

export function DonutChartView({
  data,
  height = 260,
  centerValue,
  centerLabel,
  format,
  showLegend = true,
  className,
}: DonutChartProps) {
  return (
    <div className={cx("relative w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={<ChartTooltipContent isPieChart />}
            formatter={
              format ? (value: unknown) => (value == null ? "" : format(Number(value))) : undefined
            }
          />
          {showLegend ? <Legend content={ChartLegendContent} /> : null}
        </PieChart>
      </ResponsiveContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
          <span className="text-display-sm text-primary font-semibold">{centerValue}</span>
          {centerLabel ? <span className="text-quaternary text-xs">{centerLabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Loading helper ────────────────────────────────────────────────────────── */

/** Stat tile grid that renders skeletons while the dashboard query loads. */
export function StatTileGrid({ items, className }: { items: StatTileProps[]; className?: string }) {
  return (
    <div className={cx("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {items.map((item, i) => (
        <StatTile key={`${item.label}-${i}`} {...item} />
      ))}
    </div>
  );
}
