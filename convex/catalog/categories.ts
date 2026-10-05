import { ConvexError, v } from "convex/values";
import { slugify } from "../../lib/slug";
import { auditedMutation } from "../_lib/audit";
import { requirePermission } from "../_lib/permissions";
import { query, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Category tree (PH1-01 → PH1-02): adjacency-list CRUD with global slug
 * uniqueness, manual sibling ordering, and safe move/reparent rules.
 *
 * Rules enforced HERE (never only in UI — docs/permissions.md rule 1):
 * - name 1-100; SEO fields length-capped (100 / 300)
 * - slug: globally unique. Omitted → auto-derived from the name (`slugify`),
 *   suffixed -2/-3… on collision (base truncated to fit); provided →
 *   normalized, errors on collision (explicit beats surprising).
 *   `update` with `slug` omitted KEEPS the current slug — renames never
 *   change URLs; send `""` to re-derive from the (new) name.
 * - nesting: the parent must exist; at most MAX_DEPTH levels (root = 1);
 *   a node can't be moved inside itself or its own subtree
 * - ordering: `position` is 0..n-1 unique among siblings — create appends,
 *   move splices (position clamped to the valid range), delete compacts;
 *   every touched sibling set is renumbered in the same transaction
 * - delete: blocked while subcategories exist (the products-reference check
 *   arrives with PH1-06; archived products will be hidden from pickers)
 *
 * Permissions per matrix (PH0-21): view → catalog.view (everyone), create →
 * catalog.create (owner/admin/sales), edits + moves → catalog.edit (same),
 * delete → catalog.delete (owner/admin only — Sales can't delete). Every
 * write is audited; no-op saves record nothing (PH0-30 pattern).
 *
 * `list` returns the WHOLE tree in DFS order with computed `depth`/`path` —
 * categories are bounded config data (like sequences/taxRates), and tree
 * assembly/reparenting needs every node; paths are computed, never stored,
 * so a reparent can't leave stale breadcrumbs.
 */

const MAX_DEPTH = 6;
const MAX_NAME = 100;
const MAX_SEO_TITLE = 100;
const MAX_SEO_DESCRIPTION = 300;
const MAX_SLUG = 60;
const MAX_DESCRIPTION = 5000;

type Category = Doc<"categories">;

async function loadAll(ctx: MutationCtx): Promise<Category[]> {
  return await ctx.db.query("categories").collect();
}

/** Children of `parentId` (undefined = roots), ordered within siblings. */
function childrenOf(all: Category[], parentId: Id<"categories"> | undefined): Category[] {
  return all
    .filter((row) => row.parentId === parentId)
    .sort((a, b) => a.position - b.position || a._creationTime - b._creationTime);
}

/** Depth of `id` (root = 1) by walking parents; cycle-safe. */
function depthOf(all: Category[], id: Id<"categories">): number {
  const byId = new Map(all.map((row) => [row._id, row]));
  const seen = new Set<Id<"categories">>([id]);
  let depth = 1;
  let current = byId.get(id);
  while (current !== undefined && current.parentId !== undefined && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = byId.get(current.parentId);
    depth += 1;
  }
  return depth;
}

/** Is `ancestorId` on `ofId`'s parent chain? (move-cycle guard) */
function isAncestor(
  all: Category[],
  ancestorId: Id<"categories">,
  ofId: Id<"categories">,
): boolean {
  const byId = new Map(all.map((row) => [row._id, row]));
  const seen = new Set<Id<"categories">>();
  let current = byId.get(ofId);
  while (current !== undefined && current.parentId !== undefined && !seen.has(current.parentId)) {
    if (current.parentId === ancestorId) return true;
    seen.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return false;
}

/** Height of the subtree rooted at `id` (the node itself counts as 1). */
function subtreeHeight(all: Category[], id: Id<"categories">): number {
  let height = 0;
  const stack: { id: Id<"categories">; level: number }[] = [{ id, level: 1 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    height = Math.max(height, current.level);
    for (const child of childrenOf(all, current.id)) {
      stack.push({ id: child._id, level: current.level + 1 });
    }
  }
  return height;
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    throw new ConvexError(`Category name must be between 1 and ${MAX_NAME} characters.`);
  }
  return name;
}

function normalizeOptional(
  value: string | undefined,
  max: number,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > max) {
    throw new ConvexError(`${label} must be ${max} characters or fewer.`);
  }
  return trimmed;
}

function slugTaken(all: Category[], slug: string, selfId?: Id<"categories">): boolean {
  return all.some((row) => row.slug === slug && row._id !== selfId);
}

/**
 * Resolve the slug to store. Explicit input normalizes and must be free;
 * omitted derives from the name (truncated to MAX_SLUG) and gets a -2/-3
 * suffix on collision, with room reserved for the suffix.
 */
function resolveSlug(
  all: Category[],
  name: string,
  provided: string | undefined,
  selfId?: Id<"categories">,
): string {
  if (provided !== undefined && provided.trim() !== "") {
    const slug = slugify(provided);
    if (slug.length === 0) {
      throw new ConvexError("Slug must contain at least one letter or number.");
    }
    if (slug.length > MAX_SLUG) {
      throw new ConvexError(`Slug must be ${MAX_SLUG} characters or fewer.`);
    }
    if (slugTaken(all, slug, selfId)) {
      throw new ConvexError(`A category with slug "${slug}" already exists.`);
    }
    return slug;
  }

  let base = slugify(name);
  if (base.length === 0) {
    throw new ConvexError("Provide a slug — the name has no URL-usable characters.");
  }
  if (base.length > MAX_SLUG) {
    base = base.slice(0, MAX_SLUG).replace(/-+$/, "");
  }
  if (!slugTaken(all, base, selfId)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = `-${suffix}`;
    const head =
      base.length + tail.length > MAX_SLUG
        ? base.slice(0, MAX_SLUG - tail.length).replace(/-+$/, "")
        : base;
    const candidate = `${head}${tail}`;
    if (!slugTaken(all, candidate, selfId)) return candidate;
  }
  /* c8 ignore next */
  throw new ConvexError(`Couldn't derive a unique slug from "${base}".`);
}

async function validateImage(ctx: MutationCtx, imageFileId: Id<"files"> | undefined) {
  if (imageFileId !== undefined && (await ctx.db.get(imageFileId)) === null) {
    throw new ConvexError("That image no longer exists.");
  }
}

/** Depth-first listing: parents before children, siblings by `position`. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "catalog", "view");
    const all = await ctx.db.query("categories").collect();

    const byPosition = (a: Category, b: Category) =>
      a.position - b.position || a._creationTime - b._creationTime;
    const childrenByParent = new Map<string, Category[]>();
    for (const row of all) {
      const key = row.parentId ?? ""; // "" = roots (ids are never empty)
      const bucket = childrenByParent.get(key);
      if (bucket === undefined) childrenByParent.set(key, [row]);
      else bucket.push(row);
    }
    for (const bucket of childrenByParent.values()) bucket.sort(byPosition);

    type Listed = Category & { depth: number; path: Id<"categories">[] };
    const out: Listed[] = [];
    const visited = new Set<Id<"categories">>();
    const walk = (rows: Category[] | undefined, parentPath: Id<"categories">[], depth: number) => {
      if (rows === undefined) return;
      for (const row of rows) {
        if (visited.has(row._id)) continue; // defensive: never loop forever
        visited.add(row._id);
        const path = [...parentPath, row._id];
        out.push({ ...row, depth, path });
        walk(childrenByParent.get(row._id), path, depth + 1);
      }
    };

    walk(childrenByParent.get(""), [], 1);
    // Defensive: a row whose parent is missing (hand-edited data) surfaces
    // as a root together with its subtree instead of disappearing.
    if (visited.size < all.length) {
      for (const row of [...all].sort(byPosition)) {
        if (!visited.has(row._id)) walk([row], [], 1);
      }
    }
    return out;
  },
});

export const create = auditedMutation({
  entity: "categories",
  action: "create",
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    parentId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    seoTitle: v.optional(v.string()),
    seoDescription: v.optional(v.string()),
    visible: v.boolean(),
    imageFileId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "create");
    const all = await loadAll(ctx);
    const name = normalizeName(args.name);
    const parentId = args.parentId;

    let depth = 1;
    if (parentId !== undefined) {
      if (!all.some((row) => row._id === parentId)) {
        throw new ConvexError("The parent category no longer exists.");
      }
      depth = depthOf(all, parentId) + 1;
      if (depth > MAX_DEPTH) {
        throw new ConvexError(`Categories can be nested at most ${MAX_DEPTH} levels deep.`);
      }
    }
    const slug = resolveSlug(all, name, args.slug);
    await validateImage(ctx, args.imageFileId);

    const description = normalizeOptional(args.description, MAX_DESCRIPTION, "Description");
    const seoTitle = normalizeOptional(args.seoTitle, MAX_SEO_TITLE, "SEO title");
    const seoDescription = normalizeOptional(
      args.seoDescription,
      MAX_SEO_DESCRIPTION,
      "SEO description",
    );
    const position = childrenOf(all, parentId).length; // append
    const now = Date.now();
    const id = await ctx.db.insert("categories", {
      name,
      slug,
      parentId,
      description,
      seoTitle,
      seoDescription,
      visible: args.visible,
      position,
      imageFileId: args.imageFileId,
      createdAt: now,
      updatedAt: now,
    });
    return {
      result: { id },
      audit: {
        entityId: id,
        after: { name, slug, parentId, visible: args.visible, position, depth },
      },
    };
  },
});

export const update = auditedMutation({
  entity: "categories",
  action: "update",
  args: {
    id: v.id("categories"),
    name: v.string(),
    slug: v.optional(v.string()),
    description: v.optional(v.string()),
    seoTitle: v.optional(v.string()),
    seoDescription: v.optional(v.string()),
    visible: v.boolean(),
    imageFileId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    const all = await loadAll(ctx);
    const row = all.find((candidate) => candidate._id === args.id);
    if (row === undefined) {
      throw new ConvexError("This category no longer exists.");
    }

    const name = normalizeName(args.name);
    // `slug` omitted → keep (URL stability); `""` → re-derive from name.
    const slug = args.slug === undefined ? row.slug : resolveSlug(all, name, args.slug, args.id);
    const description = normalizeOptional(args.description, MAX_DESCRIPTION, "Description");
    const seoTitle = normalizeOptional(args.seoTitle, MAX_SEO_TITLE, "SEO title");
    const seoDescription = normalizeOptional(
      args.seoDescription,
      MAX_SEO_DESCRIPTION,
      "SEO description",
    );
    await validateImage(ctx, args.imageFileId);

    const before = {
      name: row.name,
      slug: row.slug,
      description: row.description,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      visible: row.visible,
      imageFileId: row.imageFileId,
    };
    const after = {
      name,
      slug,
      description,
      seoTitle,
      seoDescription,
      visible: args.visible,
      imageFileId: args.imageFileId,
    };
    const changed = (Object.keys(after) as (keyof typeof after)[]).some(
      (key) => before[key] !== after[key],
    );
    if (!changed) {
      return { result: undefined, audit: undefined };
    }

    await ctx.db.patch(args.id, {
      name,
      slug,
      description,
      seoTitle,
      seoDescription,
      visible: args.visible,
      imageFileId: args.imageFileId,
      updatedAt: Date.now(),
    });
    return { result: undefined, audit: { entityId: args.id, before, after } };
  },
});

export const move = auditedMutation({
  entity: "categories",
  action: "move",
  args: {
    id: v.id("categories"),
    /** Absent = move to the root level (same "no parent" shape as the row). */
    newParentId: v.optional(v.id("categories")),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "edit");
    if (!Number.isInteger(args.position)) {
      throw new ConvexError("Position must be a whole number.");
    }
    const all = await loadAll(ctx);
    const node = all.find((candidate) => candidate._id === args.id);
    if (node === undefined) {
      throw new ConvexError("This category no longer exists.");
    }
    const newParentId = args.newParentId;

    if (newParentId !== undefined) {
      if (newParentId === args.id) {
        throw new ConvexError("A category can't be moved inside itself.");
      }
      if (!all.some((candidate) => candidate._id === newParentId)) {
        throw new ConvexError("The parent category no longer exists.");
      }
      if (isAncestor(all, args.id, newParentId)) {
        throw new ConvexError("A category can't be moved inside one of its own subcategories.");
      }
    }

    const newDepth = newParentId === undefined ? 1 : depthOf(all, newParentId) + 1;
    const height = subtreeHeight(all, args.id);
    if (newDepth + height - 1 > MAX_DEPTH) {
      throw new ConvexError(`Categories can be nested at most ${MAX_DEPTH} levels deep.`);
    }

    const oldParentId = node.parentId;
    const siblings = childrenOf(all, newParentId).filter((candidate) => candidate._id !== args.id);
    // Clamp: a stale/high drag position appends rather than failing.
    const position = Math.max(0, Math.min(args.position, siblings.length));
    siblings.splice(position, 0, node);

    const changedParent = oldParentId !== newParentId;
    const changedPosition = node.position !== position;
    if (!changedParent && !changedPosition) {
      return { result: undefined, audit: undefined };
    }

    const now = Date.now();
    // Spliced list: node goes to `position`, everyone else fills the gaps.
    for (const [index, row] of siblings.entries()) {
      if (row._id !== args.id && row.position !== index) {
        await ctx.db.patch(row._id, { position: index, updatedAt: now });
      }
    }
    if (changedParent) {
      // Old sibling set loses a member — compact it too.
      const oldSiblings = childrenOf(all, oldParentId).filter(
        (candidate) => candidate._id !== args.id,
      );
      for (const [index, row] of oldSiblings.entries()) {
        if (row.position !== index) {
          await ctx.db.patch(row._id, { position: index, updatedAt: now });
        }
      }
    }
    await ctx.db.patch(args.id, { parentId: newParentId, position, updatedAt: now });

    return {
      result: undefined,
      audit: {
        entityId: args.id,
        before: { parentId: oldParentId, position: node.position },
        after: { parentId: newParentId, position },
      },
    };
  },
});

export const remove = auditedMutation({
  entity: "categories",
  action: "delete",
  args: { id: v.id("categories") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "catalog", "delete");
    const all = await loadAll(ctx);
    const node = all.find((candidate) => candidate._id === args.id);
    if (node === undefined) {
      throw new ConvexError("This category no longer exists.");
    }
    const children = childrenOf(all, args.id);
    if (children.length > 0) {
      const count = children.length;
      throw new ConvexError(
        `This category has ${count} subcategor${count === 1 ? "y" : "ies"} — move or delete them first.`,
      );
    }

    await ctx.db.delete(args.id);
    // Compact the sibling set the deleted node left a gap in.
    const now = Date.now();
    const siblings = childrenOf(all, node.parentId).filter(
      (candidate) => candidate._id !== args.id,
    );
    for (const [index, row] of siblings.entries()) {
      if (row.position !== index) {
        await ctx.db.patch(row._id, { position: index, updatedAt: now });
      }
    }
    return {
      result: undefined,
      audit: {
        entityId: args.id,
        before: {
          name: node.name,
          slug: node.slug,
          parentId: node.parentId,
          position: node.position,
        },
      },
    };
  },
});
