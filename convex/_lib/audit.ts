import { getAuthUserId } from "@convex-dev/auth/server";
import type { DataModelFromSchemaDefinition } from "convex/server";
import {
  mutationGeneric,
  type ArgsArrayForOptionalValidator,
  type ArgsArrayToObject,
  type DefaultArgsForOptionalValidator,
  type GenericMutationCtx,
  type RegisteredMutation,
} from "convex/server";
import type { PropertyValidators } from "convex/values";
import type schema from "../schema";

/**
 * Audit trail (PH0-26). docs/permissions.md rule 2: mutations call
 * `requirePermission` FIRST and record their effect LAST — the wrapper below
 * does exactly that ordering: handler runs (throws ⇒ no entry), then the
 * returned snapshot pair is appended.
 *
 * The `auditLog` table is append-only: this module only ever inserts, and no
 * other code touches the table (corrections are new entries).
 */

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;

/** Payload an audited handler returns alongside its result. */
export type AuditInput = {
  /** The affected document's id (string — the table varies). */
  entityId: string;
  /** Snapshot before the change (omit for creates). */
  before?: unknown;
  /** Snapshot after the change (omit for deletes). */
  after?: unknown;
};

/** Key pattern whose values never belong in an audit snapshot. */
const SECRET_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|hash|credential|api[-_]?key|private|\bcode\b)/i;
export const REDACTED = "[redacted]";

/** Deep-copy a snapshot, replacing credential-shaped keys with `[redacted]`. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return copy;
}

/**
 * Append one audit entry, resolving the actor from the request. Use directly
 * from mutations that don't fit `auditedMutation`.
 */
export async function appendAudit(
  ctx: MutationCtx,
  entry: { entity: string; action: string } & AuditInput,
): Promise<void> {
  const actorId = await getAuthUserId(ctx);
  const actor = actorId !== null ? await ctx.db.get(actorId) : null;
  await ctx.db.insert("auditLog", {
    actorId: actorId ?? undefined,
    actorLabel:
      actor !== null ? (actor.email ?? actor.phone ?? actor.name ?? "Unknown user") : "system",
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before === undefined ? undefined : redact(entry.before),
    after: entry.after === undefined ? undefined : redact(entry.after),
    createdAt: Date.now(),
  });
}

/**
 * Generic mutation wrapper (PH0-26): a drop-in for `mutation()` whose handler
 * returns `{ result, audit }` instead of a bare result. After the handler
 * succeeds the audit entry is appended (actor auto-resolved, snapshots
 * redacted) — a thrown handler records nothing.
 *
 * ```ts
 * export const doThing = auditedMutation({
 *   entity: "products",
 *   action: "update",
 *   args: { id: v.id("products") },
 *   handler: async (ctx, args) => ({
 *     result: { ok: true },
 *     audit: { entityId: args.id, before, after },
 *   }),
 * });
 * ```
 */
export function auditedMutation<
  ArgsValidator extends PropertyValidators | void,
  ReturnValue,
  OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
    DefaultArgsForOptionalValidator<ArgsValidator>,
>(spec: {
  entity: string;
  action: string;
  args?: ArgsValidator;
  // `returns` validators aren't wrapped yet — add via mutationGeneric if needed.
  // Single-validator `args` (not an object map) isn't wrapped either.
  handler: (
    ctx: MutationCtx,
    ...args: OneOrZeroArgs
  ) => Promise<{ result: ReturnValue; audit?: AuditInput }>;
}): RegisteredMutation<"public", ArgsArrayToObject<OneOrZeroArgs>, ReturnValue> {
  return mutationGeneric({
    args: spec.args,
    handler: async (ctx: GenericMutationCtx<DataModel>, ...args: OneOrZeroArgs) => {
      const outcome = await spec.handler(ctx, ...args);
      if (outcome.audit !== undefined) {
        await appendAudit(ctx, {
          entity: spec.entity,
          action: spec.action,
          ...outcome.audit,
        });
      }
      return outcome.result;
    },
  }) as unknown as RegisteredMutation<"public", ArgsArrayToObject<OneOrZeroArgs>, ReturnValue>;
}
