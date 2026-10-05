# Permission matrix (PH0-21)

Single source of truth for RBAC. Enforced **inside Convex mutations** via
`requirePermission(module, action)` (`convex/_lib/permissions.ts`) and reflected in
the UI via the `useCan()` hook — the UI never decides, it only mirrors.

## Roles

| Role           | Intent                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| **Owner**      | Everything, including dangerous ops (period close, role changes, delete). |
| **Admin**      | Everything except ownership transfer / factory resets.                    |
| **Sales**      | Customers, quotes, sales orders, their own documents. No finance close.   |
| **Warehouse**  | Stock, receiving, transfers, picking, counting. Read-only catalog.        |
| **Accountant** | Full finance module, read-only on sales/procurement/stock.                |
| **Storefront** | Not a staff role — marks a _customer_ identity (portal access only).      |

## Modules × actions

Actions: `view` · `create` · `edit` · `delete` · `approve` · `post` (irreversible,
e.g. journal/period close) · `export`

| Module                                           | Owner             | Admin       | Sales                     | Warehouse                  | Accountant             |
| ------------------------------------------------ | ----------------- | ----------- | ------------------------- | -------------------------- | ---------------------- |
| **settings** (company, tax, currency, numbering) | CRUD + post       | CRU + post  | —                         | —                          | view                   |
| **users** & roles                                | CRUD              | CRU         | —                         | —                          | —                      |
| **catalog** (products, categories)               | full              | full        | view, create, edit        | view                       | view                   |
| **inventory** (stock, transfers, adjustments)    | full              | full        | view                      | full + approve adjustments | view                   |
| **sales** (customers, quotes, orders, returns)   | full              | full        | full + approve            | view, edit fulfillment     | view                   |
| **procurement** (vendors, POs, bills)            | full              | full        | view                      | view, receive              | view, edit bills       |
| **finance** (journal, AR/AP, reports, periods)   | full + post/close | full + post | view (own customer stmts) | —                          | full + post (no close) |
| **service** (RMA, warranty, jobs)                | full              | full        | full                      | view, edit jobs            | view                   |
| **storefront** (orders, content, promos)         | full              | full        | view orders               | —                          | view orders            |
| **reports** & dashboards                         | full              | full        | sales reports             | inventory reports          | all financial          |

## Rules

1. **Deny by default** — unknown module/action combination = denied.
2. **Every state-changing mutation** calls `requirePermission` first, writes `auditLog` last.
3. `post` and `close` are separate from `edit` because posted documents are immutable
   (reversal only) — see development plan §1.
4. Changing roles/permissions is itself an audited `users` action (Owner only).
5. Tests must cover at least one denial per role (PH0-35).

_When adding a module: add a row here first, then the permission constant, then the mutation checks._

## Implementation notes (PH0-22)

- **Code lives in `convex/_lib/permissions.ts`**: this doc transcribed as
  `ROLE_PERMISSIONS` (source of truth stays here); `requirePermission(ctx, module, action)`
  returns the caller's user id for the audit log and throws a user-facing
  `ConvexError` on denial. Self-scoped actions (own profile, own session revoke)
  are exempt by design.
- **Tables**: `roles` (assignable catalog — seeded idempotently by `grantRole`
  and the PH0-34 seed script) + `userRoles` (single-role model, grantedBy
  audit trail). Checks resolve through these rows; labels come from code.
- **Bootstrap rule**: while _no_ `userRoles` row exists anywhere (fresh
  install, pre-seed), the earliest-created user is implicitly the Owner —
  the app can never lock everyone out. The first grant materializes that
  owner row (see `grantRole`), after which the fallback is gone forever.
- **Role grants are Owner-only (rule 4)** — including the role picked in the
  invite dialog: Admin can invite _without_ a role; re-inviting never clears
  an existing role. You cannot change your own role (prevents self-lockout).
- **UI**: role select in the invite dialog, role badges on `/users`, role on
  the profile page; per-row role editing + `useCan()` gating arrive with PH0-23.
- **Enforced today**: `invites.create`, `users.list`, `users.assignRole`,
  `roles.list` (PH0-22); `audit:list` (settings.view, PH0-26);
  `organization.update` (settings.edit), `organization:get` (session-only —
  every document renderer needs the letterhead), `sequences.list`
  (settings.view), `sequences.ensureDefaults` (settings.create),
  `sequences.update` (settings.edit) (PH0-29/30); `currencies.list`/
  `currencies.rates` (settings.view), `currencies.create`
  (settings.create), `currencies.updateBase`/`currencies.addRate`
  (settings.edit) (PH0-31); `tax.rates`/`tax.groups` (settings.view),
  `tax.createRate`/`tax.createGroup` (settings.create),
  `tax.updateRate`/`tax.updateGroup` (settings.edit) (PH0-32);
  `formatting:get` (session-only — renderers everywhere),
  `formatting:update` (settings.edit) (PH0-33); `seed.seed`
  (settings.create + Owner — rule 4, grants roles) (PH0-34);
  `categories.list` (catalog.view), `categories.create` (catalog.create),
  `categories.update`/`categories.move` (catalog.edit),
  `categories.remove` (catalog.delete — Sales notably lacks it) (PH1-01).
  Self-service by design,
  no RBAC: `users.updateProfile`, `users.setAvatar`, `files.*`
  (uploader-or-settings.edit on remove), `notifications.*` (own rows).
  New mutations call `requirePermission` from day one;
  `tests/guards.test.ts` (PH0-35) sweeps every exported mutation in CI —
  no identity/permission gate or an unaudited table write (outside the
  reasoned allowlist) fails the build.
- **Audit entries (rule 2)**: `auditedMutation()` in `convex/_lib/audit.ts`
  appends the before/after snapshot after the handler succeeds (snapshots are
  redacted; a thrown handler records nothing); `appendAudit()` covers
  mutations that don't fit the wrapper. Viewer: `/settings/audit`
  (`settings.view`).
