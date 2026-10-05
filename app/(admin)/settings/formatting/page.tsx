"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { Card } from "@/components/ui/card";
import { Form, FormActions, FormAlert, useZodForm } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import { useCan } from "@/hooks/use-can";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { toUserMessage } from "@/lib/errors";
import { formattingSchema } from "@/lib/schemas/formatting";

/**
 * Date/number formatting preferences (PH0-33): one company-wide locale +
 * timezone that renderers (and future documents) read. The preview below is
 * live — it formats with the selections before you save, using the same
 * lib/format.ts helpers the rest of the app will use.
 */

const LOCALES = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-IN",
  "de-DE",
  "fr-FR",
  "es-ES",
  "it-IT",
  "pt-BR",
  "nl-NL",
  "pl-PL",
  "sv-SE",
  "da-DK",
  "fi-FI",
  "nb-NO",
  "ru-RU",
  "tr-TR",
  "ar-SA",
  "he-IL",
  "hi-IN",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
];

function FormattingForm({ prefs }: { prefs: { locale: string | null; timezone: string | null } }) {
  const update = useMutation(api.formatting.update);
  const [serverError, setServerError] = useState<string | null>(null);
  const canEdit = useCan("settings", "edit");

  const timezoneItems = useMemo(
    () =>
      (typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : ["UTC"]
      ).map((zone) => ({ id: zone, label: zone })),
    [],
  );
  const localeItems = LOCALES.map((locale) => ({ id: locale, label: locale }));

  const methods = useZodForm(formattingSchema, {
    defaultValues: {
      locale: prefs.locale ?? "en-US",
      timezone: prefs.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    },
  });

  const locale = methods.watch("locale");
  const timezone = methods.watch("timezone");
  const sample = new Date("2026-10-05T14:30:00Z");
  const prefs2 = { locale: locale || null, timezone: timezone || null };

  return (
    <Form
      methods={methods}
      className="max-w-3xl"
      onSubmit={async (values) => {
        setServerError(null);
        try {
          await update({ locale: values.locale, timezone: values.timezone });
          toast.success("Formatting preferences saved");
        } catch (error) {
          setServerError(toUserMessage(error));
        }
      }}
    >
      <Card>
        <div className="flex flex-col gap-6 p-6">
          <div>
            <h2 className="text-primary text-md font-semibold">Date &amp; number format</h2>
            <p className="text-secondary text-sm">
              Company-wide: documents print dates in this timezone, numbers follow this locale.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Select
              label="Locale"
              items={localeItems}
              value={methods.watch("locale")}
              onChange={(key) => methods.setValue("locale", key == null ? "" : String(key))}
              isDisabled={!canEdit}
            >
              {(item) => (
                <Select.Item id={item.id} key={item.id}>
                  {item.label}
                </Select.Item>
              )}
            </Select>
            <Select
              label="Timezone"
              items={timezoneItems}
              value={methods.watch("timezone")}
              onChange={(key) => methods.setValue("timezone", key == null ? "" : String(key))}
              isDisabled={!canEdit}
            >
              {(item) => (
                <Select.Item id={item.id} key={item.id}>
                  {item.label}
                </Select.Item>
              )}
            </Select>
          </div>

          <div className="bg-secondary rounded-xl p-4">
            <p className="text-tertiary text-xs font-medium">PREVIEW</p>
            <div className="text-primary mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
              <p>
                <span className="text-tertiary">Date:</span> {formatDate(sample, prefs2)}
              </p>
              <p>
                <span className="text-tertiary">Date &amp; time:</span>{" "}
                {formatDateTime(sample, prefs2)}
              </p>
              <p>
                <span className="text-tertiary">Number:</span> {formatNumber(1234567.89, prefs2)}
              </p>
              <p>
                <span className="text-tertiary">Percent:</span> {formatPercent(0.195, prefs2)}
              </p>
            </div>
          </div>

          {serverError ? <FormAlert message={serverError} /> : null}

          <FormActions>
            <Button
              type="submit"
              color="primary"
              size="lg"
              isDisabled={!canEdit}
              isLoading={methods.formState.isSubmitting}
            >
              Save changes
            </Button>
          </FormActions>
        </div>
      </Card>
    </Form>
  );
}

/** Formatting preferences (PH0-33) — `/settings/formatting`, settings.view. */
export default function FormattingSettingsPage() {
  const prefs = useQuery(api.formatting.get);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Formatting"
        description="The locale and timezone used to render dates, times, and numbers across the app and on future documents."
      />
      {prefs === undefined ? <Skeleton className="h-80" /> : <FormattingForm prefs={prefs} />}
    </div>
  );
}
