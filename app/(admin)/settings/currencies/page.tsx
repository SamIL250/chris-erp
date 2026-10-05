"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Dialog, DialogTrigger, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Form,
  FormActions,
  FormAlert,
  FormCheckbox,
  FormInput,
  FormSelect,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { currencySchema, rateSchema } from "@/lib/schemas/currencies";

/**
 * Currency settings (PH0-31): catalog + active base currency + manually
 * maintained exchange-rate history. Rates are append-only observations —
 * "updating" a rate records a new row, keeping the history PH0-24 defined.
 */

type Currency = Doc<"currencies">;
type RateRow = Doc<"exchangeRates">;

const DECIMAL_ITEMS = Array.from({ length: 7 }, (_, digit) => ({
  id: String(digit),
  label: String(digit),
}));

const formatRate = (rate: number) => rate.toLocaleString(undefined, { maximumFractionDigits: 8 });

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-primary text-md font-semibold">{title}</h2>
      {description ? <p className="text-secondary text-sm">{description}</p> : null}
    </div>
  );
}

function AddCurrencyDialog({
  isOpen,
  onOpenChange,
  currencies,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currencies: Currency[];
}) {
  const create = useMutation(api.currencies.create);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(currencySchema, {
    defaultValues: { code: "", name: "", symbol: "", decimalPlaces: "2", active: true },
  });

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalOverlay>
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            <Form
              methods={methods}
              onSubmit={async (values) => {
                setServerError(null);
                try {
                  await create({
                    code: values.code,
                    name: values.name,
                    symbol: values.symbol || undefined,
                    decimalPlaces: values.decimalPlaces,
                    active: values.active,
                  });
                  toast.success(`Currency ${values.code.toUpperCase()} added`);
                  onOpenChange(false);
                } catch (error) {
                  setServerError(toUserMessage(error));
                }
              }}
            >
              <div className="space-y-5 p-6">
                <div>
                  <h2 className="text-display-xs text-primary font-semibold">Add currency</h2>
                  <p className="text-secondary text-md mt-1.5">
                    Codes must be unique — {currencies.length} already in the catalog.
                  </p>
                </div>
                {serverError ? <FormAlert message={serverError} /> : null}
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormInput name="code" label="Code" placeholder="EUR" required />
                  <FormInput name="name" label="Name" placeholder="Euro" required />
                  <FormInput name="symbol" label="Symbol" placeholder="€" />
                  <FormSelect
                    name="decimalPlaces"
                    label="Decimal places"
                    items={DECIMAL_ITEMS}
                    hint="Minor units — USD 2, JPY 0"
                  />
                </div>
                <FormCheckbox name="active" label="Active — available for documents" />
                <FormActions>
                  <Button
                    type="submit"
                    color="primary"
                    size="lg"
                    isLoading={methods.formState.isSubmitting}
                  >
                    Add currency
                  </Button>
                </FormActions>
              </div>
            </Form>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function AddRateDialog({
  isOpen,
  onOpenChange,
  currencies,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currencies: Currency[];
}) {
  const addRate = useMutation(api.currencies.addRate);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(rateSchema, {
    defaultValues: { baseCurrency: "", quoteCurrency: "", rate: "" },
  });
  const items = currencies.map((currency) => ({
    id: currency.code,
    label: `${currency.name} (${currency.code})`,
  }));

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalOverlay>
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            <Form
              methods={methods}
              onSubmit={async (values) => {
                setServerError(null);
                try {
                  await addRate({
                    baseCurrency: values.baseCurrency,
                    quoteCurrency: values.quoteCurrency,
                    rate: values.rate,
                  });
                  toast.success("Exchange rate recorded");
                  onOpenChange(false);
                } catch (error) {
                  setServerError(toUserMessage(error));
                }
              }}
            >
              <div className="space-y-5 p-6">
                <div>
                  <h2 className="text-display-xs text-primary font-semibold">Add rate</h2>
                  <p className="text-secondary text-md mt-1.5">
                    Records a new observation — history is never rewritten.
                  </p>
                </div>
                {serverError ? <FormAlert message={serverError} /> : null}
                <FormSelect
                  name="baseCurrency"
                  label="From (base)"
                  items={items}
                  placeholder="Choose a currency"
                  required
                />
                <FormSelect
                  name="quoteCurrency"
                  label="To (quote)"
                  items={items}
                  placeholder="Choose a currency"
                  required
                />
                <FormInput
                  name="rate"
                  label="Rate"
                  type="number"
                  placeholder="1.0845"
                  hint="1 base = this many quote units"
                  required
                />
                <FormActions>
                  <Button
                    type="submit"
                    color="primary"
                    size="lg"
                    isLoading={methods.formState.isSubmitting}
                  >
                    Record rate
                  </Button>
                </FormActions>
              </div>
            </Form>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export default function CurrencySettingsPage() {
  const data = useQuery(api.currencies.list);
  const rateRows = useQuery(api.currencies.rates);
  const updateBase = useMutation(api.currencies.updateBase);
  const canCreate = useCan("settings", "create");
  const canEdit = useCan("settings", "edit");

  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [savingBase, setSavingBase] = useState(false);
  const [addCurrencyOpen, setAddCurrencyOpen] = useState(false);
  const [addRateOpen, setAddRateOpen] = useState(false);

  if (data === undefined || rateRows === undefined) {
    return (
      <div className="flex max-w-4xl flex-col gap-6">
        <PageHeader title="Currencies" description="Base currency and exchange rates." />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const activeCurrencies = data.currencies.filter((currency) => currency.active);
  const baseValue = selectedBase ?? data.base ?? "";
  const baseDirty = baseValue !== "" && baseValue !== data.base;

  const saveBase = async () => {
    if (baseValue === "") return;
    setSavingBase(true);
    try {
      await updateBase({ code: baseValue });
      toast.success(`Base currency set to ${baseValue}`);
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setSavingBase(false);
    }
  };

  const currencyColumns: DataTableColumn<Currency>[] = [
    {
      id: "code",
      header: "Code",
      cell: (row) => <span className="text-primary font-mono text-sm font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <span className="text-primary text-sm">
          {row.name}
          {row.symbol ? <span className="text-tertiary"> ({row.symbol})</span> : null}
        </span>
      ),
    },
    {
      id: "decimals",
      header: "Decimals",
      cell: (row) => <span className="text-secondary text-sm">{row.decimalPlaces}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Badge color={row.active ? "success" : "gray"} size="sm">
            {row.active ? "Active" : "Inactive"}
          </Badge>
          {row.code === data.base ? (
            <Badge color="brand" size="sm">
              Base
            </Badge>
          ) : null}
        </div>
      ),
    },
  ];

  const rateColumns: DataTableColumn<RateRow>[] = [
    {
      id: "pair",
      header: "Pair",
      cell: (row) => (
        <span className="text-primary font-mono text-sm font-medium">
          {row.baseCurrency}/{row.quoteCurrency}
        </span>
      ),
    },
    {
      id: "rate",
      header: "Rate",
      cell: (row) => <span className="text-primary font-mono text-sm">{formatRate(row.rate)}</span>,
    },
    {
      id: "effective",
      header: "Recorded",
      cell: (row) => (
        <span className="text-secondary text-sm whitespace-nowrap">
          {new Date(row.effectiveAt).toLocaleString()}
        </span>
      ),
    },
    {
      id: "source",
      header: "Source",
      cell: (row) => (
        <Badge color={row.source === "manual" ? "gray" : "brand"} size="sm">
          {row.source ?? "unknown"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Currencies"
        description="The catalog of tradeable currencies, the base currency everything converts from, and manually recorded exchange rates (pricing adopts these in Phase 2)."
      />

      <Card>
        <div className="flex flex-col gap-4 p-6">
          <SectionHeading
            title="Base currency"
            description="Prices, ledgers, and reports are expressed in this currency."
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-72">
              <Select
                label="Base currency"
                items={activeCurrencies.map((currency) => ({
                  id: currency.code,
                  label: `${currency.name} (${currency.code})`,
                }))}
                value={baseValue}
                onChange={(key) => setSelectedBase(key == null ? "" : String(key))}
                placeholder={
                  activeCurrencies.length === 0 ? "Add a currency first" : "Choose a currency"
                }
                isDisabled={!canEdit || activeCurrencies.length === 0}
              >
                {(item) => (
                  <Select.Item id={item.id} key={item.id}>
                    {item.label}
                  </Select.Item>
                )}
              </Select>
            </div>
            <Button
              color="primary"
              size="lg"
              isDisabled={!canEdit || !baseDirty}
              isLoading={savingBase}
              onPress={() => void saveBase()}
            >
              Save base currency
            </Button>
            {data.base ? (
              <p className="text-secondary pb-2 text-sm">
                Current base: <span className="text-primary font-medium">{data.base}</span>
              </p>
            ) : (
              <p className="text-warning pb-2 text-sm">No base currency set yet.</p>
            )}
          </div>
        </div>
      </Card>

      <DataTable
        title="Currency catalog"
        columns={currencyColumns}
        rows={data.currencies}
        rowId={(row) => row._id}
        toolbar={
          canCreate ? (
            <Button color="primary" size="sm" onPress={() => setAddCurrencyOpen(true)}>
              Add currency
            </Button>
          ) : null
        }
        empty={{
          title: "No currencies yet",
          description: canCreate
            ? "Add the currencies you trade in — or run the seed script (PH0-34)."
            : "An administrator can add currencies from this page.",
        }}
      />

      <DataTable
        title="Exchange rates"
        columns={rateColumns}
        rows={rateRows}
        rowId={(row) => row._id}
        toolbar={
          canEdit ? (
            <Button color="primary" size="sm" onPress={() => setAddRateOpen(true)}>
              Add rate
            </Button>
          ) : null
        }
        empty={{
          title: "No exchange rates yet",
          description: canEdit
            ? "Record rates manually — each save keeps the history."
            : "An administrator can record exchange rates from this page.",
        }}
      />

      {addCurrencyOpen ? (
        <AddCurrencyDialog
          isOpen
          onOpenChange={(open) => !open && setAddCurrencyOpen(false)}
          currencies={data.currencies}
        />
      ) : null}
      {addRateOpen ? (
        <AddRateDialog
          isOpen
          onOpenChange={(open) => !open && setAddRateOpen(false)}
          currencies={data.currencies}
        />
      ) : null}
    </div>
  );
}
