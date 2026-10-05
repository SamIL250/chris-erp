import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * PH0-35 — the sweep docs/permissions.md rules 1–2 promise.
 *
 * Mechanically enforces, for every exported mutation in `convex/*.ts`:
 *
 * 1. Rule 1: an identity/permission gate — `requirePermission`, `requireRole`,
 *    `getAuthUserId`, or a local `require*` helper that itself checks
 *    identity (e.g. notifications' `requireSession`) — appears somewhere in
 *    the handler (self-scoped actions gate on identity alone by design).
 * 2. Rule 2: anything that writes table rows (`ctx.db.insert|patch|delete`)
 *    is registered through `auditedMutation`, unless listed in
 *    AUDIT_EXEMPT with a reason. Entries that no longer match a mutation
 *    fail the test too, so the allowlist can't go stale.
 *
 * A new mutation that skips both gates fails CI here — this is the
 * "mutation helper coverage for future code".
 */

const CONVEX_DIR = join(fileURLToPath(new URL("..", import.meta.url)), "convex");

/** Recurse domain folders (PH1+ `convex/catalog/…`), skipping `_…` helpers. */
function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue; // _generated, _lib
      files.push(...listSourceFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

/**
 * Mutations that write rows WITHOUT an audit entry, by design. Every key
 * must match an existing mutation (stale entries fail the sweep).
 */
const AUDIT_EXEMPT: Record<string, string> = {
  "notifications:markRead": "read-state is not a business fact (PH0-28)",
  "notifications:markAllRead": "read-state is not a business fact (PH0-28)",
};

interface MutationInfo {
  /** `module:name`, e.g. `currencies:createRate`. */
  id: string;
  isAudited: boolean;
  hasWrite: boolean;
  hasGate: boolean;
}

function collectMutations(): MutationInfo[] {
  const files = listSourceFiles(CONVEX_DIR).sort();
  const mutations: MutationInfo[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const moduleName = file.slice(CONVEX_DIR.length + 1).replace(/\.ts$/, "");
    // Each exported mutation starts a new top-level chunk.
    for (const chunk of source.split(/(?=\nexport const )/)) {
      const match = chunk.match(/export const (\w+) = (auditedMutation|mutation)\(\{/);
      if (match === null) continue;
      const [, name, kind] = match;
      mutations.push({
        id: `${moduleName}:${name}`,
        isAudited: kind === "auditedMutation",
        hasWrite: /ctx\.db\.(insert|patch|delete)\(/.test(chunk),
        hasGate: /\brequire[A-Z]\w*\(|getAuthUserId\(/.test(chunk),
      });
    }
  }
  return mutations;
}

describe("mutation sweep (PH0-35)", () => {
  const mutations = collectMutations();

  test("scan finds the mutation modules", () => {
    // Sanity: if this fails the scan itself broke and would silently
    // "pass" every other assertion below.
    expect(mutations.length).toBeGreaterThanOrEqual(15);
    expect(mutations.map((m) => m.id)).toContain("seed:seed");
    expect(mutations.map((m) => m.id)).toContain("tax:createRate");
    // Domain-folder mutations (PH1+) must be swept too — recursion check.
    expect(mutations.map((m) => m.id)).toContain("catalog/categories:create");
  });

  test("every mutation gates identity/permission (rule 1)", () => {
    const ungated = mutations.filter((mutation) => !mutation.hasGate).map((m) => m.id);
    expect(
      ungated,
      `${ungated.join(", ")} must call requirePermission/requireRole/getAuthUserId ` +
        `(or a local require* identity helper) — docs/permissions.md rule 1`,
    ).toEqual([]);
  });

  test("every writing mutation is audited or explicitly exempt (rule 2)", () => {
    const unaudited = mutations
      .filter((mutation) => mutation.hasWrite && !mutation.isAudited)
      .map((mutation) => mutation.id)
      .filter((id) => !(id in AUDIT_EXEMPT));
    expect(
      unaudited,
      `${unaudited.join(", ")} writes table rows — register it with auditedMutation ` +
        `(docs/permissions.md rule 2) or add an AUDIT_EXEMPT entry with a reason`,
    ).toEqual([]);
  });

  test("the AUDIT_EXEMPT allowlist stays truthful", () => {
    const byId = new Map(mutations.map((mutation) => [mutation.id, mutation]));
    const stale = Object.keys(AUDIT_EXEMPT).filter((id) => !byId.has(id));
    expect(stale, `remove stale AUDIT_EXEMPT entries: ${stale.join(", ")}`).toEqual([]);
    for (const [id, reason] of Object.entries(AUDIT_EXEMPT)) {
      expect(reason.length, `AUDIT_EXEMPT[${id}] needs a reason`).toBeGreaterThan(10);
      // The exemption must still be needed — auditing got added later.
      expect(
        byId.get(id)?.isAudited,
        `${id} is audited now — drop its AUDIT_EXEMPT entry`,
      ).toBeFalsy();
    }
  });
});
