import { convexTest, type TestConvex } from "convex-test";
import schema from "../convex/schema";

/**
 * Glob of all Convex modules so convex-test can discover queries/mutations/actions.
 * Keep in sync with the `convex/` directory layout.
 */
export const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

export function setup(): TestConvex<typeof schema> {
  return convexTest(schema, modules);
}
