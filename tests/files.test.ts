import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { setup } from "./setup";

/**
 * File storage (PH0-27): saveFile registration + validation, signed read
 * URLs, remove (uploader-or-settings.edit, audited), avatar attach/detach
 * rules, and `users:me` resolving the uploaded photo over the provider one.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

async function seedUser(t: T, email: string, image?: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      ...(image !== undefined ? { image } : {}),
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function grant(t: T, userId: Awaited<ReturnType<typeof seedUser>>, roleKey: string) {
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

async function upload(
  t: T,
  userId: Awaited<ReturnType<typeof seedUser>>,
  overrides: Partial<{
    name: string;
    mimeType: string;
    size: number;
    kind: string;
    entityId: string;
  }> = {},
) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["fake-image-bytes"])));
  const saved = await t
    .withIdentity({ subject: `${userId}|session-1` })
    .mutation(api.files.saveFile, {
      storageId,
      name: overrides.name ?? "photo.png",
      mimeType: overrides.mimeType ?? "image/png",
      size: overrides.size ?? 17,
      kind: overrides.kind ?? "avatar",
      entityId: overrides.entityId,
    });
  return { storageId, ...saved };
}

const saveArgs = (storageId: Awaited<ReturnType<typeof upload>>["storageId"]) => ({
  storageId,
  name: "a.png",
  mimeType: "image/png",
  size: 10,
  kind: "avatar",
});

describe("file upload + signed URLs (PH0-27)", () => {
  test("saveFile registers the blob and returns a signed read URL", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");
    const saved = await upload(t, user, { name: "Ada.png", kind: "logo" });

    expect(saved.fileId).toBeTruthy();
    expect(saved.url).toMatch(/^https:\/\//);

    const rows = await t.run((ctx) => ctx.db.query("files").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storageId: saved.storageId,
      name: "Ada.png",
      kind: "logo",
      uploadedBy: user,
    });

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "files",
      entityId: saved.fileId,
      actorLabel: "ada@example.com",
      after: { name: "Ada.png", kind: "logo" },
    });
  });

  test("saveFile rejects unauthenticated calls, unknown blobs, and bad metadata", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await t.run((ctx) => ctx.storage.delete(storageId));

    await expect(
      t.mutation(api.files.saveFile, { ...saveArgs(storageId), name: "" }),
    ).rejects.toThrow("Not authenticated");

    const asUser = t.withIdentity({ subject: `${user}|session-1` });
    // The blob was deleted → its id no longer resolves.
    await expect(asUser.mutation(api.files.saveFile, saveArgs(storageId))).rejects.toThrow(
      "no longer available",
    );

    const fresh = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await expect(
      asUser.mutation(api.files.saveFile, { ...saveArgs(fresh), size: 0 }),
    ).rejects.toThrow("between 1 byte and 25 MB");
    await expect(
      asUser.mutation(api.files.saveFile, { ...saveArgs(fresh), name: "" }),
    ).rejects.toThrow("between 1 and 255");
    await expect(
      asUser.mutation(api.files.saveFile, { ...saveArgs(fresh), mimeType: "" }),
    ).rejects.toThrow("type is missing");

    expect(await t.run((ctx) => ctx.db.query("files").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0);
  });

  test("getUrl re-resolves a file's signed URL (and needs a session)", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");
    const saved = await upload(t, user);

    await expect(t.query(api.files.getUrl, { fileId: saved.fileId })).rejects.toThrow(
      "Not authenticated",
    );

    const asUser = t.withIdentity({ subject: `${user}|session-1` });
    expect(await asUser.query(api.files.getUrl, { fileId: saved.fileId })).toBe(saved.url);
  });

  test("generateUploadUrl needs a session", async () => {
    const t = setup();
    await expect(t.mutation(api.files.generateUploadUrl, {})).rejects.toThrow("Not authenticated");

    const user = await seedUser(t, "ada@example.com");
    const url = await t
      .withIdentity({ subject: `${user}|session-1` })
      .mutation(api.files.generateUploadUrl, {});
    expect(url).toMatch(/^https?:\/\//);
  });
});

describe("file removal (PH0-27)", () => {
  test("uploader deletes bytes + row; others need settings.edit (and it's audited)", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const ada = await seedUser(t, "ada@example.com");
    const sales = await seedUser(t, "sales@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    const saved = await upload(t, ada);

    // Someone else's file, no settings.edit → refused.
    const asSales = t.withIdentity({ subject: `${sales}|session-1` });
    await expect(asSales.mutation(api.files.remove, { fileId: saved.fileId })).rejects.toThrow(
      "You don't have permission to edit settings items.",
    );
    expect(await t.run((ctx) => ctx.db.query("files").collect())).toHaveLength(1);

    // The uploader can always delete their own file.
    const asAda = t.withIdentity({ subject: `${ada}|session-1` });
    await asAda.mutation(api.files.remove, { fileId: saved.fileId });

    expect(await t.run((ctx) => ctx.db.query("files").collect())).toHaveLength(0);
    const blob = await t.run((ctx) => ctx.storage.get(saved.storageId));
    expect(blob).toBeNull();

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    // saveFile's create + remove's delete.
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({
      action: "delete",
      entity: "files",
      entityId: saved.fileId,
      actorLabel: "ada@example.com",
      before: { name: "photo.png", kind: "avatar" },
    });

    // Gone for good.
    await expect(asAda.mutation(api.files.remove, { fileId: saved.fileId })).rejects.toThrow(
      "no longer exists",
    );
  });
});

describe("avatar attach + resolution (PH0-27)", () => {
  test("setAvatar: own avatar file only, audited, clearable", async () => {
    const t = setup();
    const ada = await seedUser(t, "ada@example.com");
    const other = await seedUser(t, "other@example.com");
    const asAda = t.withIdentity({ subject: `${ada}|session-1` });

    const own = await upload(t, ada, { kind: "avatar" });
    const foreign = await upload(t, other, { kind: "avatar" });
    const wrongKind = await upload(t, ada, { kind: "productImage" });

    await expect(asAda.mutation(api.users.setAvatar, { fileId: foreign.fileId })).rejects.toThrow(
      "isn't yours",
    );
    await expect(asAda.mutation(api.users.setAvatar, { fileId: wrongKind.fileId })).rejects.toThrow(
      "as a profile photo",
    );

    await asAda.mutation(api.users.setAvatar, { fileId: own.fileId });
    let me = await asAda.query(api.users.me, {});
    expect(me?.avatarFileId).toBe(own.fileId);
    // Uploaded photo wins over the provider image.
    expect(me?.image).toBe(own.url);

    // Clearing falls back to whatever the provider gave us.
    await asAda.mutation(api.users.setAvatar, { fileId: null });
    me = await asAda.query(api.users.me, {});
    expect(me?.avatarFileId).toBeUndefined();
    expect(me?.image).toBeUndefined();

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((row) => row.action)).toEqual([
      "create",
      "create",
      "create",
      "update",
      "update",
    ]);
    expect(audit[3]).toMatchObject({
      entity: "users",
      entityId: ada,
      before: { avatar: null },
      after: { avatar: own.fileId },
    });
    expect(audit[4].after).toEqual({ avatar: null });
  });

  test("me: a deleted avatar file falls back to the provider image", async () => {
    const t = setup();
    const ada = await seedUser(t, "ada@example.com", "https://example.com/ada.png");
    const saved = await upload(t, ada);

    const asAda = t.withIdentity({ subject: `${ada}|session-1` });
    await asAda.mutation(api.users.setAvatar, { fileId: saved.fileId });
    expect((await asAda.query(api.users.me, {}))?.image).toBe(saved.url);

    // File vanishes (cleaned up elsewhere) → provider image comes back.
    await t.run((ctx) => ctx.db.delete(saved.fileId));
    expect((await asAda.query(api.users.me, {}))?.image).toBe("https://example.com/ada.png");
  });

  test("me: null when unauthenticated (no storage reads)", async () => {
    const t = setup();
    expect(await t.query(api.users.me, {})).toBeNull();
  });
});
