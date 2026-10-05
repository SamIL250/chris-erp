import { ConvexError } from "convex/values";
import { SYSTEM_ROLES } from "../lib/permissions";
import { auditedMutation } from "./_lib/audit";
import { inviteUser } from "./_lib/invites";
import { grantRole, requirePermission, requireRole } from "./_lib/permissions";
import { ensureDefaultSequences } from "./_lib/sequences";
import type { Id } from "./_generated/dataModel";

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
 *   6. a demo category tree + products (slug/SKU-keyed) — including one
 *      uncategorized and one archived product, so the Categories page shows
 *      real counts and the archived exclusion (CT-03).
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

    // 6. Demo catalog (CT-03) — keyed by slug/SKU so re-runs skip whatever
    //    already exists; seeded categories append after your own roots.
    const demoCategories = [
      { name: "Imaging & Diagnostics", slug: "imaging-diagnostics", parentSlug: null },
      {
        name: "Ultrasound Systems",
        slug: "ultrasound-systems",
        parentSlug: "imaging-diagnostics",
      },
      { name: "Patient Monitors", slug: "patient-monitors", parentSlug: "imaging-diagnostics" },
      { name: "Lab Equipment", slug: "lab-equipment", parentSlug: null },
      { name: "Centrifuges", slug: "centrifuges", parentSlug: "lab-equipment" },
    ] as const;
    const existingCategories = await ctx.db.query("categories").collect();
    const categoryBySlug = new Map(existingCategories.map((row) => [row.slug, row._id]));
    const nextPosition = new Map<string, number>();
    for (const category of existingCategories) {
      const key = category.parentId ?? "";
      nextPosition.set(key, Math.max(nextPosition.get(key) ?? 0, category.position + 1));
    }
    for (const category of demoCategories) {
      if (categoryBySlug.has(category.slug)) continue;
      const parentId =
        category.parentSlug === null ? undefined : categoryBySlug.get(category.parentSlug);
      const parentKey = parentId ?? "";
      const id = await ctx.db.insert("categories", {
        name: category.name,
        slug: category.slug,
        ...(parentId !== undefined ? { parentId } : {}),
        visible: true,
        position: nextPosition.get(parentKey) ?? 0,
        createdAt: now,
        updatedAt: now,
      });
      categoryBySlug.set(category.slug, id);
      nextPosition.set(parentKey, (nextPosition.get(parentKey) ?? 0) + 1);
      bump("categories");
    }

    // DEMO-… SKUs: 2 ultrasound (counted), monitor + archived legacy
    // (archived excluded from stats), centrifuges incl. a dual-category
    // kit, one uncategorized — exercises every bucket the page renders.
    const demoProducts = [
      {
        name: "Portable Ultrasound X5",
        slug: "demo-portable-ultrasound-x5",
        sku: "DEMO-1001",
        status: "active",
        cats: ["ultrasound-systems"],
      },
      {
        name: "Cart Ultrasound S3",
        slug: "demo-cart-ultrasound-s3",
        sku: "DEMO-1002",
        status: "active",
        cats: ["ultrasound-systems"],
      },
      {
        name: "Patient Monitor M7",
        slug: "demo-patient-monitor-m7",
        sku: "DEMO-1003",
        status: "active",
        cats: ["patient-monitors"],
      },
      {
        name: "Bench Centrifuge C2",
        slug: "demo-bench-centrifuge-c2",
        sku: "DEMO-1004",
        status: "draft",
        cats: ["centrifuges"],
      },
      {
        name: "Centrifuge Rotor Kit",
        slug: "demo-centrifuge-rotor-kit",
        sku: "DEMO-1005",
        status: "active",
        cats: ["centrifuges", "lab-equipment"],
      },
      {
        name: "Lab Bench Stand",
        slug: "demo-lab-bench-stand",
        sku: "DEMO-1006",
        status: "active",
        cats: [],
      },
      {
        name: "Legacy Patient Monitor",
        slug: "demo-legacy-patient-monitor",
        sku: "DEMO-1007",
        status: "archived",
        cats: ["patient-monitors"],
      },
    ] as const;
    const existingSkus = new Set((await ctx.db.query("products").collect()).map((row) => row.sku));
    for (const product of demoProducts) {
      if (existingSkus.has(product.sku)) continue;
      const categoryIds = product.cats
        .map((slug) => categoryBySlug.get(slug))
        .filter((id): id is Id<"categories"> => id !== undefined);
      await ctx.db.insert("products", {
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        status: product.status,
        categoryIds,
        createdAt: now,
        updatedAt: now,
      });
      bump("products");
    }

    // 7. Demo attributes (CT-03) — three definitions grouped into a set the
    //    ultrasound category inherits, so the Attributes page and
    //    `attributes:forCategory` have real content on a fresh seed.
    const demoDefinitions: {
      name: string;
      type: "text" | "number" | "select" | "multi_select" | "boolean" | "date";
      unit?: string;
      options?: string[];
    }[] = [
      { name: "Weight", type: "number", unit: "kg" },
      { name: "Color", type: "select", options: ["Black", "Silver"] },
      { name: "Dimensions", type: "text" },
    ];
    const definitionByName = new Map(
      (await ctx.db.query("attributeDefinitions").collect()).map((row) => [row.name, row._id]),
    );
    for (const definition of demoDefinitions) {
      if (definitionByName.has(definition.name)) continue;
      const id = await ctx.db.insert("attributeDefinitions", {
        name: definition.name,
        type: definition.type,
        unit: definition.unit,
        options: definition.options ?? [],
        createdAt: now,
        updatedAt: now,
      });
      definitionByName.set(definition.name, id);
      bump("attributeDefinitions");
    }
    const demoSetAttributes = (["Weight", "Color", "Dimensions"] as const)
      .map((name) => definitionByName.get(name))
      .filter((id): id is Id<"attributeDefinitions"> => id !== undefined);
    const demoSetExists = (await ctx.db.query("attributeSets").collect()).some(
      (row) => row.name === "Physical specs",
    );
    if (!demoSetExists) {
      const demoCategory = categoryBySlug.get("ultrasound-systems");
      await ctx.db.insert("attributeSets", {
        name: "Physical specs",
        attributeIds: demoSetAttributes,
        categoryIds: demoCategory === undefined ? [] : [demoCategory],
        createdAt: now,
        updatedAt: now,
      });
      bump("attributeSets");
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
