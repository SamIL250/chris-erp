import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import { requirePermission } from "./_lib/permissions";
import { query, type QueryCtx } from "./_generated/server";

/**
 * Company settings (PH0-29): one active `organizations` document holding the
 * legal identity, contact details, registered address, logo, and invoice
 * footer that future documents (quotes, invoices, delivery notes) print.
 *
 * Reads need a session but NOT `settings.view` — every document renderer
 * needs the letterhead. Edits need `settings.edit` (Owner/Admin, not
 * Accountant) and are audited.
 *
 * `update` is a full-form save: every editable field is replaced by what's
 * passed; an omitted optional field is cleared (that's how the form drops
 * blanks).
 */

const addressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
});

/** The single active company document (null until the first save). */
async function findOrganization(ctx: QueryCtx) {
  return await ctx.db
    .query("organizations")
    .withIndex("by_active", (q) => q.eq("active", true))
    .unique();
}

/** Company document with the logo resolved to a freshly signed URL. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) {
      throw new ConvexError("Not authenticated");
    }
    const org = await findOrganization(ctx);
    if (org === null) return null;
    let logoUrl: string | null = null;
    if (org.logoFileId !== undefined) {
      const file = await ctx.db.get(org.logoFileId);
      logoUrl = file !== null ? await ctx.storage.getUrl(file.storageId) : null;
    }
    return { ...org, logoUrl };
  },
});

export const update = auditedMutation({
  entity: "organizations",
  action: "update",
  args: {
    name: v.string(),
    legalName: v.optional(v.string()),
    taxId: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(addressValidator),
    invoiceFooter: v.optional(v.string()),
    logoFileId: v.nullable(v.id("files")),
  },
  handler: async (ctx, args) => {
    // Rule 2: permission first — the wrapper appends the audit last.
    await requirePermission(ctx, "settings", "edit");

    const name = args.name.trim();
    if (name.length < 1 || name.length > 200) {
      throw new ConvexError("Company name must be between 1 and 200 characters.");
    }
    const email = args.email?.trim() || undefined;
    if (email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError("Enter a valid contact email.");
    }
    if (args.invoiceFooter !== undefined && args.invoiceFooter.length > 2000) {
      throw new ConvexError("Invoice footer must be under 2000 characters.");
    }
    if (args.logoFileId !== null) {
      const file = await ctx.db.get(args.logoFileId);
      if (file === null) {
        throw new ConvexError("That logo file no longer exists.");
      }
      if (file.kind !== "logo") {
        throw new ConvexError("That file wasn't uploaded as a logo.");
      }
    }

    const legalName = args.legalName?.trim() || undefined;
    const taxId = args.taxId?.trim() || undefined;
    const phone = args.phone?.trim() || undefined;
    const invoiceFooter = args.invoiceFooter?.trim() || undefined;
    const after = {
      name,
      legalName,
      taxId,
      email,
      phone,
      address: args.address,
      invoiceFooter,
      logoFileId: args.logoFileId ?? null,
    };

    const existing = await findOrganization(ctx);
    const now = Date.now();
    if (existing === null) {
      // First save creates the document (base currency defaults until
      // seed/PH0-31 set the real one).
      const orgId = await ctx.db.insert("organizations", {
        name,
        legalName,
        taxId,
        email,
        phone,
        address: args.address,
        invoiceFooter,
        logoFileId: args.logoFileId ?? undefined,
        baseCurrency: "USD",
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      return {
        result: undefined,
        audit: { entityId: orgId, after },
      };
    }

    // Full-form save: present keys replace, explicit undefined clears.
    await ctx.db.patch(existing._id, {
      name,
      legalName,
      taxId,
      email,
      phone,
      address: args.address,
      invoiceFooter,
      logoFileId: args.logoFileId ?? undefined,
      updatedAt: now,
    });
    return {
      result: undefined,
      audit: {
        entityId: existing._id,
        before: {
          name: existing.name,
          legalName: existing.legalName,
          taxId: existing.taxId,
          email: existing.email,
          phone: existing.phone,
          address: existing.address,
          invoiceFooter: existing.invoiceFooter,
          logoFileId: existing.logoFileId ?? null,
        },
        after,
      },
    };
  },
});
