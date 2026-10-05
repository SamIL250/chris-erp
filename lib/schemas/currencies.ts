import { z } from "zod";

/** Add-currency dialog (PH0-31). The mutation uppercases the code. */
export const currencySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "3 letters (ISO 4217, e.g. USD)"),
  name: z
    .string()
    .trim()
    .min(1, "Currency name is required")
    .max(100, "Keep it under 100 characters"),
  symbol: z.string().trim().max(8, "Keep it under 8 characters"),
  decimalPlaces: z.coerce
    .number()
    .refine((value) => Number.isInteger(value) && value >= 0 && value <= 6, {
      message: "Pick a whole number between 0 and 6",
    }),
  active: z.boolean(),
});

export type CurrencyValues = z.infer<typeof currencySchema>;

/** Add-exchange-rate dialog (PH0-31) — a manual observation, append-only. */
export const rateSchema = z.object({
  baseCurrency: z.string().regex(/^[A-Za-z]{3}$/, "Pick a currency"),
  quoteCurrency: z.string().regex(/^[A-Za-z]{3}$/, "Pick a currency"),
  rate: z.coerce.number().refine((value) => Number.isFinite(value) && value > 0 && value <= 1e12, {
    message: "Enter a positive number",
  }),
});

export type RateValues = z.infer<typeof rateSchema>;
