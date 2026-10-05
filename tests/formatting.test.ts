import { describe, expect, test } from "vitest";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Date/number formatting preferences (PH0-33): session-gated read with null
 * defaults, settings.edit-gated global upsert under key "formatting",
 * Intl-validated locale/timezone, audited.
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

describe("formatting:get (PH0-33)", () => {
  test("session-gated, null defaults until saved", async () => {
    const t = setup();
    await expect(t.query(api.formatting.get, {})).rejects.toThrow("Not authenticated");

    const user = await seedUser(t, "ada@example.com");
    const asAda = t.withIdentity({ subject: `${user}|session-1` });
    expect(await asAda.query(api.formatting.get, {})).toEqual({ locale: null, timezone: null });
  });
});

describe("formatting:update (PH0-33)", () => {
  test("settings.edit, Intl-validated, single upsert row, audited", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to edit settings items.";
    await expect(
      t.mutation(api.formatting.update, { locale: "en-US", timezone: "UTC" }),
    ).rejects.toThrow("Not authenticated");
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.formatting.update, { locale: "en-US", timezone: "UTC" }),
    ).rejects.toThrow(denied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await expect(
      asOwner.mutation(api.formatting.update, { locale: "not a locale!", timezone: "UTC" }),
    ).rejects.toThrow('Unknown locale "not a locale!"');
    await expect(
      asOwner.mutation(api.formatting.update, { locale: "en-US", timezone: "Mars/Olympus" }),
    ).rejects.toThrow('Unknown timezone "Mars/Olympus"');
    expect(await t.run((ctx) => ctx.db.query("settings").collect())).toHaveLength(0);

    // Canonicalization: input is normalized (e.g. case/prefix handling).
    await asOwner.mutation(api.formatting.update, { locale: "de-DE", timezone: "Europe/Berlin" });
    expect(await asAdaPrefs(t, owner)).toEqual({ locale: "de-DE", timezone: "Europe/Berlin" });

    let settings = await t.run((ctx) => ctx.db.query("settings").collect());
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ key: "formatting", updatedBy: owner });

    let audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "update",
      entity: "settings",
      entityId: "formatting",
      actorLabel: "owner@example.com",
      after: { locale: "de-DE", timezone: "Europe/Berlin" },
    });
    expect(audit[0].before).toBeUndefined();

    // Second save: same row patched, before populated.
    await asOwner.mutation(api.formatting.update, { locale: "en-GB", timezone: "UTC" });
    settings = await t.run((ctx) => ctx.db.query("settings").collect());
    expect(settings).toHaveLength(1);
    expect(settings[0].value).toEqual({ locale: "en-GB", timezone: "UTC" });

    audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(2);
    expect(audit[1].before).toEqual({ locale: "de-DE", timezone: "Europe/Berlin" });

    // Saving the same values records nothing.
    await asOwner.mutation(api.formatting.update, { locale: "en-GB", timezone: "UTC" });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(2);
  });
});

async function asAdaPrefs(t: T, userId: Id<"users">) {
  return await t.withIdentity({ subject: `${userId}|session-1` }).query(api.formatting.get, {});
}

describe("lib/format helpers (PH0-33)", () => {
  test("respects locale + timezone preferences", () => {
    const sample = new Date("2026-10-05T23:30:00Z");
    const berlin = { locale: "de-DE", timezone: "Europe/Berlin" };
    const utc = { locale: "en-US", timezone: "UTC" };

    // 23:30 UTC is next day in Berlin (UTC+2 in October).
    expect(formatDateTime(sample, berlin)).toContain("06.10.2026");
    expect(formatDateTime(sample, utc)).toContain("Oct 5");
    expect(formatDateTime(sample, utc)).toContain("11:30 PM");

    expect(formatNumber(1234567.89, { locale: "de-DE", timezone: null })).toBe("1.234.567,89");
    expect(formatNumber(1234567.89, { locale: "en-US", timezone: null })).toBe("1,234,567.89");

    expect(formatPercent(0.195, { locale: "en-US", timezone: null })).toBe("19.5%");
    // Nulls fall back to the runtime/browser defaults without throwing.
    expect(formatNumber(1234.5, { locale: null, timezone: null })).toContain("1");
  });
});
