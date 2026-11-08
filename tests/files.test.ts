import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { setup } from "./setup";

/**
 * File storage (PH0-27 → PH1-13): Cloudinary registration
 * (`files.saveCloudinary`), the signed-upload handoff
 * (`files.generateCloudinarySignature`), delivery URLs (permanent stored
 * ones + legacy signed Convex URLs), remove (uploader-or-settings.edit,
 * audited, best-effort asset cleanup), avatar attach/detach rules, and
 * `users:me` resolving the uploaded photo over the provider one.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 * Env: `CLOUDINARY_URL` is stubbed with TEST credentials. Signatures are
 * re-derived from them with node's sha1 (the exact Cloudinary contract),
 * and the cleanup action's DELETE is asserted through a stubbed global
 * `fetch` — nothing ever touches the network.
 */

type T = ReturnType<typeof setup>;

const TEST_ENV = "cloudinary://testkey:testsecret@testcloud";
const OUR_URL = "https://res.cloudinary.com/testcloud/image/upload/v1762340000/products/ab12cd.png";
const PUBLIC_ID = "products/ab12cd";

const originalEnv = process.env.CLOUDINARY_URL;
beforeEach(() => {
  process.env.CLOUDINARY_URL = TEST_ENV;
});
afterEach(() => {
  if (originalEnv === undefined) delete process.env.CLOUDINARY_URL;
  else process.env.CLOUDINARY_URL = originalEnv;
  vi.unstubAllGlobals();
});

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

/** Register a (pretend) Cloudinary upload — saveCloudinary validates shape, not history. */
async function upload(
  t: T,
  userId: Awaited<ReturnType<typeof seedUser>>,
  overrides: Partial<{
    url: string;
    publicId: string;
    name: string;
    mimeType: string;
    size: number;
    kind: string;
    entityId: string;
  }> = {},
) {
  return await t
    .withIdentity({ subject: `${userId}|session-1` })
    .mutation(api.files.saveCloudinary, {
      url: overrides.url ?? OUR_URL,
      publicId: overrides.publicId ?? PUBLIC_ID,
      name: overrides.name ?? "photo.png",
      mimeType: overrides.mimeType ?? "image/png",
      size: overrides.size ?? 17,
      kind: overrides.kind ?? "avatar",
      entityId: overrides.entityId,
    });
}

const validArgs = {
  url: OUR_URL,
  publicId: PUBLIC_ID,
  name: "a.png",
  mimeType: "image/png",
  size: 10,
  kind: "avatar",
};

/** A pre-PH1-13 row: bytes in Convex storage, URL re-minted on read. */
async function insertLegacy(t: T, userId: Awaited<ReturnType<typeof seedUser>>) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["legacy-bytes"]));
    return {
      storageId,
      fileId: await ctx.db.insert("files", {
        storageId,
        name: "legacy.png",
        mimeType: "image/png",
        size: 11,
        kind: "avatar",
        uploadedBy: userId,
        createdAt: 1,
      }),
    };
  });
}

describe("upload registration + delivery URLs (PH0-27 → PH1-13)", () => {
  test("saveCloudinary registers the upload and returns its permanent delivery URL", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");
    const saved = await upload(t, user, { name: "Ada.png", kind: "logo" });

    expect(saved.fileId).toBeTruthy();
    expect(saved.url).toBe(OUR_URL);

    const rows = await t.run((ctx) => ctx.db.query("files").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cloudinaryPublicId: PUBLIC_ID,
      url: OUR_URL,
      name: "Ada.png",
      kind: "logo",
      uploadedBy: user,
    });
    // Cloudinary rows never carry the legacy storage id.
    expect(rows[0].storageId).toBeUndefined();

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "files",
      entityId: saved.fileId,
      actorLabel: "ada@example.com",
      after: { name: "Ada.png", kind: "logo", size: 17 },
    });
  });

  test("saveCloudinary rejects unauthenticated, foreign-URL, unconfigured, and bad-metadata calls", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");
    const asUser = t.withIdentity({ subject: `${user}|session-1` });

    await expect(t.mutation(api.files.saveCloudinary, { ...validArgs, name: "" })).rejects.toThrow(
      "Not authenticated",
    );

    await expect(
      asUser.mutation(api.files.saveCloudinary, { ...validArgs, size: 0 }),
    ).rejects.toThrow("between 1 byte and 25 MB");
    await expect(
      asUser.mutation(api.files.saveCloudinary, { ...validArgs, name: "" }),
    ).rejects.toThrow("between 1 and 255");
    await expect(
      asUser.mutation(api.files.saveCloudinary, { ...validArgs, mimeType: "" }),
    ).rejects.toThrow("type is missing");
    // The registration must point at OUR cloud — not an arbitrary remote URL.
    await expect(
      asUser.mutation(api.files.saveCloudinary, {
        ...validArgs,
        url: "https://res.cloudinary.com/othercloud/image/upload/x.png",
      }),
    ).rejects.toThrow("didn't upload to this app's storage");

    // Not configured on the deployment → verbatim, nothing stored.
    delete process.env.CLOUDINARY_URL;
    await expect(asUser.mutation(api.files.saveCloudinary, validArgs)).rejects.toThrow(
      "Image storage is not configured.",
    );

    expect(await t.run((ctx) => ctx.db.query("files").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0);
  });

  test("generateCloudinarySignature needs a session and signs only with the server secret", async () => {
    const t = setup();
    await expect(t.action(api.files.generateCloudinarySignature, {})).rejects.toThrow(
      "Not authenticated",
    );

    const user = await seedUser(t, "ada@example.com");
    const sig = await t
      .withIdentity({ subject: `${user}|session-1` })
      .action(api.files.generateCloudinarySignature, {});

    expect(sig.cloudName).toBe("testcloud");
    expect(sig.apiKey).toBe("testkey"); // public
    expect(sig.uploadUrl).toBe("https://api.cloudinary.com/v1_1/testcloud/image/upload");
    expect(sig.folder).toBe("chris-erp");
    // Cloudinary's contract: sha1(sorted params + api secret). The secret
    // itself never travels — only this digest does.
    const expected = createHash("sha1")
      .update(`folder=${sig.folder}&timestamp=${sig.timestamp}` + "testsecret")
      .digest("hex");
    expect(sig.signature).toBe(expected);
  });

  test("getUrl returns the stored URL (session required); legacy rows re-mint signed ones", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");
    const saved = await upload(t, user);

    await expect(t.query(api.files.getUrl, { fileId: saved.fileId })).rejects.toThrow(
      "Not authenticated",
    );

    const asUser = t.withIdentity({ subject: `${user}|session-1` });
    expect(await asUser.query(api.files.getUrl, { fileId: saved.fileId })).toBe(OUR_URL);

    const legacy = await insertLegacy(t, user);
    const legacyUrl = await asUser.query(api.files.getUrl, { fileId: legacy.fileId });
    expect(legacyUrl).toMatch(/^https:\/\//);
    expect(legacyUrl).not.toBe(OUR_URL);
  });

  test("urls batches delivery URLs in order (missing rows → null)", async () => {
    const t = setup();
    const user = await seedUser(t, "ada@example.com");
    const first = await upload(t, user, { publicId: "products/first" });
    const second = await upload(t, user, { publicId: "products/second" });
    const asUser = t.withIdentity({ subject: `${user}|session-1` });

    await expect(t.query(api.files.urls, { fileIds: [first.fileId] })).rejects.toThrow(
      "Not authenticated",
    );

    // A row that vanished between pick and render resolves to null, not an error.
    await t.run((ctx) => ctx.db.delete(first.fileId));
    expect(await asUser.query(api.files.urls, { fileIds: [first.fileId, second.fileId] })).toEqual([
      { fileId: first.fileId, url: null },
      { fileId: second.fileId, url: OUR_URL },
    ]);
  });
});

describe("file removal (PH0-27 → PH1-13)", () => {
  test("uploader deletes the row (audited), then best-effort Cloudinary cleanup", async () => {
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

    // The uploader can always delete their own file. The ROW goes first;
    // asset cleanup is scheduled (mutations can't fetch) and asserted
    // through a stubbed global fetch — no network in tests.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const asAda = t.withIdentity({ subject: `${ada}|session-1` });
    await asAda.mutation(api.files.remove, { fileId: saved.fileId });
    expect(await t.run((ctx) => ctx.db.query("files").collect())).toHaveLength(0);

    await t.finishAllScheduledFunctions(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit).toEqual({ method: "DELETE" });
    const parsed = new URL(requestUrl);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://api.cloudinary.com/v1_1/testcloud/resources/image/upload",
    );
    expect(parsed.searchParams.get("public_id")).toBe(PUBLIC_ID);
    expect(parsed.searchParams.get("api_key")).toBe("testkey");
    // The DELETE is signed the same way uploads are — server secret only.
    const expected = createHash("sha1")
      .update(
        `public_id=${PUBLIC_ID}&timestamp=${parsed.searchParams.get("timestamp")}` + "testsecret",
      )
      .digest("hex");
    expect(parsed.searchParams.get("signature")).toBe(expected);

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    // saveCloudinary's create + remove's delete.
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

  test("legacy Convex-storage rows still delete their bytes (no Cloudinary call)", async () => {
    const t = setup();
    const ada = await seedUser(t, "ada@example.com");
    const legacy = await insertLegacy(t, ada);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const asAda = t.withIdentity({ subject: `${ada}|session-1` });
    await asAda.mutation(api.files.remove, { fileId: legacy.fileId });

    expect(await t.run((ctx) => ctx.db.get(legacy.fileId))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.get(legacy.storageId))).toBeNull();

    await t.finishAllScheduledFunctions(() => {});
    expect(fetchMock).not.toHaveBeenCalled();
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
    // Uploaded photo wins over the provider image (permanent Cloudinary URL).
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
