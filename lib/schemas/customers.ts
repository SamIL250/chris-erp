import { z } from "zod";
import {
  creditLimitError,
  customerCodeError,
  customerNameError,
  paymentTermsError,
} from "@/lib/customers";

/**
 * Customer header (PH2-01). Field messages come from `lib/customers`,
 * the same functions the mutation throws. An empty credit limit means
 * no cap. An empty tax group or customer group means none.
 */
export const customerSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    status: z.enum(["active", "onHold", "closed"]),
    paymentTermsDays: z.string(),
    taxGroupId: z.string(),
    groupId: z.string(),
    currency: z.string(),
    creditLimit: z.string(),
  })
  .superRefine((values, ctx) => {
    const codeError = customerCodeError(values.code);
    if (codeError !== null) ctx.addIssue({ code: "custom", path: ["code"], message: codeError });
    const nameError = customerNameError(values.name);
    if (nameError !== null) ctx.addIssue({ code: "custom", path: ["name"], message: nameError });
    const days = Number(values.paymentTermsDays);
    const termsError = paymentTermsError(days);
    if (values.paymentTermsDays.trim() === "" || termsError !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentTermsDays"],
        message: termsError ?? "Payment terms must be a whole number of days.",
      });
    }
    if (values.currency.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency." });
    }
    const limitText = values.creditLimit.trim();
    const limitError = creditLimitError(limitText === "" ? null : Number(limitText));
    if (limitError !== null) {
      ctx.addIssue({ code: "custom", path: ["creditLimit"], message: limitError });
    }
  });

export type CustomerValues = z.infer<typeof customerSchema>;
