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
  paymentTermsError,
} from "../../lib/customers";
import { receiptAmount, receivedTotal } from "../../lib/statements";
import {
  licenseExpiryError,
  licenseJurisdictionError,
  licenseNumberError,
  normalizeVendorCode,
  normalizeVendorName,
  taxNumberError,
  vendorCodeError,
  vendorNameError,
} from "../../lib/vendors";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";

/**
 * Vendors (PH2-03). Procurement owns the master. Warehouse may open
 * one (receiving is procurement.create) and cannot edit it. Accountant
 * may edit terms and license fields and cannot open one. Sales may
 * read. Product links are PH2-04. The statement (PH2-05) sums goods
 * receipts that name this vendor. Bills are not included.
 * An expired license is stored; Phase 5 enforces it.
 */

type ReadCtx = QueryCtx | MutationCtx;

function blank(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  return value.length === 0 ? undefined : value;
}

function cleared(raw: string | null, error: (value: string | null) => string | null) {
  const message = error(raw);
  if (message !== null) throw new ConvexError(message);
  if (raw === null) return undefined;
  return blank(raw);
}

async function requireVendor(ctx: ReadCtx, vendorId: Id<"vendors">) {
  const vendor = await ctx.db.get(vendorId);
  if (vendor === null) throw new ConvexError("Vendor not found.");
  return vendor;
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

function headerFrom(args: {
  code: string;
  name: string;
  paymentTermsDays: number;
  taxNumber: string | null;
  licenseNumber: string | null;
  licenseJurisdiction: string | null;
  licenseExpiresOn: number | null;
}) {
  const codeError = vendorCodeError(args.code);
  if (codeError !== null) throw new ConvexError(codeError);
  const nameError = vendorNameError(args.name);
  if (nameError !== null) throw new ConvexError(nameError);
  const termsError = paymentTermsError(args.paymentTermsDays);
  if (termsError !== null) throw new ConvexError(termsError);
  const expiryError = licenseExpiryError(args.licenseExpiresOn);
  if (expiryError !== null) throw new ConvexError(expiryError);
  return {
    code: normalizeVendorCode(args.code),
    name: normalizeVendorName(args.name),
    paymentTermsDays: args.paymentTermsDays,
    taxNumber: cleared(args.taxNumber, taxNumberError),
    licenseNumber: cleared(args.licenseNumber, licenseNumberError),
    licenseJurisdiction: cleared(args.licenseJurisdiction, licenseJurisdictionError),
    licenseExpiresOn: args.licenseExpiresOn === null ? undefined : args.licenseExpiresOn,
  };
}

function snapshot(row: Doc<"vendors">) {
  return {
    code: row.code,
    name: row.name,
    active: row.active,
    paymentTermsDays: row.paymentTermsDays,
    taxGroupId: row.taxGroupId,
    taxNumber: row.taxNumber,
    currency: row.currency,
    licenseNumber: row.licenseNumber,
    licenseJurisdiction: row.licenseJurisdiction,
    licenseExpiresOn: row.licenseExpiresOn,
  };
}

async function contactsOf(ctx: ReadCtx, vendorId: Id<"vendors">) {
  const rows = await ctx.db
    .query("vendorContacts")
    .withIndex("by_vendor", (q) => q.eq("vendorId", vendorId))
    .collect();
  return rows.sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
}

async function addressesOf(ctx: ReadCtx, vendorId: Id<"vendors">) {
  const rows = await ctx.db
    .query("vendorAddresses")
    .withIndex("by_vendor", (q) => q.eq("vendorId", vendorId))
    .collect();
  return rows.sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
}

async function clearPrimary(ctx: MutationCtx, vendorId: Id<"vendors">, keep: Id<"vendorContacts">) {
  const rows = await contactsOf(ctx, vendorId);
  const now = Date.now();
  for (const row of rows) {
    if (row._id !== keep && row.isPrimary) {
      await ctx.db.patch(row._id, { isPrimary: false, updatedAt: now });
    }
  }
}

async function clearDefault(
  ctx: MutationCtx,
  vendorId: Id<"vendors">,
  keep: Id<"vendorAddresses">,
  flag: "isDefaultRemit" | "isDefaultShip",
) {
  const rows = await addressesOf(ctx, vendorId);
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
  active: v.boolean(),
  paymentTermsDays: v.number(),
  taxGroupId: v.union(v.id("taxGroups"), v.null()),
  taxNumber: v.union(v.string(), v.null()),
  currency: v.string(),
  licenseNumber: v.union(v.string(), v.null()),
  licenseJurisdiction: v.union(v.string(), v.null()),
  licenseExpiresOn: v.union(v.number(), v.null()),
};

export const list = query({
  args: {
    search: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const active = args.active;
    const rows =
      active === undefined
        ? await ctx.db.query("vendors").collect()
        : await ctx.db
            .query("vendors")
            .withIndex("by_active", (q) => q.eq("active", active))
            .collect();
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
        active: row.active,
        paymentTermsDays: row.paymentTermsDays,
        currency: row.currency,
        licenseNumber: row.licenseNumber ?? null,
      }));
  },
});

/** Currencies and tax groups a procurement user may assign. Settings access is not required. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "procurement", "view");
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
      baseCurrency: org?.baseCurrency ?? null,
    };
  },
});

export const get = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const vendor = await ctx.db.get(args.vendorId);
    if (vendor === null) return null;
    const contacts = await contactsOf(ctx, vendor._id);
    const addresses = await addressesOf(ctx, vendor._id);
    return { vendor, contacts, addresses };
  },
});

function vendorRow(
  fields: ReturnType<typeof headerFrom>,
  args: { active: boolean; currency: string; taxGroupId: Id<"taxGroups"> | undefined },
  stamps: { createdAt: number; updatedAt: number },
) {
  return {
    code: fields.code,
    name: fields.name,
    active: args.active,
    paymentTermsDays: fields.paymentTermsDays,
    currency: args.currency,
    ...(args.taxGroupId !== undefined ? { taxGroupId: args.taxGroupId } : {}),
    ...(fields.taxNumber !== undefined ? { taxNumber: fields.taxNumber } : {}),
    ...(fields.licenseNumber !== undefined ? { licenseNumber: fields.licenseNumber } : {}),
    ...(fields.licenseJurisdiction !== undefined
      ? { licenseJurisdiction: fields.licenseJurisdiction }
      : {}),
    ...(fields.licenseExpiresOn !== undefined ? { licenseExpiresOn: fields.licenseExpiresOn } : {}),
    createdAt: stamps.createdAt,
    updatedAt: stamps.updatedAt,
  };
}

export const create = auditedMutation({
  entity: "vendors",
  action: "create",
  args: HEADER_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "create");
    const fields = headerFrom(args);
    const currency = await requireCurrency(ctx, args.currency);
    const taxGroupId = await requireTaxGroup(ctx, args.taxGroupId);
    const existing = await ctx.db
      .query("vendors")
      .withIndex("by_code", (q) => q.eq("code", fields.code))
      .unique();
    if (existing !== null) {
      throw new ConvexError(`A vendor with code ${fields.code} already exists.`);
    }
    const now = Date.now();
    const id = await ctx.db.insert(
      "vendors",
      vendorRow(
        fields,
        { active: args.active, currency, taxGroupId },
        { createdAt: now, updatedAt: now },
      ),
    );
    const row = await ctx.db.get(id);
    if (row === null) throw new ConvexError("Vendor was not recorded.");
    return { result: id, audit: { entityId: id, after: snapshot(row) } };
  },
});

export const update = auditedMutation({
  entity: "vendors",
  action: "update",
  args: { vendorId: v.id("vendors"), ...HEADER_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const existing = await requireVendor(ctx, args.vendorId);
    const fields = headerFrom(args);
    const currency = await requireCurrency(ctx, args.currency);
    const taxGroupId = await requireTaxGroup(ctx, args.taxGroupId);
    const clash = await ctx.db
      .query("vendors")
      .withIndex("by_code", (q) => q.eq("code", fields.code))
      .unique();
    if (clash !== null && clash._id !== existing._id) {
      throw new ConvexError(`A vendor with code ${fields.code} already exists.`);
    }
    const before = snapshot(existing);
    await ctx.db.replace(
      existing._id,
      vendorRow(
        fields,
        { active: args.active, currency, taxGroupId },
        { createdAt: existing.createdAt, updatedAt: Date.now() },
      ),
    );
    const fresh = await requireVendor(ctx, existing._id);
    return { result: fresh._id, audit: { entityId: fresh._id, before, after: snapshot(fresh) } };
  },
});

const CONTACT_ARGS = {
  vendorId: v.id("vendors"),
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  isPrimary: v.boolean(),
};

export const addContact = auditedMutation({
  entity: "vendorContacts",
  action: "create",
  args: CONTACT_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    await requireVendor(ctx, args.vendorId);
    const fields = contactFields(args);
    const existing = await contactsOf(ctx, args.vendorId);
    const isPrimary = args.isPrimary || existing.length === 0;
    const now = Date.now();
    const id = await ctx.db.insert("vendorContacts", {
      vendorId: args.vendorId,
      name: fields.name,
      ...(fields.email !== undefined ? { email: fields.email } : {}),
      ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      ...(fields.jobTitle !== undefined ? { jobTitle: fields.jobTitle } : {}),
      isPrimary,
      createdAt: now,
      updatedAt: now,
    });
    if (isPrimary) await clearPrimary(ctx, args.vendorId, id);
    return {
      result: id,
      audit: { entityId: id, after: { ...fields, isPrimary, vendorId: args.vendorId } },
    };
  },
});

export const updateContact = auditedMutation({
  entity: "vendorContacts",
  action: "update",
  args: { contactId: v.id("vendorContacts"), ...CONTACT_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const existing = await ctx.db.get(args.contactId);
    if (existing === null || existing.vendorId !== args.vendorId) {
      throw new ConvexError("Contact not found.");
    }
    const fields = contactFields(args);
    const others = (await contactsOf(ctx, args.vendorId)).filter((row) => row._id !== existing._id);
    const isPrimary =
      args.isPrimary || (existing.isPrimary && others.every((row) => !row.isPrimary));
    if (!isPrimary && !others.some((row) => row.isPrimary)) {
      throw new ConvexError("Choose a primary contact.");
    }
    await ctx.db.replace(existing._id, {
      vendorId: existing.vendorId,
      name: fields.name,
      ...(fields.email !== undefined ? { email: fields.email } : {}),
      ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
      ...(fields.jobTitle !== undefined ? { jobTitle: fields.jobTitle } : {}),
      isPrimary,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    if (isPrimary) await clearPrimary(ctx, args.vendorId, existing._id);
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
  entity: "vendorContacts",
  action: "delete",
  args: { contactId: v.id("vendorContacts") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const existing = await ctx.db.get(args.contactId);
    if (existing === null) throw new ConvexError("Contact not found.");
    await ctx.db.delete(existing._id);
    if (existing.isPrimary) {
      const rest = await contactsOf(ctx, existing.vendorId);
      const next = rest[0];
      if (next !== undefined) {
        await ctx.db.patch(next._id, { isPrimary: true, updatedAt: Date.now() });
      }
    }
    return {
      result: null,
      audit: {
        entityId: existing._id,
        before: { name: existing.name, vendorId: existing.vendorId },
      },
    };
  },
});

const ADDRESS_ARGS = {
  vendorId: v.id("vendors"),
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.string(),
  isDefaultRemit: v.boolean(),
  isDefaultShip: v.boolean(),
};

export const addAddress = auditedMutation({
  entity: "vendorAddresses",
  action: "create",
  args: ADDRESS_ARGS,
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    await requireVendor(ctx, args.vendorId);
    const fields = addressFields(args);
    const now = Date.now();
    const id = await ctx.db.insert("vendorAddresses", {
      vendorId: args.vendorId,
      line1: fields.line1,
      ...(fields.line2 !== undefined ? { line2: fields.line2 } : {}),
      city: fields.city,
      ...(fields.region !== undefined ? { region: fields.region } : {}),
      ...(fields.postalCode !== undefined ? { postalCode: fields.postalCode } : {}),
      country: fields.country,
      isDefaultRemit: args.isDefaultRemit,
      isDefaultShip: args.isDefaultShip,
      createdAt: now,
      updatedAt: now,
    });
    if (args.isDefaultRemit) await clearDefault(ctx, args.vendorId, id, "isDefaultRemit");
    if (args.isDefaultShip) await clearDefault(ctx, args.vendorId, id, "isDefaultShip");
    return {
      result: id,
      audit: {
        entityId: id,
        after: {
          ...fields,
          isDefaultRemit: args.isDefaultRemit,
          isDefaultShip: args.isDefaultShip,
          vendorId: args.vendorId,
        },
      },
    };
  },
});

export const updateAddress = auditedMutation({
  entity: "vendorAddresses",
  action: "update",
  args: { addressId: v.id("vendorAddresses"), ...ADDRESS_ARGS },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const existing = await ctx.db.get(args.addressId);
    if (existing === null || existing.vendorId !== args.vendorId) {
      throw new ConvexError("Address not found.");
    }
    const fields = addressFields(args);
    await ctx.db.replace(existing._id, {
      vendorId: existing.vendorId,
      line1: fields.line1,
      ...(fields.line2 !== undefined ? { line2: fields.line2 } : {}),
      city: fields.city,
      ...(fields.region !== undefined ? { region: fields.region } : {}),
      ...(fields.postalCode !== undefined ? { postalCode: fields.postalCode } : {}),
      country: fields.country,
      isDefaultRemit: args.isDefaultRemit,
      isDefaultShip: args.isDefaultShip,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    });
    if (args.isDefaultRemit) await clearDefault(ctx, args.vendorId, existing._id, "isDefaultRemit");
    if (args.isDefaultShip) await clearDefault(ctx, args.vendorId, existing._id, "isDefaultShip");
    return {
      result: existing._id,
      audit: {
        entityId: existing._id,
        before: {
          line1: existing.line1,
          city: existing.city,
          country: existing.country,
          isDefaultRemit: existing.isDefaultRemit,
          isDefaultShip: existing.isDefaultShip,
        },
        after: {
          ...fields,
          isDefaultRemit: args.isDefaultRemit,
          isDefaultShip: args.isDefaultShip,
        },
      },
    };
  },
});

export const removeAddress = auditedMutation({
  entity: "vendorAddresses",
  action: "delete",
  args: { addressId: v.id("vendorAddresses") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "edit");
    const existing = await ctx.db.get(args.addressId);
    if (existing === null) throw new ConvexError("Address not found.");
    await ctx.db.delete(existing._id);
    return {
      result: null,
      audit: {
        entityId: existing._id,
        before: { line1: existing.line1, vendorId: existing.vendorId },
      },
    };
  },
});

const STATEMENT_CAP = 200;

/**
 * Receipts that name this vendor, newest first, plus the cost total
 * (PH2-05). A line without a unit cost does not add to the amount.
 * A receipt whose lines all lack a cost is listed with a null amount.
 */
export const statement = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "procurement", "view");
    const vendor = await ctx.db.get(args.vendorId);
    if (vendor === null) return null;
    const receipts = await ctx.db
      .query("goodsReceipts")
      .withIndex("by_vendor", (q) => q.eq("vendorId", args.vendorId))
      .order("desc")
      .take(STATEMENT_CAP);
    const documents = [];
    for (const receipt of receipts) {
      const lines = await ctx.db
        .query("goodsReceiptLines")
        .withIndex("by_receipt", (q) => q.eq("receiptId", receipt._id))
        .collect();
      const warehouse = await ctx.db.get(receipt.warehouseId);
      documents.push({
        receiptId: receipt._id,
        number: receipt.number,
        createdAt: receipt.createdAt,
        referenceNote: receipt.referenceNote,
        warehouseCode: warehouse?.code ?? null,
        amount: receiptAmount(lines),
      });
    }
    return {
      currency: vendor.currency,
      receiptCount: documents.length,
      received: receivedTotal(documents.map((row) => row.amount)),
      documents,
    };
  },
});
