import { z } from "zod";

/**
 * Company settings form (PH0-29). Optional fields: an empty string clears
 * the stored value (the mutation saves the whole form).
 */
export const companySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Company name is required")
    .max(200, "Keep it under 200 characters"),
  legalName: z.string().trim().max(200, "Keep it under 200 characters"),
  taxId: z.string().trim().max(100, "Keep it under 100 characters"),
  email: z
    .string()
    .trim()
    .max(200, "Keep it under 200 characters")
    .refine(
      (value) => value === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
      "Enter a valid email",
    ),
  phone: z.string().trim().max(50, "Keep it under 50 characters"),
  address: z.object({
    line1: z.string().trim().max(200, "Keep it under 200 characters"),
    line2: z.string().trim().max(200, "Keep it under 200 characters"),
    city: z.string().trim().max(100, "Keep it under 100 characters"),
    state: z.string().trim().max(100, "Keep it under 100 characters"),
    postalCode: z.string().trim().max(20, "Keep it under 20 characters"),
    country: z.string().trim().max(100, "Keep it under 100 characters"),
  }),
  invoiceFooter: z.string().trim().max(2000, "Keep it under 2000 characters"),
});

export type CompanyValues = z.infer<typeof companySchema>;
