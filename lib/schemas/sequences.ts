import { z } from "zod";

/**
 * Document-numbering edit dialog (PH0-30). `next` is deliberately absent —
 * the counter only grows as documents are issued (PH0-25's contract).
 */
export const sequenceSchema = z.object({
  prefix: z
    .string()
    .trim()
    .min(1, "Prefix is required")
    .max(10, "Keep it under 10 characters")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers, and dashes only"),
  // FormSelect stores strings — coerce to the numeric counter width.
  padding: z.coerce
    .number()
    .refine((value) => Number.isInteger(value) && value >= 1 && value <= 6, {
      message: "Pick a whole number between 1 and 6",
    }),
});

export type SequenceValues = z.infer<typeof sequenceSchema>;
