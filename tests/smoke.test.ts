import { describe, expect, test } from "vitest";
import { setup } from "./setup";

describe("convex-test harness", () => {
  test("schema accepts foundation tables and reads documents back", async () => {
    const t = setup();

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Chris Trading Ltd",
        baseCurrency: "USD",
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const user = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        email: "owner@example.com",
        name: "Owner",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const org = await t.run((ctx) => ctx.db.get(orgId));
    const profile = await t.run((ctx) => ctx.db.get(user));

    expect(org?.name).toBe("Chris Trading Ltd");
    expect(profile?.status).toBe("active");

    // Index lookup works (by_email)
    const found = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", "owner@example.com"))
        .unique(),
    );
    expect(found?._id).toBe(user);
  });
});
