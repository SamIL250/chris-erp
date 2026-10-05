import { z } from "zod";

/** Date/number formatting form (PH0-33) — Intl re-validates server-side. */
export const formattingSchema = z.object({
  locale: z.string().min(1, "Pick a locale"),
  timezone: z.string().min(1, "Pick a timezone"),
});

export type FormattingValues = z.infer<typeof formattingSchema>;
