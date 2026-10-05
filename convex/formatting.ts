import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { auditedMutation } from "./_lib/audit";
import { requirePermission } from "./_lib/permissions";
import { query, type QueryCtx } from "./_generated/server";

/**
 * Date/number formatting preferences (PH0-33): one global `settings` row
 * under key "formatting" — {locale, timezone} that every renderer reads
 * (documents must print dates in the COMPANY's timezone, not the viewer's),
 * so reads need a session like `organization:get`, and edits need
 * settings.edit. The locale also drives number formatting (decimal mark,
 * grouping) — one preference, both formats. Validated with Intl on both
 * ends.
 */

const KEY = "formatting";

export interface FormattingPreferences {
  locale: string | null;
  timezone: string | null;
}

async function readValue(ctx: QueryCtx): Promise<FormattingPreferences> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", KEY))
    .unique();
  const value: unknown = row?.value;
  if (value === null || typeof value !== "object") return { locale: null, timezone: null };
  const record = value as Record<string, unknown>;
  return {
    locale: typeof record.locale === "string" ? record.locale : null,
    timezone: typeof record.timezone === "string" ? record.timezone : null,
  };
}

function validateLocale(locale: string) {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? null;
  } catch {
    throw new ConvexError(`Unknown locale "${locale}" — pick one from the list.`);
  }
}

function validateTimezone(timezone: string) {
  try {
    // Throws RangeError for anything the runtime doesn't know.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    throw new ConvexError(`Unknown timezone "${timezone}" — pick one from the list.`);
  }
}

/** Stored preferences (nulls = app/browser defaults). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    if ((await getAuthUserId(ctx)) === null) {
      throw new ConvexError("Not authenticated");
    }
    return await readValue(ctx);
  },
});

export const update = auditedMutation({
  entity: "settings",
  action: "update",
  args: { locale: v.string(), timezone: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requirePermission(ctx, "settings", "edit");
    const locale = validateLocale(args.locale.trim());
    const timezone = validateTimezone(args.timezone.trim());
    if (locale === null || timezone === null) {
      throw new ConvexError("Locale and timezone are both required.");
    }

    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .unique();
    const before = row === null ? undefined : await readValue(ctx);
    const after = { locale, timezone };

    if (before !== undefined && before.locale === locale && before.timezone === timezone) {
      return { result: undefined, audit: undefined };
    }

    const value = { locale, timezone };
    const now = Date.now();
    if (row === null) {
      await ctx.db.insert("settings", { key: KEY, value, updatedBy: actorId, updatedAt: now });
    } else {
      await ctx.db.patch(row._id, { value, updatedBy: actorId, updatedAt: now });
    }
    return {
      result: undefined,
      audit: { entityId: KEY, ...(before !== undefined ? { before } : {}), after },
    };
  },
});
