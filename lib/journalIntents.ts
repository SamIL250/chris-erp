/**
 * Journal intents (PH2-26). An operational event that must post writes
 * one pending row: the type, the amount lines, the source document, and
 * the period. Phase 3 consumes the row. This module names the types and
 * the line amount. It does not post.
 */

import { roundMoney } from "./statements";

export const JOURNAL_INTENT_TYPES = [
  "cogs",
  "salesInvoice",
  "creditNote",
  "vendorBill",
  "goodsReceipt",
  "debitNote",
  "stockAdjustment",
] as const;

export type JournalIntentType = (typeof JOURNAL_INTENT_TYPES)[number];

export const JOURNAL_INTENT_STATUSES = ["pending"] as const;

export type JournalIntentStatus = (typeof JOURNAL_INTENT_STATUSES)[number];

/**
 * Quantity times the unit cost, sign included. A missing cost is zero,
 * so the event is still on the backlog.
 */
export function intentLineAmount(qty: number, unitCost: number | undefined): number {
  if (unitCost === undefined) return 0;
  return roundMoney(qty * unitCost);
}

export function intentTotal(amounts: number[]): number {
  return roundMoney(amounts.reduce((sum, amount) => sum + amount, 0));
}

export function journalIntentTypeLabel(type: JournalIntentType): string {
  switch (type) {
    case "cogs":
      return "Cost of goods";
    case "salesInvoice":
      return "Sales invoice";
    case "creditNote":
      return "Credit note";
    case "vendorBill":
      return "Vendor bill";
    case "goodsReceipt":
      return "Goods receipt";
    case "debitNote":
      return "Debit note";
    case "stockAdjustment":
      return "Stock adjustment";
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export function journalIntentStatusLabel(status: JournalIntentStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
