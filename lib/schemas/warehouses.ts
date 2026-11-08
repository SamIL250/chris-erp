import { z } from "zod";
import {
  normalizeWarehouseAddress,
  warehouseCodeError,
  warehouseNameError,
} from "@/lib/warehouses";

/**
 * Warehouse create/edit dialog (PH1-16). Field messages come from
 * `lib/warehouses`, the same functions the mutation throws.
 */
export const warehouseSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    address: z.string(),
    isDefault: z.boolean(),
    active: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const codeError = warehouseCodeError(values.code);
    if (codeError !== null) ctx.addIssue({ code: "custom", path: ["code"], message: codeError });
    const nameError = warehouseNameError(values.name);
    if (nameError !== null) ctx.addIssue({ code: "custom", path: ["name"], message: nameError });
    const address = normalizeWarehouseAddress(values.address);
    if ("error" in address) {
      ctx.addIssue({ code: "custom", path: ["address"], message: address.error });
    }
  });

export type WarehouseValues = z.infer<typeof warehouseSchema>;
