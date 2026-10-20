"use client";

import { Check } from "@untitledui/icons";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Input } from "@/components/base/input/input";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { cx } from "@/utils/cx";

/**
 * Variant matrix editor (PH1-09): `/catalog/products/[id]/variants`.
 *
 * - Axes are the product's APPLICABLE Select attributes (from
 *   `products.get`, which resolves the same set-inheritance the form
 *   renders). Toggling chips + "Save axes & regenerate" runs the
 *   `variants:sync` reconcile — it keeps combinations that still exist
 *   (with their per-variant edits), inserts new ones from product
 *   defaults, removes orphans, and names any derived-SKU clash verbatim.
 * - The matrix table edits one row at a time via full-form
 *   `variants:update`: SKU/barcode commit on blur, price parses to
 *   `number | null` (empty clears), flags toggle from the dropdown.
 *   View-only roles (`catalog.view` without `catalog.edit`) get the same
 *   table as text.
 * - The cartesian preview mirrors the server cap (200) and disables save
 *   past it — the server re-checks regardless.
 */

type VariantRow = Doc<"variants">;

const TRACK_FLAGS = [
  { key: "serialTracked", label: "Serial tracked" },
  { key: "lotTracked", label: "Lot tracked" },
  { key: "expiryRequired", label: "Expiry required" },
  { key: "warrantyEligible", label: "Warranty eligible" },
  { key: "allowBackorder", label: "Backorders allowed" },
] as const;
type TrackFlag = (typeof TRACK_FLAGS)[number]["key"];

/** Mirrors the server's cap in `convex/catalog/variants.ts`. */
const MAX_VARIANTS = 200;

function flagState(row: VariantRow): Record<TrackFlag, boolean> {
  return {
    serialTracked: row.serialTracked ?? false,
    lotTracked: row.lotTracked ?? false,
    expiryRequired: row.expiryRequired ?? false,
    warrantyEligible: row.warrantyEligible ?? false,
    allowBackorder: row.allowBackorder ?? false,
  };
}

export function VariantsEditor({ id }: { id: string }) {
  const canEdit = useCan("catalog", "edit");
  const existing = useQuery(api.catalog.products.get, { id });
  const variants = useQuery(api.catalog.variants.list, {
    productId: id as Id<"products">,
  });
  const sync = useMutation(api.catalog.variants.sync);
  const update = useMutation(api.catalog.variants.update);

  // Local axis picks: `null` until first interaction, then the picked set
  // wins — the seeded view just mirrors the saved product, so after a sync
  // (full-form: the selection IS the stored state) nothing needs reseeding.
  const [pickedAxes, setPickedAxes] = useState<ReadonlySet<string> | null>(null);
  const axes = pickedAxes ?? new Set(existing?.product?.variantAxisIds ?? []);

  if (existing === undefined || variants === undefined) {
    return (
      <div className="flex max-w-5xl flex-col gap-6">
        <PageHeader title="Variants" description="Loading the variant matrix…" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (existing === null) {
    return (
      <div className="flex max-w-5xl flex-col gap-6">
        <PageHeader title="Product not found" description="It may have been deleted." />
        <Card>
          <div className="flex items-center justify-between gap-4 p-6">
            <p className="text-secondary text-sm">
              The link points at a product that no longer exists.
            </p>
            <Button color="primary" href="/catalog/products">
              Back to products
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const row = existing.product;
  const axisCandidates = existing.attributes.filter((axis) => axis.type === "select");
  // Display order = the applicable order the spec editor renders (PH1-07).
  const orderedAxes = existing.attributes.filter((axis) => axes.has(axis._id));
  const comboCount = orderedAxes.reduce((total, axis) => total * axis.options.length, 1);
  const matrixCount = orderedAxes.length === 0 ? 0 : comboCount;
  const overLimit = matrixCount > MAX_VARIANTS;
  const canSave = !overLimit && (matrixCount > 0 || variants.length > 0);

  const saveAxes = async () => {
    try {
      const outcome = await sync({
        id: row._id,
        axisIds: [...axes] as Id<"attributeDefinitions">[],
      });
      toast.success(
        `Matrix synced — ${outcome.created} added, ${outcome.removed} removed, ${outcome.total} total.`,
      );
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const commitRow = async (
    variant: VariantRow,
    patch: {
      sku?: string;
      barcode?: string;
      listPrice?: number | null;
      flags?: Partial<Record<TrackFlag, boolean>>;
    },
  ) => {
    const flags = { ...flagState(variant), ...patch.flags };
    try {
      await update({
        id: variant._id,
        sku: patch.sku ?? variant.sku,
        barcode: patch.barcode ?? variant.barcode ?? "",
        listPrice: patch.listPrice !== undefined ? patch.listPrice : (variant.listPrice ?? null),
        serialTracked: flags.serialTracked,
        lotTracked: flags.lotTracked,
        expiryRequired: flags.expiryRequired,
        warrantyEligible: flags.warrantyEligible,
        allowBackorder: flags.allowBackorder,
      });
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const flagsCell = (variant: VariantRow) => {
    if (!canEdit) {
      const active = TRACK_FLAGS.filter((flag) => variant[flag.key] === true);
      return active.length === 0 ? (
        <span className="text-tertiary text-sm">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {active.map((flag) => (
            <Badge key={flag.key} color="gray" size="sm">
              {flag.label}
            </Badge>
          ))}
        </span>
      );
    }
    return (
      <Dropdown.Root>
        <Button color="secondary" size="sm">
          Flags
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            aria-label="Variant tracking flags"
            onAction={(key) => {
              const flag = TRACK_FLAGS.find((candidate) => candidate.key === key);
              if (flag === undefined) return;
              void commitRow(variant, { flags: { [flag.key]: !(variant[flag.key] ?? false) } });
            }}
          >
            {TRACK_FLAGS.map((flag) => (
              <Dropdown.Item key={flag.key} id={flag.key} selectionIndicator="none">
                <span className="flex items-center gap-2">
                  {variant[flag.key] === true ? (
                    <Check aria-hidden="true" className="text-brand-secondary size-4" />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  {flag.label}
                </span>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>
    );
  };

  const axisColumns: DataTableColumn<VariantRow>[] = orderedAxes.map((axis) => ({
    id: `axis-${axis._id}`,
    header: axis.name,
    cell: (variant) => {
      const pin = variant.optionValues.find((entry) => entry.attributeId === axis._id);
      return (
        <Badge color="gray" size="sm">
          {pin?.value ?? "—"}
        </Badge>
      );
    },
  }));

  const columns: DataTableColumn<VariantRow>[] = [
    ...axisColumns,
    {
      id: "sku",
      header: "SKU",
      cell: (variant) =>
        canEdit ? (
          <div className="w-44">
            <Input
              aria-label={`SKU ${variant.sku}`}
              size="sm"
              defaultValue={variant.sku}
              onBlur={(event) => {
                const value = event.currentTarget.value;
                if (value.trim() !== variant.sku) void commitRow(variant, { sku: value });
              }}
            />
          </div>
        ) : (
          <span className="text-secondary font-mono text-sm">{variant.sku}</span>
        ),
    },
    {
      id: "barcode",
      header: "Barcode",
      cell: (variant) =>
        canEdit ? (
          <div className="w-40">
            <Input
              aria-label={`Barcode ${variant.sku}`}
              size="sm"
              placeholder="—"
              defaultValue={variant.barcode ?? ""}
              onBlur={(event) => {
                const value = event.currentTarget.value;
                if (value.trim() !== (variant.barcode ?? "")) {
                  void commitRow(variant, { barcode: value });
                }
              }}
            />
          </div>
        ) : (
          <span className="text-secondary font-mono text-sm">{variant.barcode ?? "—"}</span>
        ),
    },
    {
      id: "price",
      header: "Price",
      cell: (variant) =>
        canEdit ? (
          <div className="w-28">
            <Input
              aria-label={`Price ${variant.sku}`}
              size="sm"
              type="number"
              // Absent override → the product's listPrice is the fallback
              // (PH1-10) — shown as the placeholder, never stored on the row.
              placeholder={row.listPrice !== undefined ? String(row.listPrice) : "—"}
              defaultValue={variant.listPrice === undefined ? "" : String(variant.listPrice)}
              onBlur={(event) => {
                const raw = event.currentTarget.value.trim();
                const next = raw === "" ? null : Number(raw);
                const current = variant.listPrice ?? null;
                if (next !== current && (next === null || !Number.isNaN(next))) {
                  void commitRow(variant, { listPrice: next });
                }
              }}
            />
          </div>
        ) : variant.listPrice !== undefined ? (
          <span className="text-secondary text-sm">{String(variant.listPrice)}</span>
        ) : row.listPrice !== undefined ? (
          <span className="text-tertiary text-sm" title="Product list price (default)">
            {row.listPrice}
          </span>
        ) : (
          <span className="text-secondary text-sm">—</span>
        ),
    },
    { id: "flags", header: "Flags", cell: flagsCell },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Variants — ${row.name}`}
        description="Per-variant SKU, barcode, price, and tracking flags — defaults filled from the product."
        actions={
          <Button color="secondary" href={`/catalog/products/${row._id}`}>
            Back to product
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="text-primary text-md font-semibold">Variant axes</h2>
            <p className="text-tertiary text-sm">
              Axes are the Select attributes this product inherits from its category sets — every
              combination of their options becomes a variant. Regenerating keeps combinations that
              still exist, with their edits; combinations no longer covered are removed.
            </p>
          </div>
          {axisCandidates.length === 0 ? (
            <p className="text-secondary text-sm">
              No Select attributes apply to this product yet — add one to an attribute set covering
              its categories.
            </p>
          ) : canEdit ? (
            <>
              <div className="flex flex-wrap gap-2">
                {axisCandidates.map((axis) => {
                  const active = axes.has(axis._id);
                  return (
                    <button
                      key={axis._id}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setPickedAxes(() => {
                          const next = new Set(axes);
                          if (active) next.delete(axis._id);
                          else next.add(axis._id);
                          return next;
                        })
                      }
                      className={cx(
                        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        active
                          ? "border-brand-300 bg-brand-50 text-brand-700"
                          : "border-tertiary bg-secondary text-secondary hover:text-primary",
                      )}
                    >
                      {axis.name}
                      <span className="ml-1.5 text-xs opacity-70">
                        {axis.options.length} option{axis.options.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-tertiary text-sm">
                {overLimit
                  ? `${matrixCount} combinations — over the ${MAX_VARIANTS} limit. Remove an axis or some options.`
                  : matrixCount > 0
                    ? `${matrixCount} combination${matrixCount === 1 ? "" : "s"} will be generated.`
                    : variants.length > 0
                      ? "Saving with no axes clears the matrix."
                      : "Pick at least one axis."}
              </p>
              <div className="flex items-center gap-4">
                <Button
                  color="primary"
                  size="sm"
                  isDisabled={!canSave}
                  onPress={() => void saveAxes()}
                >
                  Save axes &amp; regenerate
                </Button>
                <Link
                  href={`/catalog/products/${row._id}`}
                  className="text-brand-600 text-sm font-medium hover:underline"
                >
                  Back to product
                </Link>
              </div>
            </>
          ) : (
            <p className="text-secondary text-sm">
              {orderedAxes.length === 0
                ? "No axes."
                : orderedAxes.map((axis) => axis.name).join(" · ")}
            </p>
          )}
        </div>
      </Card>

      <DataTable
        title="Matrix"
        columns={columns}
        rows={variants}
        rowId={(variant) => variant._id}
        empty={{
          title: "No variants yet",
          description:
            axes.size > 0
              ? "Save the axes above to generate the matrix."
              : "Pick Select attributes as axes above, then save to generate the matrix.",
        }}
      />
    </div>
  );
}
