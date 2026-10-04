# Permission matrix (PH0-21)

Single source of truth for RBAC. Enforced **inside Convex mutations** via
`requirePermission(module, action)` (`convex/_lib/permissions.ts`) and reflected in
the UI via the `useCan()` hook — the UI never decides, it only mirrors.

## Roles

| Role | Intent |
|---|---|
| **Owner** | Everything, including dangerous ops (period close, role changes, delete). |
| **Admin** | Everything except ownership transfer / factory resets. |
| **Sales** | Customers, quotes, sales orders, their own documents. No finance close. |
| **Warehouse** | Stock, receiving, transfers, picking, counting. Read-only catalog. |
| **Accountant** | Full finance module, read-only on sales/procurement/stock. |
| **Storefront** | Not a staff role — marks a *customer* identity (portal access only). |

## Modules × actions

Actions: `view` · `create` · `edit` · `delete` · `approve` · `post` (irreversible,
e.g. journal/period close) · `export`

| Module | Owner | Admin | Sales | Warehouse | Accountant |
|---|---|---|---|---|---|
| **settings** (company, tax, currency, numbering) | CRUD + post | CRU + post | — | — | view |
| **users** & roles | CRUD | CRU | — | — | — |
| **catalog** (products, categories) | full | full | view, create, edit | view | view |
| **inventory** (stock, transfers, adjustments) | full | full | view | full + approve adjustments | view |
| **sales** (customers, quotes, orders, returns) | full | full | full + approve | view, edit fulfillment | view |
| **procurement** (vendors, POs, bills) | full | full | view | view, receive | view, edit bills |
| **finance** (journal, AR/AP, reports, periods) | full + post/close | full + post | view (own customer stmts) | — | full + post (no close) |
| **service** (RMA, warranty, jobs) | full | full | full | view, edit jobs | view |
| **storefront** (orders, content, promos) | full | full | view orders | — | view orders |
| **reports** & dashboards | full | full | sales reports | inventory reports | all financial |

## Rules

1. **Deny by default** — unknown module/action combination = denied.
2. **Every state-changing mutation** calls `requirePermission` first, writes `auditLog` last.
3. `post` and `close` are separate from `edit` because posted documents are immutable
   (reversal only) — see development plan §1.
4. Changing roles/permissions is itself an audited `users` action (Owner only).
5. Tests must cover at least one denial per role (PH0-35).

_When adding a module: add a row here first, then the permission constant, then the mutation checks._
