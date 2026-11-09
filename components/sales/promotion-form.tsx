"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { FormAlert } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import {
  priceDay,
  priceDayFromInput,
  priceDayLabel,
  promotionNameError,
  promotionRangeError,
} from "@/lib/pricing";

type ListChoice = { _id: Id<"priceLists">; name: string; active: boolean };

type Promotion = {
  _id: Id<"promotions">;
  name: string;
  startsOn: number;
  endsOn: number;
  active: boolean;
  priceListId: Id<"priceLists"> | null;
};

const DAY_MS = 86_400_000;

function isoToday(offsetDays: number) {
  const today = priceDay(Date.now()) ?? 0;
  return priceDayLabel(today + offsetDays * DAY_MS);
}

/**
 * A dated promotion (PH2-09). It may name the list in effect during the
 * window. Overlapping windows are both kept. A promotion is deactivated,
 * never deleted.
 */
export function PromotionForm({
  promotion,
  lists,
  canSave,
  onSaved,
  onCancel,
}: {
  promotion: Promotion | null;
  lists: ListChoice[];
  canSave: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const create = useMutation(api.sales.prices.createPromotion);
  const update = useMutation(api.sales.prices.updatePromotion);
  const [name, setName] = useState(promotion?.name ?? "");
  const [startsOn, setStartsOn] = useState(
    promotion === null ? isoToday(0) : priceDayLabel(promotion.startsOn),
  );
  const [endsOn, setEndsOn] = useState(
    promotion === null ? isoToday(7) : priceDayLabel(promotion.endsOn),
  );
  const [listId, setListId] = useState(promotion?.priceListId ?? "");
  const [active, setActive] = useState(promotion?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const nameMessage = promotionNameError(name);
    if (nameMessage !== null) {
      setError(nameMessage);
      return;
    }
    const start = priceDayFromInput(startsOn);
    if ("error" in start) {
      setError(start.error);
      return;
    }
    const end = priceDayFromInput(endsOn);
    if ("error" in end) {
      setError(end.error);
      return;
    }
    const range = promotionRangeError(start.ms, end.ms);
    if (range !== null) {
      setError(range);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const priceListId = listId === "" ? null : (listId as Id<"priceLists">);
      if (promotion === null) {
        await create({ name, startsOn: start.ms, endsOn: end.ms, active, priceListId });
        toast.success("Promotion created");
      } else {
        await update({
          promotionId: promotion._id,
          name,
          startsOn: start.ms,
          endsOn: end.ms,
          active,
          priceListId,
        });
        toast.success("Promotion saved");
      }
      onSaved();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const listItems = [
    { id: "", label: "No list" },
    ...lists.map((row) => ({
      id: row._id,
      label: row.active ? row.name : `${row.name} (inactive)`,
    })),
  ];

  return (
    <div className="space-y-5 p-6">
      <div>
        <h2 className="text-display-xs text-primary font-semibold">
          {promotion === null ? "New promotion" : promotion.name}
        </h2>
        <p className="text-secondary text-md mt-1.5">
          The list in effect on those dates. When two windows overlap, the one that started latest
          wins.
        </p>
      </div>
      {error ? <FormAlert title="Couldn't save the promotion" message={error} /> : null}
      <Input label="Name" value={name} onChange={setName} isDisabled={!canSave} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Starts"
          type="date"
          value={startsOn}
          onChange={setStartsOn}
          isDisabled={!canSave}
        />
        <Input label="Ends" type="date" value={endsOn} onChange={setEndsOn} isDisabled={!canSave} />
      </div>
      <Select
        label="Price list"
        placeholder="No list"
        items={listItems}
        value={listId === "" ? null : listId}
        isDisabled={!canSave}
        onChange={(key) => setListId(key == null ? "" : String(key))}
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
      <Checkbox
        isSelected={active}
        onChange={setActive}
        isDisabled={!canSave}
        label="Active"
        hint="An inactive promotion is skipped. The window stays on file."
      />
      {canSave ? (
        <div className="flex justify-end gap-3">
          <Button type="button" color="secondary" onPress={onCancel}>
            Cancel
          </Button>
          <Button color="primary" isLoading={busy} onPress={() => void save()}>
            {promotion === null ? "Create promotion" : "Save"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
