import { ConvexError, v } from "convex/values";
import {
  addressFieldError,
  ADDRESS_CITY_MAX,
  ADDRESS_COUNTRY_MAX,
  ADDRESS_LINE_MAX,
  ADDRESS_POSTAL_MAX,
  ADDRESS_REGION_MAX,
  contactEmailError,
  contactNameError,
  contactPhoneError,
  contactTitleError,
  creditLimitError,
  customerCodeError,
  customerNameError,
  isCustomerStatus,
  normalizeCustomerCode,
  normalizeCustomerName,
  noteError,
  paymentTermsError,
  type CustomerStatus,
} from "../../lib/customers";
import { quoteTotals } from "../../lib/quotes";
import {
  accountBalance,
  availableCredit,
  roundMoney,
  type CustomerDocument,
} from "../../lib/statements";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Customers (PH2-01). Sales owns the master. Warehouse may edit
 * (fulfillment rides the same module). Accountant may read.
 * A customer has at most one group (PH2-02). The statement (PH2-05)
 * is invoices less credits and payments. None of those documents
 * exist yet, so the balance is zero and the document list is empty.
 */

type ReadCtx = QueryCtx | MutationCtx;

function blank(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  return value.length === 0 ? undefined : value;
}

async function requireCustomer(ctx: ReadCtx, customerId: Id<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (customer === null) throw new ConvexError("Customer not found.");
  return customer;
}

async function requireCurrency(ctx: ReadCtx, code: string) {
  const normalized = code.trim().toUpperCase();
  const currency = await ctx.db
    .query("currencies")
    .withIndex("by_code", (q) => q.eq("code", normalized))
    .unique();
  if (currency === null) throw new ConvexError("Currency not found.");
  if (!currency.active) throw new ConvexError("That currency is inactive.");
  return normalized;
}

async function requireTaxGroup(ctx: ReadCtx, taxGroupId: Id<"taxGroups"> | null | undefined) {
  if (taxGroupId === undefined || taxGroupId === null) return undefined;
  const group = await ctx.db.get(taxGroupId);
  if (group === null) throw new ConvexError("Tax group not found.");
  if (!group.active) throw new ConvexError("That tax group is inactive.");
  return taxGroupId;
}

/**
 * `keeping` is the group already on the customer. Saving the company
 * may leave that tier in place after it has been deactivated. Choosing
 * a different inactive tier is refused.
 */
async function requireCustomerGroup(
  ctx: ReadCtx,
  groupId: Id<"customerGroups"> | null | undefined,
  keeping?: Id<"customerGroups">,
) {
  if (groupId === undefined || groupId === null) return undefined;
  const group = await ctx.db.get(groupId);
  if (group === null) throw new ConvexError("Customer group not found.");
  if (!group.active && group._id !== keeping) {
    throw new ConvexError("That customer group is inactive.");
  }
  return groupId;
}

function headerFrom(args: {
  code: string;
  name: string;
  status: string;
  paymentTermsDays: number;
  creditLimit: number | null;
}) {
  const codeError = customerCodeError(args.code);
  if (codeError !== null) throw new ConvexError(codeError);
  const nameError = customerNameError(args.name);
  if (nameError !== null) throw new ConvexError(nameError);
  if (!isCustomerStatus(args.status)) throw new ConvexError("Choose an account status.");
  const termsError = paymentTermsError(args.paymentTermsDays);
  if (termsError !== null) throw new ConvexError(termsError);
  const limit = args.creditLimit;
  const limitError = creditLimitError(limit);
  if (limitError !== null) throw new ConvexError(limitError);
  return {
    code: normalizeCustomerCode(args.code),
    name: normalizeCustomerName(args.name),
    status: args.status as CustomerStatus,
    paymentTermsDays: args.paymentTermsDays,
    creditLimit: limit === null ? undefined : limit,
  };
}

function snapshot(row: Doc<"customers">) {
  return {
    code: row.code,
    name: row.name,
    status: row.status,
    paymentTermsDays: row.paymentTermsDays,
    taxGroupId: row.taxGroupId,
    groupId: row.groupId,
    currency: row.currency,
    creditLimit: row.creditLimit,
  };
}

async function contactsOf(ctx: ReadCtx, customerId: Id<"customers">) {
  const rows = await ctx.db
    .query("customerContacts")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  return rows.sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
}

async function addressesOf(ctx: ReadCtx, customerId: Id<"customers">) {
  const rows = await ctx.db
    .query("customerAddresses")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  return rows.sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
}

async function clearPrimary(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  keep: Id<"customerContacts">,
) {
  const rows = await contactsOf(ctx, customerId);
  const now = Date.now();
  for (const row of rows) {
    if (row._id !== keep && row.isPrimary) {
      await ctx.db.patch(row._id, { isPrimary: false, updatedAt: now });
    }
  }
}

async function clearDefault(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  keep: Id<"customerAddresses">,
  flag: "isDefaultBill" | "isDefaultShip",
) {
  const rows = await addressesOf(ctx, customerId);
  const now = Date.now();
  for (const row of rows) {
    if (row._id !== keep && row[flag]) {
      await ctx.db.patch(row._id, { [flag]: false, updatedAt: now });
    }
  }
}

function contactFields(args: { name: string; email?: string; phone?: string; jobTitle?: string }) {
  const nameError = contactNameError(args.name);
  if (nameError !== null) throw new ConvexError(nameError);
  const emailError = contactEmailError(args.email);
  if (emailError !== null) throw new ConvexError(emailError);
  const phoneError = contactPhoneError(args.phone);
  if (phoneError !== null) throw new ConvexError(phoneError);
  const titleError = contactTitleError(args.jobTitle);
  if (titleError !== null) throw new ConvexError(titleError);
  return {
    name: args.name.trim(),
    email: blank(args.email),
    phone: blank(args.phone),
    jobTitle: blank(args.jobTitle),
  };
}

function addressFields(args: {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
}) {
  const checks: [string, string | undefined, number, boolean][] = [
    ["Address line 1", args.line1, ADDRESS_LINE_MAX, true],
    ["Address line 2", args.line2, ADDRESS_LINE_MAX, false],
    ["City", args.city, ADDRESS_CITY_MAX, true],
    ["Region", args.region, ADDRESS_REGION_MAX, false],
    ["Postal code", args.postalCode, ADDRESS_POSTAL_MAX, false],
    ["Country", args.country, ADDRESS_COUNTRY_MAX, true],
  ];
  for (const [label, raw, max, required] of checks) {
    const message = addressFieldError(label, raw, max, required);
    if (message !== null) throw new ConvexError(message);
  }
  return {
    line1: args.line1.trim(),
    line2: blank(args.line2),
    city: args.city.trim(),
    region: blank(args.region),
    postalCode: blank(args.postalCode),
    country: args.country.trim(),
  };
}

const HEADER_ARGS = {
  code: v.string(),
  name: v.string(),
  status: v.union(v.literal("active"), v.literal("onHold"), v.literal("closed")),
  paymentTermsDays: v.number(),
  taxGroupId: v.union(v.id("taxGroups"), v.null()),
  groupId: v.union(v.id("customerGroups"), v.null()),
  currency: v.string(),
  creditLimit: v.union(v.number(), v.null()),
};

export const list = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("onHold"), v.literal("closed"))),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const status = args.status;
    const rows =
      status === undefined
        ? await ctx.db.query("customers").collect()
        : await ctx.db
            .query("customers")
            .withIndex("by_status", (q) => q.eq("status", status))
            .collect();
    const groups = await ctx.db.query("customerGroups").collect();
    const groupNames = new Map(groups.map((group) => [group._id, group.name]));
    const needle = (args.search ?? "").trim().toLowerCase();
    return rows
      .filter((row) => {
        if (needle.length === 0) return true;
        return row.name.toLowerCase().includes(needle) || row.code.toLowerCase().includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id))
      .map((row) => ({
        _id: row._id,
        code: row.code,
        name: row.name,
        status: row.status,
        paymentTermsDays: row.paymentTermsDays,
        currency: row.currency,
        creditLimit: row.creditLimit,
        groupName: row.groupId === undefined ? null : (groupNames.get(row.groupId) ?? null),
      }));
  },
});

/** Currencies, tax groups, and customer groups a sales user may assign. Settings access is not required. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "sales", "view");
    const currencies = await ctx.db.query("currencies").collect();
    const groups = await ctx.db.query("taxGroups").collect();
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .unique();
    return {
      currencies: currencies
        .filter((row) => row.active)
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((row) => ({ code: row.code, name: row.name })),
      taxGroups: groups
        .filter((row) => row.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({ _id: row._id, name: row.name })),
      customerGroups: (await ctx.db.query("customerGroups").collect())
        .sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id))
        .map((row) => ({ _id: row._id, name: row.name, active: row.active })),
      baseCurrency: org?.baseCurrency ?? null,
    };
  },
});

export const get = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const customer = await ctx.db.get(args.customerId);
    if (customer === null) return null;
    const group = customer.groupId === undefined ? null : await ctx.db.get(customer.groupId);
    const contacts = await contactsOf(ctx, customer._id);
    const addresses = await addressesOf(ctx, customer._id);
    const notes = await ctx.db
      .query("customerNotes")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const authors = await Promise.all(notes.map((note) => ctx.db.get(note.authorId)));
    return {
      customer,
      group: group === null ? null : { _id: group._id, name: group.name, active: group.active },
      contacts,
      addresses,
      notes: notes.map((note, index) => {
        const author = authors[index];
        return {
          _id: note._id,
          body: note.body,
          createdAt: note.createdAt,
          author: author?.name ?? author?.email ?? "Unknown user",
        };
      }),
    };
  },
});

export const create = auditedMutation({
  entity: "customers",
  action: "create",
  args: HEADER_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "create");
    const fields = headerFrom(args);
    const currency = await requireCurrency(ctx, args.currency);
    const taxGroupId = await requireTaxGroup(ctx, args.taxGroupId);
    const groupId = await requireCustomerGroup(ctx, args.groupId);
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_code", (q) => q.eq("code", fields.code))
      .unique();
    if (existing !== null) {
      throw new ConvexError(`A customer with code ${fields.code} already exists.`);
    }
    const now = Date.now();
    const id = await ctx.db.insert("customers", {
      ...fields,
      currency,
      ...(taxGroupId !== undefined ? { taxGroupId } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const row = await ctx.db.get(id);
    if (row === null) throw new ConvexError("Customer was not recorded.");
    return { result: id, audit: { entityId: id, after: snapshot(row) } };
  },
});

export const update = auditedMutation({
  entity: "customers",
  action: "update",
  args: { customerId: v.id("customers"), ...HEADER_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const existing = await requireCustomer(ctx, args.customerId);
    const fields = headerFrom(args);
    const currency = await requireCurrency(ctx, args.currency);
    const taxGroupId = await requireTaxGroup(ctx, args.taxGroupId);
    const groupId = await requireCustomerGroup(ctx, args.groupId, existing.groupId);
    const clash = await ctx.db
      .query("customers")
      .withIndex("by_code", (q) => q.eq("code", fields.code))
      .unique();
    if (clash !== null && clash._id !== existing._id) {
      throw new ConvexError(`A customer with code ${fields.code} already exists.`);
    }
    const before = snapshot(existing);
    await ctx.db.replace(existing._id, {
      code: fields.code,
      name: fields.name,
      status: fields.status,
      paymentTermsDays: fields.paymentTermsDays,
      currency,
      ...(taxGroupId !== undefined ? { taxGroupId } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
      ...(fields.creditLimit !== undefined ? { creditLimit: fields.creditLimit } : {}),
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    const fresh = await requireCustomer(ctx, existing._id);
    return { result: fresh._id, audit: { entityId: fresh._id, before, after: snapshot(fresh) } };
  },
});

const CONTACT_ARGS = {
  customerId: v.id("customers"),
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  isPrimary: v.boolean(),
};

export const addContact = auditedMutation({
  entity: "customerContacts",
  action: "create",
  args: CONTACT_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    await requireCustomer(ctx, args.customerId);
    const fields = contactFields(args);
    const existing = await contactsOf(ctx, args.customerId);
    const isPrimary = args.isPrimary || existing.length === 0;
    const now = Date.now();
    const id = await ctx.db.insert("customerContacts", {
      customerId: args.customerId,
      name: fields.name,
      ...(fields.email !== undefined ? { email: fields.email } : {}),
      ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      ...(fields.jobTitle !== undefined ? { jobTitle: fields.jobTitle } : {}),
      isPrimary,
      createdAt: now,
      updatedAt: now,
    });
    if (isPrimary) await clearPrimary(ctx, args.customerId, id);
    return {
      result: id,
      audit: { entityId: id, after: { ...fields, isPrimary, customerId: args.customerId } },
    };
  },
});

export const updateContact = auditedMutation({
  entity: "customerContacts",
  action: "update",
  args: { contactId: v.id("customerContacts"), ...CONTACT_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const existing = await ctx.db.get(args.contactId);
    if (existing === null || existing.customerId !== args.customerId) {
      throw new ConvexError("Contact not found.");
    }
    const fields = contactFields(args);
    const others = (await contactsOf(ctx, args.customerId)).filter(
      (row) => row._id !== existing._id,
    );
    const isPrimary =
      args.isPrimary || (existing.isPrimary && others.every((row) => !row.isPrimary));
    if (!isPrimary && !others.some((row) => row.isPrimary)) {
      throw new ConvexError("Choose a primary contact.");
    }
    await ctx.db.replace(existing._id, {
      customerId: existing.customerId,
      name: fields.name,
      ...(fields.email !== undefined ? { email: fields.email } : {}),
      ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      ...(fields.jobTitle !== undefined ? { jobTitle: fields.jobTitle } : {}),
      isPrimary,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    if (isPrimary) await clearPrimary(ctx, args.customerId, existing._id);
    return {
      result: existing._id,
      audit: {
        entityId: existing._id,
        before: {
          name: existing.name,
          email: existing.email,
          phone: existing.phone,
          jobTitle: existing.jobTitle,
          isPrimary: existing.isPrimary,
        },
        after: { ...fields, isPrimary },
      },
    };
  },
});

export const removeContact = auditedMutation({
  entity: "customerContacts",
  action: "delete",
  args: { contactId: v.id("customerContacts") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const existing = await ctx.db.get(args.contactId);
    if (existing === null) throw new ConvexError("Contact not found.");
    await ctx.db.delete(existing._id);
    if (existing.isPrimary) {
      const rest = await contactsOf(ctx, existing.customerId);
      const next = rest[0];
      if (next !== undefined) {
        await ctx.db.patch(next._id, { isPrimary: true, updatedAt: Date.now() });
      }
    }
    return {
      result: null,
      audit: {
        entityId: existing._id,
        before: { name: existing.name, customerId: existing.customerId },
      },
    };
  },
});

const ADDRESS_ARGS = {
  customerId: v.id("customers"),
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.string(),
  isDefaultBill: v.boolean(),
  isDefaultShip: v.boolean(),
};

export const addAddress = auditedMutation({
  entity: "customerAddresses",
  action: "create",
  args: ADDRESS_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    await requireCustomer(ctx, args.customerId);
    const fields = addressFields(args);
    const now = Date.now();
    const id = await ctx.db.insert("customerAddresses", {
      customerId: args.customerId,
      line1: fields.line1,
      ...(fields.line2 !== undefined ? { line2: fields.line2 } : {}),
      city: fields.city,
      ...(fields.region !== undefined ? { region: fields.region } : {}),
      ...(fields.postalCode !== undefined ? { postalCode: fields.postalCode } : {}),
      country: fields.country,
      isDefaultBill: args.isDefaultBill,
      isDefaultShip: args.isDefaultShip,
      createdAt: now,
      updatedAt: now,
    });
    if (args.isDefaultBill) await clearDefault(ctx, args.customerId, id, "isDefaultBill");
    if (args.isDefaultShip) await clearDefault(ctx, args.customerId, id, "isDefaultShip");
    return {
      result: id,
      audit: {
        entityId: id,
        after: {
          ...fields,
          isDefaultBill: args.isDefaultBill,
          isDefaultShip: args.isDefaultShip,
          customerId: args.customerId,
        },
      },
    };
  },
});

export const updateAddress = auditedMutation({
  entity: "customerAddresses",
  action: "update",
  args: { addressId: v.id("customerAddresses"), ...ADDRESS_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const existing = await ctx.db.get(args.addressId);
    if (existing === null || existing.customerId !== args.customerId) {
      throw new ConvexError("Address not found.");
    }
    const fields = addressFields(args);
    await ctx.db.replace(existing._id, {
      customerId: existing.customerId,
      line1: fields.line1,
      ...(fields.line2 !== undefined ? { line2: fields.line2 } : {}),
      city: fields.city,
      ...(fields.region !== undefined ? { region: fields.region } : {}),
      ...(fields.postalCode !== undefined ? { postalCode: fields.postalCode } : {}),
      country: fields.country,
      isDefaultBill: args.isDefaultBill,
      isDefaultShip: args.isDefaultShip,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    if (args.isDefaultBill) await clearDefault(ctx, args.customerId, existing._id, "isDefaultBill");
    if (args.isDefaultShip) await clearDefault(ctx, args.customerId, existing._id, "isDefaultShip");
    return {
      result: existing._id,
      audit: {
        entityId: existing._id,
        before: {
          line1: existing.line1,
          isDefaultBill: existing.isDefaultBill,
          isDefaultShip: existing.isDefaultShip,
        },
        after: { ...fields, isDefaultBill: args.isDefaultBill, isDefaultShip: args.isDefaultShip },
      },
    };
  },
});

export const removeAddress = auditedMutation({
  entity: "customerAddresses",
  action: "delete",
  args: { addressId: v.id("customerAddresses") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "edit");
    const existing = await ctx.db.get(args.addressId);
    if (existing === null) throw new ConvexError("Address not found.");
    await ctx.db.delete(existing._id);
    return {
      result: null,
      audit: {
        entityId: existing._id,
        before: { line1: existing.line1, customerId: existing.customerId },
      },
    };
  },
});

export const addNote = auditedMutation({
  entity: "customerNotes",
  action: "create",
  args: { customerId: v.id("customers"), body: v.string() },
  handler: async (ctx, args) => {
    const authorId = await requirePermission(ctx, "sales", "edit");
    await requireCustomer(ctx, args.customerId);
    const message = noteError(args.body);
    if (message !== null) throw new ConvexError(message);
    const body = args.body.trim();
    const id = await ctx.db.insert("customerNotes", {
      customerId: args.customerId,
      body,
      authorId,
      createdAt: Date.now(),
    });
    return { result: id, audit: { entityId: id, after: { customerId: args.customerId, body } } };
  },
});

/**
 * Account position (PH2-05). The balance is invoices less credits and
 * payments. A posted or paid sales invoice (PH2-16) adds its gross.
 * A draft is listed and adds nothing. A posted credit note (PH2-17)
 * lowers the balance. A draft credit is listed and adds nothing.
 * Marking an invoice paid does not record a payment, so `paid` stays
 * zero until Phase 3. A return is listed and does not change the
 * balance. Quotes, sales orders, and deliveries list here and do not
 * change the balance. A delivery's amount is the selling price of the
 * packed lines, not the cost. Available credit is the limit minus the
 * balance; a missing limit is no cap.
 */
export const statement = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "sales", "view");
    const customer = await ctx.db.get(args.customerId);
    if (customer === null) return null;
    let credited = 0;
    const paid = 0;
    let invoiced = 0;
    const creditLimit = customer.creditLimit ?? null;
    const quotes = await ctx.db
      .query("quotes")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    const documents: CustomerDocument[] = [];
    for (const quote of quotes) {
      const lines = await ctx.db
        .query("quoteLines")
        .withIndex("by_quote", (q) => q.eq("quoteId", quote._id))
        .collect();
      documents.push({
        kind: "quote",
        id: quote._id,
        number: quote.docNumber,
        at: quote.createdAt,
        amount: quoteTotals(lines, quote.decimalPlaces).gross,
      });
    }
    const orders = await ctx.db
      .query("salesOrders")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    for (const order of orders) {
      const lines = await ctx.db
        .query("salesOrderLines")
        .withIndex("by_order", (q) => q.eq("salesOrderId", order._id))
        .collect();
      documents.push({
        kind: "salesOrder",
        id: order._id,
        number: order.docNumber,
        at: order.createdAt,
        amount: quoteTotals(lines, order.decimalPlaces).gross,
      });
      const slips = await ctx.db
        .query("deliveries")
        .withIndex("by_order", (q) => q.eq("salesOrderId", order._id))
        .collect();
      for (const slip of slips) {
        if (slip.status === "cancelled") continue;
        const slipLines = await ctx.db
          .query("deliveryLines")
          .withIndex("by_delivery", (q) => q.eq("deliveryId", slip._id))
          .collect();
        let amount = 0;
        for (const slipLine of slipLines) {
          const orderLine = lines.find((row) => row._id === slipLine.salesOrderLineId);
          if (orderLine !== undefined) amount += slipLine.qty * orderLine.unitPrice;
        }
        documents.push({
          kind: "delivery",
          id: slip._id,
          number: slip.docNumber,
          at: slip.createdAt,
          amount: roundMoney(amount),
        });
      }
    }
    const invoices = await ctx.db
      .query("salesInvoices")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    for (const invoice of invoices) {
      if (invoice.status === "void") continue;
      const invoiceLines = await ctx.db
        .query("salesInvoiceLines")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      const gross = quoteTotals(invoiceLines, invoice.decimalPlaces).gross;
      if (invoice.status === "posted" || invoice.status === "paid") {
        invoiced = roundMoney(invoiced + gross);
      }
      documents.push({
        kind: "invoice",
        id: invoice._id,
        number: invoice.docNumber,
        at: invoice.createdAt,
        amount: gross,
      });
    }
    const credits = await ctx.db
      .query("creditNotes")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    for (const credit of credits) {
      if (credit.status === "void") continue;
      const creditLines = await ctx.db
        .query("creditNoteLines")
        .withIndex("by_credit", (q) => q.eq("creditNoteId", credit._id))
        .collect();
      const gross = quoteTotals(creditLines, credit.decimalPlaces).gross;
      if (credit.status === "posted") credited = roundMoney(credited + gross);
      documents.push({
        kind: "creditNote",
        id: credit._id,
        number: credit.docNumber,
        at: credit.createdAt,
        amount: gross,
      });
    }
    const returns = await ctx.db
      .query("salesReturns")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();
    for (const row of returns) {
      if (row.status === "cancelled") continue;
      const returnLines = await ctx.db
        .query("salesReturnLines")
        .withIndex("by_return", (q) => q.eq("salesReturnId", row._id))
        .collect();
      let amount = 0;
      for (const line of returnLines) amount += line.qty * line.unitPrice;
      documents.push({
        kind: "salesReturn",
        id: row._id,
        number: row.docNumber,
        at: row.createdAt,
        amount: roundMoney(amount),
      });
    }
    documents.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    const balance = accountBalance({ invoiced, credited, paid });
    return {
      currency: customer.currency,
      creditLimit,
      invoiced,
      credited,
      paid,
      balance,
      available: availableCredit(creditLimit, balance),
      documents,
    };
  },
});
