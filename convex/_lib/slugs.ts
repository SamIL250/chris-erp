import { ConvexError } from "convex/values";
import { slugify } from "../../lib/slug";

/**
 * Globally-unique slug resolution, shared by every URL-keyed catalog entity
 * (categories since PH1-01, products from PH1-07 — and future slug-keyed
 * tables such as static pages). The rules are identical for all of them:
 *
 * - explicit input normalizes (`slugify`) and must be free — collisions are
 *   errors, never silently suffixed (a typed slug is a statement of intent);
 * - omitted (or blank) input derives from the name (truncated to MAX_SLUG,
 *   room reserved for the suffix) and gets a `-2`/`-3`… suffix on collision;
 *
 * Uniqueness is answered by the CALLER's `isTaken` probe, not by loading
 * every row: categories pass a closed-over array (bounded config data),
 * products probe the `by_slug` index (unbounded rows — PH1-07), so each
 * caller pays only what its table's size justifies. A probe should return
 * true for any OTHER row with that slug (self-exclusion is the update
 * caller's job, in the closure).
 *
 * `noun` only personalizes the collision message; everything else is
 * entity-neutral ("A category with slug … already exists." stays byte-for-byte
 * what PH1-01 shipped).
 */
export const MAX_SLUG = 60;

export async function resolveUniqueSlug(
  isTaken: (slug: string) => boolean | Promise<boolean>,
  name: string,
  provided: string | undefined,
  noun: string,
): Promise<string> {
  if (provided !== undefined && provided.trim() !== "") {
    const slug = slugify(provided);
    if (slug.length === 0) {
      throw new ConvexError("Slug must contain at least one letter or number.");
    }
    if (slug.length > MAX_SLUG) {
      throw new ConvexError(`Slug must be ${MAX_SLUG} characters or fewer.`);
    }
    if (await isTaken(slug)) {
      throw new ConvexError(`A ${noun} with slug "${slug}" already exists.`);
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
  if (!(await isTaken(base))) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = `-${suffix}`;
    const head =
      base.length + tail.length > MAX_SLUG
        ? base.slice(0, MAX_SLUG - tail.length).replace(/-+$/, "")
        : base;
    const candidate = `${head}${tail}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  /* c8 ignore next */
  throw new ConvexError(`Couldn't derive a unique slug from "${base}".`);
}
