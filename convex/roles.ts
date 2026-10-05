import { requirePermission, SYSTEM_ROLES } from "./_lib/permissions";
import { query } from "./_generated/server";

/**
 * The assignable role catalog for selects and badges (PH0-22).
 * Labels live in code (`convex/_lib/permissions.ts`, from docs/permissions.md);
 * gated like the users page so the dropdown only appears where role grants
 * are legal.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "users", "view");
    return SYSTEM_ROLES;
  },
});
