import { z } from "zod";
import { customerGroupNameError } from "@/lib/customers";

/** Customer group name (PH2-02). The message matches the mutation. */
export const customerGroupSchema = z
  .object({
    name: z.string(),
    active: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const message = customerGroupNameError(values.name);
    if (message !== null) ctx.addIssue({ code: "custom", path: ["name"], message });
  });

export type CustomerGroupValues = z.infer<typeof customerGroupSchema>;
