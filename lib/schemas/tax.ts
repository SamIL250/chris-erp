import { z } from "zod";

/**
 * Tax configuration dialogs (PH0-32). Rates are stored as integer basis
 * points — the form edits percent (19.5 → 1950 bps at submit).
 */
export const taxRateSchema = z.object({
  name: z.string().trim().min(1, "Rate name is required").max(100, "Keep it under 100 characters"),
  code: z.string().trim().max(20, "Keep it under 20 characters"),
  percent: z.coerce
    .number()
    .refine((value) => Number.isFinite(value) && value >= 0 && value <= 100, {
      message: "Enter a percentage between 0 and 100",
    }),
  inclusive: z.boolean(),
  active: z.boolean(),
});

export type TaxRateValues = z.infer<typeof taxRateSchema>;

/**
 * Tax-group dialog. Rate slots hold a `taxRates` id ("" = no rate for that
 * category) — Select stores strings.
 */
export const taxGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(100, "Keep it under 100 characters"),
  isDefault: z.boolean(),
  standard: z.string(),
  reduced: z.string(),
  zero: z.string(),
  active: z.boolean(),
});

export type TaxGroupValues = z.infer<typeof taxGroupSchema>;
