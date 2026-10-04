import { convexTest, type TestConvex } from "convex-test";
import schema from "../convex/schema";

/**
 * Glob of all Convex modules so convex-test can discover queries/mutations/actions.
 * Array form + `!` exclusion: Vite's import.meta.glob does not support extglob `!(...)`.
 * Excludes only TypeScript declaration files (*.d.ts).
 */
export const modules = import.meta.glob([
  "../convex/**/*.ts",
  "../convex/**/*.tsx",
  "../convex/**/*.js",
  "../convex/**/*.jsx",
  "!../convex/**/*.d.ts",
]);

export function setup(): TestConvex<typeof schema> {
  return convexTest(schema, modules);
}
