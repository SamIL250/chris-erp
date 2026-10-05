import { ConvexError } from "convex/values";
import { SYSTEM_ROLES } from "../lib/permissions";
import { auditedMutation } from "./_lib/audit";
import { inviteUser } from "./_lib/invites";
import { grantRole, requirePermission, requireRole } from "./_lib/permissions";
import { ensureDefaultSequences } from "./_lib/sequences";

/**
 * Demo-data seed (PH0-34) — idempotent, additive, never overwrites.
 *
 * Creates whatever is missing, in this order:
 *   1. one demo organization (only while NONE exists — never touches yours)
 *   2. base currencies USD/EUR/GBP (missing codes only)
 *   3. canonical tax rates standard/reduced/zero (missing names only)
 *   4. the 11 default document sequences (PH0-25, already idempotent)
 *   5. one invited user per system role (`<role>@example.com`) with that
 *      role granted — invite codes returned in the result so a dev can set
 *      passwords without Resend. Existing users are only ever given a role
 *      they don't have yet; disabled accounts are left alone.
 *
 * Safety: grants roles, so it is Owner-only (settings.create first per rule
 * 2, then requireRole — Admin gets rule 4's message). Running it twice makes
 * no changes and records no audit entry. Invite URLs live ONLY in the result
 * — never in the audit trail.
 *
 * Run via `node scripts/seed.mjs` (signs in as the owner) or an authenticated
 * `seed:seed` mutation call; the system-context CLI (`npx convex run`) is
 * intentionally rejected (no identity).
 */
export const seed = auditedMutation({
  entity: "seed",
  action: "create",
  args: {},
  handler: async (ctx) => {
    const callerId = await requirePermission(ctx, "settings", "create");
    await requireRole(ctx, callerId, "owner");

    const created: Record<string, number> = {};
    const bump = (key: string) => {
      created[key] = (created[key] ?? 0) + 1;
    };
    const invitedEmails: string[] = [];
    const invites: { email: string; url: string }[] = [];

    const now = Date.now();

    // 1. Organization — only while none exists; your company is never edited.
    const activeOrg = await ctx.db
      .query("organizations")
      .withIndex("by_active", (q) => q.eq("active", true))
      .unique();
    if (activeOrg === null) {
      await ctx.db.insert("organizations", {
        name: "Chris Trading Ltd",
        legalName: "Chris Trading Limited",
        email: "billing@example.com",
        phone: "+31 10 123 4567",
        address: {
          line1: "12 Harbour Road",
          city: "Rotterdam",
          postalCode: "3011 AA",
          country: "Netherlands",
        },
        baseCurrency: "USD",
        invoiceFooter:
          "Payment due within 30 days of invoice date. Goods remain property " +
          "of Chris Trading Ltd until paid in full.",
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      bump("organization");
    }

    // 2. Currencies — missing codes only.
    const currencies = [
      { code: "USD", name: "US Dollar", symbol: "$" },
      { code: "EUR", name: "Euro", symbol: "€" },
      { code: "GBP", name: "Pound sterling", symbol: "£" },
    ] as const;
    for (const currency of currencies) {
      const found = await ctx.db
        .query("currencies")
        .withIndex("by_code", (q) => q.eq("code", currency.code))
        .unique();
      if (found === null) {
        await ctx.db.insert("currencies", {
          ...currency,
          decimalPlaces: 2,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
        bump("currencies");
      }
    }

    // 3. Tax rates — missing names only (rates are never deleted or edited).
    const taxRates = [
      { name: "Standard rate", code: "STD", rateBps: 2000 },
      { name: "Reduced rate", code: "RED", rateBps: 500 },
      { name: "Zero rate", code: "ZERO", rateBps: 0 },
    ] as const;
    const rateNames = new Set((await ctx.db.query("taxRates").collect()).map((r) => r.name));
    for (const rate of taxRates) {
      if (!rateNames.has(rate.name)) {
        await ctx.db.insert("taxRates", {
          ...rate,
          inclusive: false,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
        bump("taxRates");
      }
    }

    // 4. Default document sequences (PH0-25 — idempotent by design).
    const sequencesBefore = (await ctx.db.query("sequences").collect()).length;
    await ensureDefaultSequences(ctx);
    const sequencesCreated = (await ctx.db.query("sequences").collect()).length - sequencesBefore;
    if (sequencesCreated > 0) created.sequences = sequencesCreated;

    // 5. One invited user per system role.
    for (const role of SYSTEM_ROLES) {
      const email = `${role.key}@example.com`;
      const matches = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .take(2);
      if (matches.length > 1) {
        throw new ConvexError(
          "Multiple accounts already use this email — resolve the duplicates first.",
        );
      }
      const existing = matches[0];
      if (existing === undefined) {
        // Creates the profile, grants the role (Owner-checked inside), and
        // returns the dev invite link — no Resend key needed.
        const invite = await inviteUser(ctx, { email, role: role.key, inviterId: callerId });
        bump("users");
        invitedEmails.push(email);
        invites.push({ email, url: invite.url });
        continue;
      }
      if (existing.status === "disabled") continue;
      // Additive only: never clobber a role someone chose deliberately.
      const assignments = await ctx.db
        .query("userRoles")
        .withIndex("by_user", (q) => q.eq("userId", existing._id))
        .take(1);
      if (assignments.length === 0) {
        await grantRole(ctx, { userId: existing._id, roleKey: role.key, grantedBy: callerId });
        bump("roleGrants");
      }
    }

    const changed =
      Object.values(created).reduce((total, count) => total + count, 0) > 0 ||
      invitedEmails.length > 0;
    return {
      result: { created, invites },
      // Nothing happened on a second run → record nothing (PH0-30 pattern).
      audit: changed
        ? { entityId: "demo-data", after: { created, invited: invitedEmails } }
        : undefined,
    };
  },
});
