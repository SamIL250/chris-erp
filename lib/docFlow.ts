/**
 * Document trail (PH2-27). One sale is quote, order, delivery,
 * invoice, and payment, in that order. A credit, a return, or an
 * exchange sits between the invoice and the payment when one exists.
 * A step with no document is still named. The current page is not a
 * link. Payment has no document until Phase 3, so that step stays
 * unnamed as a link.
 */

export const SALES_DOC_KINDS = [
  "quote",
  "order",
  "delivery",
  "invoice",
  "creditNote",
  "salesReturn",
  "payment",
] as const;

export type SalesDocKind = (typeof SALES_DOC_KINDS)[number];

export type DocFlowStep = {
  label: string;
  /** Omit when the document does not exist yet, or when this step is the current page. */
  href?: string;
  current?: boolean;
};

export type DocFlowDoc = {
  id: string;
  number: string;
};

export type SalesDocFlow = {
  currentKind: SalesDocKind;
  currentId: string;
  quote: DocFlowDoc | null;
  order: DocFlowDoc | null;
  deliveries: DocFlowDoc[];
  /** The delivery an invoice, credit, or return was raised from. */
  pinnedDelivery: DocFlowDoc | null;
  invoices: DocFlowDoc[];
  credits: DocFlowDoc[];
  returns: DocFlowDoc[];
  exchanges: DocFlowDoc[];
  payment: DocFlowDoc | null;
};

export function salesDocHref(kind: SalesDocKind, id: string): string {
  switch (kind) {
    case "quote":
      return `/sales/quotes/${id}`;
    case "order":
      return `/sales/orders/${id}`;
    case "delivery":
      return `/sales/deliveries/${id}`;
    case "invoice":
      return `/sales/invoices/${id}`;
    case "creditNote":
      return `/sales/credit-notes/${id}`;
    case "salesReturn":
      return `/sales/returns/${id}`;
    case "payment":
      return "";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function invoiceOnTrail(
  status: "draft" | "posted" | "paid" | "void",
  isCurrent: boolean,
): boolean {
  switch (status) {
    case "draft":
    case "posted":
    case "paid":
      return true;
    case "void":
      return isCurrent;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function deliveryOnTrail(
  status: "packed" | "shipped" | "cancelled",
  isCurrent: boolean,
): boolean {
  switch (status) {
    case "packed":
    case "shipped":
      return true;
    case "cancelled":
      return isCurrent;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function creditOnTrail(status: "draft" | "posted" | "void", isCurrent: boolean): boolean {
  switch (status) {
    case "draft":
    case "posted":
      return true;
    case "void":
      return isCurrent;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function returnOnTrail(
  status: "requested" | "received" | "credited" | "exchanged" | "cancelled",
  isCurrent: boolean,
): boolean {
  switch (status) {
    case "requested":
    case "received":
    case "credited":
    case "exchanged":
      return true;
    case "cancelled":
      return isCurrent;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function isCurrent(flow: SalesDocFlow, kind: SalesDocKind, id: string): boolean {
  return flow.currentKind === kind && flow.currentId === id;
}

function named(flow: SalesDocFlow, label: string, kind: "quote" | "order", doc: DocFlowDoc | null) {
  if (doc === null) return { label };
  if (isCurrent(flow, kind, doc.id)) return { label: `${label} ${doc.number}`, current: true };
  return { label: `${label} ${doc.number}`, href: salesDocHref(kind, doc.id) };
}

function listStep(
  flow: SalesDocFlow,
  kind: SalesDocKind,
  label: string,
  docs: DocFlowDoc[],
  manyHref: string,
  placeholder: boolean,
): DocFlowStep | null {
  const current = docs.find((doc) => isCurrent(flow, kind, doc.id));
  if (current !== undefined) return { label: `${label} ${current.number}`, current: true };
  if (docs.length === 0) return placeholder ? { label } : null;
  const only = docs[0];
  if (docs.length === 1 && only !== undefined) {
    return { label: `${label} ${only.number}`, href: salesDocHref(kind, only.id) };
  }
  return { label, href: manyHref };
}

function deliveryStep(flow: SalesDocFlow): DocFlowStep {
  if (flow.currentKind === "delivery") {
    const mine = flow.deliveries.find((doc) => doc.id === flow.currentId);
    return { label: mine === undefined ? "Delivery" : `Delivery ${mine.number}`, current: true };
  }
  if (flow.pinnedDelivery !== null) {
    return {
      label: `Delivery ${flow.pinnedDelivery.number}`,
      href: salesDocHref("delivery", flow.pinnedDelivery.id),
    };
  }
  return (
    listStep(flow, "delivery", "Delivery", flow.deliveries, "/sales/deliveries", true) ?? {
      label: "Delivery",
    }
  );
}

function exchangeStep(flow: SalesDocFlow): DocFlowStep | null {
  const docs = flow.exchanges.filter((doc) => !isCurrent(flow, "order", doc.id));
  if (docs.length === 0) return null;
  const only = docs[0];
  if (docs.length === 1 && only !== undefined) {
    return { label: `Exchange ${only.number}`, href: salesDocHref("order", only.id) };
  }
  return { label: "Exchange", href: "/sales/orders" };
}

function paymentStep(flow: SalesDocFlow): DocFlowStep {
  if (flow.payment === null) return { label: "Payment" };
  if (isCurrent(flow, "payment", flow.payment.id)) {
    return { label: `Payment ${flow.payment.number}`, current: true };
  }
  return { label: `Payment ${flow.payment.number}` };
}

/** The trail for one sale. The same steps appear on every document in it. */
export function salesDocFlowSteps(flow: SalesDocFlow): DocFlowStep[] {
  const steps: DocFlowStep[] = [
    named(flow, "Quote", "quote", flow.quote),
    named(flow, "Order", "order", flow.order),
    deliveryStep(flow),
    listStep(flow, "invoice", "Invoice", flow.invoices, "/sales/invoices", true) ?? {
      label: "Invoice",
    },
  ];
  const credit = listStep(flow, "creditNote", "Credit", flow.credits, "/sales/credit-notes", false);
  if (credit !== null) steps.push(credit);
  const salesReturn = listStep(
    flow,
    "salesReturn",
    "Return",
    flow.returns,
    "/sales/returns",
    false,
  );
  if (salesReturn !== null) steps.push(salesReturn);
  const exchange = exchangeStep(flow);
  if (exchange !== null) steps.push(exchange);
  steps.push(paymentStep(flow));
  return steps;
}
