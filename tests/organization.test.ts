import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Company settings (PH0-29): session-gated reads, settings.edit-gated full-
 * form saves (audited, create-once), logo attachment rules, and clearing
 * semantics (omitted optional fields are removed).
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function grant(t: T, userId: Id<"users">, roleKey: string) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_key", (q) => q.eq("key", roleKey))
      .unique();
    const roleId =
      existing !== null
        ? existing._id
        : await ctx.db.insert("roles", { key: roleKey, name: roleKey, createdAt: Date.now() });
    await ctx.db.insert("userRoles", { userId, roleId, createdAt: Date.now() });
  });
}

/** A full-form save with every optional blank except `name`. */
const form = (name: string) => ({
  name,
  legalName: undefined,
  taxId: undefined,
  email: undefined,
  phone: undefined,
  address: undefined,
  invoiceFooter: undefined,
  logoFileId: null,
});

describe("organization:get (PH0-29)", () => {
  test("needs a session; null before the first save", async () => {
    const t = setup();
    await expect(t.query(api.organization.get, {})).rejects.toThrow("Not authenticated");

    const owner = await seedUser(t, "owner@example.com");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    expect(await asOwner.query(api.organization.get, {})).toBeNull();
  });
});

describe("organization:update (PH0-29)", () => {
  test("settings.edit required — Sales and Accountant are refused", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, accountant, "accountant");

    await expect(t.mutation(api.organization.update, form("X"))).rejects.toThrow(
      "Not authenticated",
    );
    const denied = "You don't have permission to edit settings items.";
    await expect(
      t
        .withIdentity({ subject: `${sales}|session-1` })
        .mutation(api.organization.update, form("X")),
    ).rejects.toThrow(denied);
    // Accountant can VIEW settings but not edit them.
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.organization.update, form("X")),
    ).rejects.toThrow(denied);
    expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0);
  });

  test("first save creates, later saves patch — with before/after audit", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    await grant(t, owner, "owner");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    await asOwner.mutation(api.organization.update, {
      ...form("Chris Trading Ltd"),
      legalName: "Chris Trading Limited",
      taxId: "GB123456789",
      email: "billing@chris.example",
      address: { line1: "1 High Street", city: "London", country: "UK" },
      invoiceFooter: "Payment due in 30 days.",
    });

    const created = await t.run((ctx) => ctx.db.query("organizations").collect());
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: "Chris Trading Ltd",
      legalName: "Chris Trading Limited",
      taxId: "GB123456789",
      email: "billing@chris.example",
      address: { line1: "1 High Street", city: "London", country: "UK" },
      invoiceFooter: "Payment due in 30 days.",
      baseCurrency: "USD",
      active: true,
    });

    // Full-form save with blanks clears them; the row is reused, not duplicated.
    await asOwner.mutation(api.organization.update, form("Chris Trading"));
    const after = await t.run((ctx) => ctx.db.query("organizations").collect());
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("Chris Trading");
    expect(after[0].legalName).toBeUndefined();
    expect(after[0].address).toBeUndefined();
    expect(after[0].invoiceFooter).toBeUndefined();

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      action: "update",
      entity: "organizations",
      actorLabel: "owner@example.com",
      after: { name: "Chris Trading Ltd", taxId: "GB123456789" },
    });
    expect(audit[0].before).toBeUndefined(); // create
    expect(audit[1].before).toMatchObject({ name: "Chris Trading Ltd" });
    expect(audit[1].after).toMatchObject({ name: "Chris Trading" });
  });

  test("validates name, email, footer length, and logo files", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    await grant(t, owner, "owner");
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });

    await expect(asOwner.mutation(api.organization.update, form(""))).rejects.toThrow(
      "between 1 and 200",
    );
    await expect(
      asOwner.mutation(api.organization.update, { ...form("X"), email: "not-an-email" }),
    ).rejects.toThrow("valid contact email");
    await expect(
      asOwner.mutation(api.organization.update, { ...form("X"), invoiceFooter: "x".repeat(2001) }),
    ).rejects.toThrow("under 2000");

    // Logo: must exist and be kind "logo".
    const wrongKind = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    const wrongKindFile = await asOwner.mutation(api.files.saveFile, {
      storageId: wrongKind,
      name: "a.png",
      mimeType: "image/png",
      size: 1,
      kind: "avatar",
    });
    await expect(
      asOwner.mutation(api.organization.update, { ...form("X"), logoFileId: wrongKindFile.fileId }),
    ).rejects.toThrow("as a logo");

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["logo"])));
    const logoFile = await asOwner.mutation(api.files.saveFile, {
      storageId,
      name: "logo.png",
      mimeType: "image/png",
      size: 4,
      kind: "logo",
    });
    await asOwner.mutation(api.organization.update, {
      ...form("X"),
      logoFileId: logoFile.fileId,
    });

    const org = await asOwner.query(api.organization.get, {});
    expect(org?.logoFileId).toBe(logoFile.fileId);
    expect(org?.logoUrl).toBe(logoFile.url);

    expect(await t.run((ctx) => ctx.db.query("organizations").collect())).toHaveLength(1);
  });
});
