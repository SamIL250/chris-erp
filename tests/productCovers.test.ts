import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/** Cover URLs for product mentions outside the catalog table. */

type T = ReturnType<typeof setup>;

async function asOwner(t: T) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      email: "owner@example.com",
      status: "active" as const,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await t.run(async (ctx) => {
    const roleId = await ctx.db.insert("roles", { key: "owner", name: "Owner", createdAt: 1 });
    await ctx.db.insert("userRoles", { userId, roleId, createdAt: 1 });
  });
  return t.withIdentity({ subject: `${userId}|session-1` });
}

describe("product covers", () => {
  test("returns the cover url and null when a product has no image", async () => {
    const t = setup();
    const owner = await asOwner(t);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "files@example.com",
        status: "active" as const,
        createdAt: 1,
        updatedAt: 1,
      });
      const fileId = await ctx.db.insert("files", {
        url: "https://res.cloudinary.com/demo/image/upload/cover.jpg",
        cloudinaryPublicId: "cover",
        name: "cover.jpg",
        mimeType: "image/jpeg",
        size: 10,
        kind: "productImage",
        uploadedBy: userId,
        createdAt: 1,
      });
      const withCover = await ctx.db.insert("products", {
        name: "With cover",
        slug: "with-cover",
        sku: "COV-1",
        status: "active" as const,
        categoryIds: [] as Id<"categories">[],
        images: [{ fileId }],
        createdAt: 1,
        updatedAt: 1,
      });
      const bare = await ctx.db.insert("products", {
        name: "Bare",
        slug: "bare",
        sku: "COV-2",
        status: "active" as const,
        categoryIds: [] as Id<"categories">[],
        createdAt: 1,
        updatedAt: 1,
      });
      return { withCover, bare };
    });

    const covers = await owner.query(api.catalog.products.covers, {
      productIds: [ids.withCover, ids.bare, ids.withCover],
    });
    expect(covers).toEqual([
      { productId: ids.withCover, url: "https://res.cloudinary.com/demo/image/upload/cover.jpg" },
      { productId: ids.bare, url: null },
    ]);
    const picked = await owner.query(api.catalog.products.picker, { search: "COV-1" });
    expect(picked[0]?.coverUrl).toBe("https://res.cloudinary.com/demo/image/upload/cover.jpg");
  });
});
