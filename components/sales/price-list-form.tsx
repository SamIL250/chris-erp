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
import { priceListNameError } from "@/lib/pricing";

type CurrencyChoice = { code: string; name: string; active: boolean };

type List = {
  _id: Id<"priceLists">;
  name: string;
  currency: string;
  active: boolean;
  isBase: boolean;
  priceCount: number;
};

/**
 * Create or rename a price list (PH2-09). A list is never deleted.
 * Currency stays once the list has a price. The first list is the base.
 */
export function PriceListForm({
  list,
  currencies,
  canSave,
  onSaved,
  onCancel,
}: {
  list: List | null;
  currencies: CurrencyChoice[];
  canSave: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const create = useMutation(api.sales.prices.createList);
  const update = useMutation(api.sales.prices.updateList);
  const activeCurrencies = currencies.filter((row) => row.active);
  const [name, setName] = useState(list?.name ?? "");
  const [currency, setCurrency] = useState(list?.currency ?? activeCurrencies[0]?.code ?? "");
  const [isBase, setIsBase] = useState(list?.isBase ?? false);
  const [active, setActive] = useState(list?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currencyLocked = list !== null && list.priceCount > 0;

  const save = async () => {
    const nameMessage = priceListNameError(name);
    if (nameMessage !== null) {
      setError(nameMessage);
      return;
    }
    if (currency === "") {
      setError("Choose a currency.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (list === null) {
        await create({ name, currency, isBase });
        toast.success("Price list created");
      } else {
        await update({
          listId: list._id,
          name,
          currency: currencyLocked ? undefined : currency,
          active,
          isBase,
        });
        toast.success("Price list saved");
      }
      onSaved();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const options = (
    list !== null && !activeCurrencies.some((row) => row.code === list.currency)
      ? [{ code: list.currency, name: list.currency, active: false }, ...activeCurrencies]
      : activeCurrencies
  ).map((row) => ({ id: row.code, label: `${row.code} · ${row.name}` }));

  return (
    <div className="space-y-5 p-6">
      <div>
        <h2 className="text-display-xs text-primary font-semibold">
          {list === null ? "New price list" : list.name}
        </h2>
        <p className="text-secondary text-md mt-1.5">
          One currency. The base list is the fallback when no promotion covers the day.
        </p>
      </div>
      {error ? <FormAlert title="Couldn't save the price list" message={error} /> : null}
      <Input label="Name" value={name} onChange={setName} isDisabled={!canSave} />
      <Select
        label="Currency"
        placeholder="Currency"
        items={options}
        value={currency === "" ? null : currency}
        isDisabled={!canSave || currencyLocked}
        hint={currencyLocked ? "This list has prices. Currency stays." : undefined}
        onChange={(key) => setCurrency(key == null ? "" : String(key))}
      >
        {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
      </Select>
      <Checkbox
        isSelected={isBase}
        onChange={setIsBase}
        isDisabled={!canSave}
        label="Base list"
        hint="Naming this list the base clears the previous one. The only list stays the base."
      />
      {list !== null ? (
        <Checkbox
          isSelected={active}
          onChange={setActive}
          isDisabled={!canSave}
          label="Active"
          hint="Deactivating the base hands it to the oldest other list. An inactive list takes no new prices."
        />
      ) : null}
      {canSave ? (
        <div className="flex justify-end gap-3">
          {onCancel ? (
            <Button type="button" color="secondary" onPress={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button color="primary" isLoading={busy} onPress={() => void save()}>
            {list === null ? "Create list" : "Save"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
