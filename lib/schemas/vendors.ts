import { z } from "zod";
import { paymentTermsError } from "@/lib/customers";
import {
  licenseExpiryFromInput,
  licenseJurisdictionError,
  licenseNumberError,
  taxNumberError,
  vendorCodeError,
  vendorNameError,
} from "@/lib/vendors";

/**
 * Vendor header (PH2-03). Field messages come from `lib/vendors` and
 * the shared term rule. An empty tax group, tax number, or license
 * field means none. A past license expiry is allowed.
 */
export const vendorSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
    paymentTermsDays: z.string(),
    taxGroupId: z.string(),
    taxNumber: z.string(),
    currency: z.string(),
    licenseNumber: z.string(),
    licenseJurisdiction: z.string(),
    licenseExpiresOn: z.string(),
  })
  .superRefine((values, ctx) => {
    const codeError = vendorCodeError(values.code);
    if (codeError !== null) ctx.addIssue({ code: "custom", path: ["code"], message: codeError });
    const nameError = vendorNameError(values.name);
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
    const taxError = taxNumberError(values.taxNumber);
    if (taxError !== null) ctx.addIssue({ code: "custom", path: ["taxNumber"], message: taxError });
    const numberError = licenseNumberError(values.licenseNumber);
    if (numberError !== null) {
      ctx.addIssue({ code: "custom", path: ["licenseNumber"], message: numberError });
    }
    const jurisdictionError = licenseJurisdictionError(values.licenseJurisdiction);
    if (jurisdictionError !== null) {
      ctx.addIssue({ code: "custom", path: ["licenseJurisdiction"], message: jurisdictionError });
    }
    const expiry = licenseExpiryFromInput(values.licenseExpiresOn);
    if ("error" in expiry) {
      ctx.addIssue({ code: "custom", path: ["licenseExpiresOn"], message: expiry.error });
    }
  });

export type VendorValues = z.infer<typeof vendorSchema>;
