"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { FormAlert } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { reorderQtyError } from "@/lib/reorder";

type Point = { warehouseId?: Id<"warehouses">; qty: number };

/**
 * Set or clear the reorder point for this product, at one warehouse
 * or for every warehouse (PH1-24). The warehouse point wins.
 */
export function ReorderPoint({
  productId,
  warehouseId,
  points,
}: {
  productId: string;
  warehouseId: string;
  points: Point[] | undefined;
}) {
  const canEdit = useCan("inventory", "edit");
  const setPoint = useMutation(api.inventory.reorderPoints.set);
  const clearPoint = useMutation(api.inventory.reorderPoints.clear);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const here = points?.find((row) => row.warehouseId === warehouseId)?.qty;
  const general = points?.find((row) => row.warehouseId === undefined)?.qty;

  const save = async (scope: "warehouse" | "product", raw: string) => {
    setError(null);
    const qty = Number(raw);
    const qtyError = reorderQtyError(qty);
    if (raw.trim() === "" || qtyError !== null) {
      setError(qtyError ?? "Name a reorder point.");
      return;
    }
    setBusy(true);
    try {
      await setPoint({
        productId: productId as Id<"products">,
        ...(scope === "warehouse" ? { warehouseId: warehouseId as Id<"warehouses"> } : {}),
        qty,
      });
      toast.success(
        scope === "warehouse" ? "Warehouse reorder point saved" : "Reorder point saved",
      );
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (scope: "warehouse" | "product") => {
    setError(null);
    setBusy(true);
    try {
      await clearPoint({
        productId: productId as Id<"products">,
        ...(scope === "warehouse" ? { warehouseId: warehouseId as Id<"warehouses"> } : {}),
      });
      toast.success("Reorder point cleared");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <FormAlert title="Couldn't save the reorder point" message={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <PointField
          key={`warehouse:${here ?? ""}`}
          label="At this warehouse"
          hint="Wins over the point that applies at every warehouse."
          stored={here}
          canEdit={canEdit && warehouseId !== ""}
          busy={busy}
          onSave={(value) => void save("warehouse", value)}
          onClear={here === undefined ? undefined : () => void clear("warehouse")}
        />
        <PointField
          key={`product:${general ?? ""}`}
          label="Every warehouse"
          hint="Used where this product has no warehouse point."
          stored={general}
          canEdit={canEdit}
          busy={busy}
          onSave={(value) => void save("product", value)}
          onClear={general === undefined ? undefined : () => void clear("product")}
        />
      </div>
    </div>
  );
}

function PointField({
  label,
  hint,
  stored,
  canEdit,
  busy,
  onSave,
  onClear,
}: {
  label: string;
  hint: string;
  stored: number | undefined;
  canEdit: boolean;
  busy: boolean;
  onSave: (value: string) => void;
  onClear?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (stored === undefined ? "" : String(stored));
  return (
    <div className="space-y-3">
      <Input
        label={label}
        hint={hint}
        type="number"
        placeholder="Not set"
        value={value}
        onChange={setDraft}
        isDisabled={!canEdit}
      />
      {canEdit ? (
        <div className="flex justify-end gap-3">
          {onClear ? (
            <Button color="tertiary" isDisabled={busy} onPress={onClear}>
              Clear
            </Button>
          ) : null}
          <Button color="secondary" isLoading={busy} onPress={() => onSave(value)}>
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}
