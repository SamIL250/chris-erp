# Development Plan — ERP + Ecommerce (Phased Build)

> **Companion to:** [`erp-research-and-features.md`](./erp-research-and-features.md) (research, decisions, feature priorities)
> **Stack:** Next.js (App Router) · Convex · Untitled UI (components + icons) · Stripe · Resend · Tailwind v4
> **Status:** Phase 1 🔄 in progress — attribute sets + Attributes admin UI shipped (4 / 25, Catalog & Inventory)
> **Last updated:** 2026-10-05

---

## How to use this document

1. **This is the single source of truth for build progress.** Every development session:
   - Pick the next unchecked task(s) from the current phase (top → bottom).
   - Implement, test, verify against the task's acceptance notes.
   - Mark it `- [x]` **only when the Definition of Done is met**.
   - Update the **Status Board** (§0) at the end of the session.
2. **Task IDs are stable** (`PH0-01`, `PH1-04`…) — reference them in commits/messages ("PH1-04: variant SKU rules").
3. **Phase gates are real.** A phase is ✅ only when its _Exit Criteria_ block is fully checked. Don't start the next phase's core work while the current gate is red (parallel exceptions: docs, tests, bug fixes).
4. **Schema-first rule:** tables/fields needed by later phases get created in Phase 1 (serials, lots, warranty, service) — only UI/workflows wait.
5. **Scope changes:** new ideas go to **§11 Backlog**, not into a running phase. We re-prioritize explicitly.

### Definition of Done (every task)

- [ ] Business rule enforced **inside the Convex mutation** (never only in UI)
- [ ] Permission check + audit log entry written for state-changing mutations
- [ ] Unit/integration tests for logic-heavy tasks (`convex-test` + vitest)
- [ ] UI: loading, empty, error states + responsive; Untitled UI components used
- [ ] Typecheck + lint green; no `any` leaks in public surfaces
- [ ] Task checkbox ticked + Status Board refreshed

---

## 0. Status Board

| Phase          | Focus                                              | Status         | Tasks   | Gate |
| -------------- | -------------------------------------------------- | -------------- | ------- | ---- |
| **Phase 0**    | Foundation (scaffold, auth, RBAC, settings, shell) | ✅ Complete    | 35 / 35 | ☑    |
| **Phase 1**    | Catalog + Inventory core (schema-first)            | 🔨 In progress | 9 / 25  | ☐    |
| **Phase 2**    | Sales & Procurement (O2C + P2P documents)          | ⬜ Not started | 0 / 29  | ☐    |
| **Phase 3**    | Finance (double-entry, postings, reports)          | ⬜ Not started | 0 / 17  | ☐    |
| **Phase 4**    | Ecommerce storefront (B2C + B2B portal)            | ⬜ Not started | 0 / 24  | ☐    |
| **Phase 5**    | Traceability & Service (serial/lot/FEFO, warranty) | ⬜ Not started | 0 / 17  | ☐    |
| **Phase 6**    | Depth, automation & hardening (go-live)            | ⬜ Not started | 0 / 27  | ☐    |
| **Continuous** | Tests, CI, docs, seed data                         | 🔨 Ongoing     | 1 / 6   | —    |

**Total: 174 tasks + 26 phase-gate checks.**

Legend: ⬜ Not started · 🔨 In progress · ✅ Done (gate met)

---

## 1. Engineering conventions (set up in Phase 0)

**Repository structure**

```
chris-erp/
├── app/
│   ├── (store)/            # Ecommerce: home, c/[category], p/[slug], cart, checkout, account
│   ├── (admin)/            # ERP: dashboard, catalog, inventory, sales, procurement, finance, service, reports
│   ├── (auth)/             # login, signup, reset
│   └── api/                # route handlers (webhooks, sitemap)
├── convex/
│   ├── schema.ts           # ALL tables + indexes
│   ├── <domain>/           # one folder per domain: catalog, inventory, sales, procurement, finance, ...
│   │   ├── queries.ts | mutations.ts | helpers.ts
│   ├── crons.ts            # scheduled jobs
│   └── _lib/               # auth, permissions, audit, sequences, posting intents
├── components/
│   ├── base/               # Untitled UI source (added via CLI — kept pristine for upgrades)
│   ├── application/        # Untitled UI application components (table, modal, nav, date-picker…)
│   ├── ui/                 # OUR wrappers built over base/application (forms, data table, feedback)
│   └── shared/             # cross-feature components (doc-flow, search…)
├── styles/                 # Untitled UI theme.css + typography + globals (added via CLI)
├── utils/                  # CLI-provided helpers (cx, …)
├── lib/                    # shared utils, status unions, formatting, pricing client helpers
├── tests/                  # vitest + convex-test
└── docs/                   # research, development plan, permissions matrix
```

**Rules**

- **Tables:** plural camelCase (`salesOrders`, `stockMovements`); fields camelCase; every list query paginated (`paginationV2`); index everything you filter by (`by_…` naming).
- **Documents vs rows:** transactional docs carry `docNumber` (from sequences), `status` (string union), `postedAt` (immutable once set), and lineage fields (`quoteId`, `salesOrderId`, `invoiceId`…).
- **Immutability:** posted accounting documents can only be **reversed/credited**, never edited.
- **Money:** integer **minor units** + `currency` field everywhere. No floats.
- **Statuses:** central `lib/status.ts` unions shared by UI + mutations (single vocabulary).
- **Naming in UI:** O2C = Quote → Sales Order → Delivery → Invoice → Credit Note; P2P = Requisition → PO → Receipt → Bill → Payment.

---

## 2. Phase 0 — Foundation

**Goal:** A secure, beautiful, empty shell: login, roles, settings, audit — everything other features plug into.
**Exit criteria:**

- [x] A new user can sign up, be assigned a role, log in, and sees only permitted nav/actions _(signup/invites/sign-in E2E; role grants notify; nav + route gating fail-closed, unit-tested)_
- [x] Company profile, numbering sequences, base currency, tax rates configurable via UI _(/settings/company, /settings/sequences, /settings/currencies, /settings/tax — each SSR-verified + mutations exercised over HTTP)_
- [x] Audit log records every mutation performed in the app _(auditedMutation wrapper; tests/guards.test.ts sweeps every writing mutation — exempt list reasoned + staleness-checked)_
- [x] Seed script produces demo org + users; CI (typecheck/lint/test) green _(`npm run seed` E2E on dev: 2 rates + 5 invited users, idempotent re-run no-op; ci.yml runs typecheck/lint/format/test/build — all green, 92 tests)_

### 0.1 Scaffold & tooling

- [x] **PH0-01** Init Next.js (App Router, TypeScript strict, Tailwind v4), ESLint + Prettier, `.env.example`
- [x] **PH0-02** Init Convex project; dev + prod deployments; env wiring to Next.js
- [x] **PH0-03** Folder structure per §1 created with placeholder files
- [x] **PH0-04** Vitest + `convex-test` harness wired; first passing test
- [x] **PH0-05** CI pipeline (GitHub Actions): typecheck, lint, unit tests on push
- [x] **PH0-06** README: local setup, scripts, deployment links

### 0.2 Design system (Untitled UI)

- [x] **PH0-07** Install Untitled UI React via CLI + `@untitledui/icons`; Tailwind theme tokens (colors, radius, typography), light/dark CSS variables ready
- [x] **PH0-08** Wrap primitives in `components/ui/`: Button, Input, Textarea, Select/Combobox, Checkbox, Radio, Switch, DatePicker, Table, Modal, Drawer, Tabs, Toast, Badge, Avatar, Card, Skeleton, EmptyState, PageHeader, Breadcrumb, Pagination, Tooltip, Dropdown
- [x] **PH0-09** Form pattern: react-hook-form + zod resolver over Untitled UI fields (single `FormInput`, `FormSelect`, `FormError` wrappers)
- [x] **PH0-10** Data table pattern: Convex `paginationV2` + sort/filter/column-visibility, Untitled UI table skin, row click → drawer/detail
- [x] **PH0-11** Chart containers (recharts or similar) styled per Untitled UI chart look: line, bar, donut, KPI stat tile

### 0.3 App shell & navigation

- [x] **PH0-12** Admin layout: collapsible sidebar grouped by module (Dashboard, Catalog, Inventory, Sales, Procurement, Finance, Service, Reports, Settings), topbar with search, notification bell, user menu
- [x] **PH0-13** Route protection middleware: unauthenticated → `(auth)`; storefront vs admin access by role (auth-level in the proxy; permission-derived route gating delivered in PH0-23)
- [x] **PH0-14** Global search box (searches customers/products/documents by phase availability — grows with features)
- [x] **PH0-15** Dashboard placeholder page with KPI tiles (values `—` until data exists)
- [x] **PH0-16** Error boundary, 404, loading conventions, toast system wired

### 0.4 Auth & user management

- [x] **PH0-17** Convex Auth: email/password + Google OAuth; login, signup, logout, forgot/reset password pages (Untitled UI)
- [x] **PH0-18** `users` profile table (name, avatar, role, status active/invited/disabled), profile settings page (role display delivered in PH0-22; avatar upload delivered in PH0-27)
- [x] **PH0-19** Admin: invite user by email → invitee sets password → lands with assigned role (role assignment delivered in PH0-22; without a Resend key the dev link is shown in the invite dialog)
- [x] **PH0-20** Session handling, auth rate limiting, security headers (7d/24h session policy + 15-min access tokens, `revokeOtherSessions` after password reset & from profile, built-in 10 failed-attempts/hour limiter, CSP/HSTS/etc on every response; plus a proxy workaround for an `@convex-dev/auth` bug that turned auth redirects into blank pages)

### 0.5 RBAC

- [x] **PH0-21** Permission matrix spec (doc in repo): modules × actions (view/create/edit/delete/approve/post) for roles: **Owner, Admin, Sales, Warehouse, Accountant, Storefront (customer)**
- [x] **PH0-22** `roles` + `userRoles` tables; `requirePermission(module, action)` helper used by every mutation; permission tests (denied access proves 403-equivalent error) _(enforced on every mutation that exists today — invites/users/roles; the bootstrap-owner rule + Owner-only role grants are documented in docs/permissions.md; per-row role-change UI rides PH0-23's `useCan()`)_
- [x] **PH0-23** UI gating: nav items, buttons, route access derived from permissions (single `useCan()` hook) _(hooks/use-can.ts: `useCan`/`useIsOwner`/`useNavItems` over the shared matrix in lib/permissions.ts; sidebar + ⌘K palette filtered; `PermissionGate` redirects denied routes to /dashboard; invite button = users.create, role select = Owner-only; logic unit-tested — visual check deferred to a browser session)_

### 0.6 Platform tables & core helpers

- [x] **PH0-24** `schema.ts` foundations: `organizations` (single-company config), `users`, `roles`, `settings`, `sequences`, `currencies`, `exchangeRates`, `taxRates`, `taxGroups`, `auditLog`, `notifications`, `files` _(organizations/users/roles had landed in PH0-18/22; added settings, sequences, currencies, exchangeRates, taxRates, taxGroups, auditLog, notifications, files with indexes + design comments; sanity suite tests/platform-tables.test.ts writes/queries every one)_
- [x] **PH0-25** `nextSequence(name)` document-number generator (INV-, SO-, PO-, QT-, DN-, CR-, JRNL-…) _(convex/_lib/sequences.ts: consume-in-transaction helper + pure `formatSequence` + `peekSequence` preview for the PH0-30 UI + idempotent `ensureDefaultSequences` seeding the canonical 11 (QT-/SO-/DN-/INV-/CR-/PO-/GRN-/PAY-/JRNL-/RMA-/WO-), custom rows never overwritten; tests/sequences.test.ts)_
- [x] **PH0-26** `audit()` helper: append-only before/after snapshots, wired into a generic mutation wrapper; **audit log viewer UI** (filter by actor/entity/date) _(convex/_lib/audit.ts: `redact()` masks credential-shaped snapshot keys, `appendAudit()` resolves the actor, `auditedMutation()` wraps Convex mutations — handler returns `{result, audit}`, append happens only on success; wired into updateProfile, assignRole, invites.create; viewer at /settings/audit gated by settings.view — actor/entity/date filters, before/after detail dialog; tests/audit.test.ts)_
- [x] **PH0-27** File storage: Convex storage upload, signed URLs, image upload component (used later by catalog) _(convex/files.ts: generateUploadUrl → POST bytes → saveFile (audited) → files:getUrl re-resolves signed URLs — they expire, so callers persist fileIds; remove = uploader or settings.edit, audited; components/ui/image-upload.tsx: drag & drop, client validation, 5 MB default; wired to the profile photo now (PH0-18 deferral), users.avatarFileId resolved in users:me; tests/files.test.ts)_
- [x] **PH0-28** Notification center: in-app bell + list + read/unread; `notify()` helper for future events _(convex/_lib/notifications.ts `notify(ctx, {userId, title, body?, kind?, href?})` — transactional, so failed mutations notify nobody; convex/notifications.ts: list (own, by_user_time desc), countUnread (bounded 1000), markRead (foreign ids ignored), markAllRead (batched) — session-scoped, no RBAC; bell replaces the placeholder: unread badge, relative times, deep-link rows, explicit "Mark all as read"; wired to role changes (PH0-22 event); read-state deliberately not audited; tests/notifications.test.ts)_

### 0.7 Settings & configuration

- [x] **PH0-29** Company settings: legal name, logo, addresses, contacts, tax ID, invoice footer/notes — displayed on future documents _(convex/organization.ts: get (session-gated — document renderers need letterhead too, not settings.view; resolves logo to a signed URL) + update (settings.edit, audited "update", full-form save — omitted optional clears, first save creates with baseCurrency "USD"); organizations.logoStorageId → logoFileId (files registry, kind "logo"); form at /settings/company (nav "Company", settings.view gate) with ImageUpload logo, address grid, invoice footer; tests/organization.test.ts)_
- [x] **PH0-30** Document numbering settings UI (view/edit sequences, preview format) _(convex/sequences.ts: list (settings.view, canonical order first) / ensureDefaults (settings.create, audited "create" with created count; idempotent re-runs not audited) / update (settings.edit, audited with before/after — prefix uppercased + A-Z/0-9/- 1-10, padding 1-6, `next` never editable per PH0-25's grow-only contract, no-op saves unrecorded); page /settings/sequences (nav "Document numbering") with next-number column + edit dialog whose live preview uses the same formatSequence as issuance; tests appended to tests/sequences.test.ts)_
- [x] **PH0-31** Currency settings: base currency, exchange-rate list + manual update (used by pricing in Phase 2) _(convex/currencies.ts: list (settings.view — catalog sorted by code + base from organizations.baseCurrency) / create (settings.create — ISO 4217 3-letter uppercased, unique, decimalPlaces 0-6, audited) / updateBase (settings.edit — requires company row + catalog entry, no-op silent, audited organizations/updateBase with before/after) / rates (settings.view — append-only history newest-first) / addRate (settings.edit — validates pair exists + differs + positive, source \"manual\", audited); page /settings/currencies (nav \"Currencies\") with base-currency select, catalog + add dialog, rate history + add dialog; audit key `currency` not `code` (redactor); tests/currencies.test.ts)_
- [x] **PH0-32** Tax engine config UI: create rates (name, %, inclusive/exclusive), tax groups (customer assign), product tax categories (standard/reduced/zero/exempt) _(convex/tax.ts: rates/groups (settings.view, name-sorted), createRate (settings.create) / updateRate (settings.edit — rates never deleted, only deactivated; audited before/after with `label` not `code` [redactor], no-op silent), createGroup/updateGroup (validate rate ids; exactly one default — promotion demotes others and the demotion ids ride in the audit payload); page /settings/tax (nav \"Tax\") with rate + group tables/dialogs (percent → integer basis points at submit) and an explainer card for the four product tax categories; customer/product assignment lands Phase 2; tests/tax.test.ts)_
- [x] **PH0-33** Date/number formatting preferences (locale, timezone) _(convex/formatting.ts: get (session-gated like organization:get — renderers everywhere need it; nulls = browser defaults) + update (settings.edit, global upsert on settings key \"formatting\", Intl.getCanonicalLocales + Intl.DateTimeFormat timeZone validation with precise errors, no-op silent, audited — first save has no before); lib/format.ts pure helpers formatDate/formatDateTime/formatNumber/formatPercent taking {locale, timezone}; page /settings/formatting (nav \"Formatting\") with locale list + full IANA timezone list (Intl.supportedValuesOf) and a LIVE preview using the same helpers; tests/formatting.test.ts incl. helper assertions (Berlin date rollover, de-DE vs en-US number groups))_

### 0.8 Seed & quality

- [x] **PH0-34** Seed script: demo org, one user per role, currencies, tax rates, sequences — idempotent _(convex/seed.ts: Owner-only (settings.create first, then requireRole → rule 4 since seeding grants roles); strictly additive — org only while NONE exists, currencies by missing code, tax rates by missing name, 11 default sequences, one invited user per SYSTEM_ROLES key `<role>@example.com` + role grant via shared `convex/_lib/invites.ts` `inviteUser` extracted from invites.create — existing users get a role only when they have none, disabled accounts untouched; invite URLs ONLY in the result; audit one summary entry, skipped entirely when nothing changed; scripts/seed.mjs `npm run seed` signs in as the owner then calls seed:seed; tests/seed.test.ts incl. no-clobber + secret-free audit)_
- [x] **PH0-35** Permission + audit tests green in CI; mutation helper coverage for future code _(tests/guards.test.ts: static sweep of every exported `convex/*.ts` mutation — rule 1 (requirePermission/requireRole/getAuthUserId or a local `require*` identity helper) and rule 2 (any `ctx.db.insert|patch|delete` must go through `auditedMutation`, else a reasoned `AUDIT_EXEMPT` entry — allowlist entries are themselves verified: stale or no-longer-needed exemptions fail too). Canary-verified: an ungated/unaudited mutation fails on both rules. Rule 5 (a denial per role) confirmed across rbac/seed tests for all five system roles; .github/workflows/ci.yml already runs typecheck/lint/format/test/build — suite 92 tests green)_

---

## 3. Phase 1 — Catalog & Inventory Core (schema-first)

**Goal:** Correct, auditable stock for multi-category products across warehouses — including the schema for serials/lots/expiry/warranty that later phases activate.
**Exit criteria:**

- [ ] Full product catalog maintainable (categories, attributes, variants, images)
- [ ] Stock per warehouse provably correct under test (receipts, issues, transfers, adjustments)
- [ ] `onHand` vs `available` (reserved) distinction working; low-stock alerts firing
- [ ] Serial/lot/expiry/warranty **tables exist** with tests around helpers (UI waits for Phase 5)

### 1.1 Categories & attributes

- [x] **PH1-01** Category tree: CRUD nested nodes, slug auto + unique, SEO title/description, visibility toggle, manual ordering, move/reparent rules
- [x] **PH1-02** Category admin UI: tree view + side editor, product counts, "uncategorized" handling
- [x] **PH1-03** Attribute definitions: name + type (text, number, select, multi-select, boolean, date) + optional units
- [x] **PH1-04** Attribute **sets**: group attributes, assign set(s) to category → products in that category inherit fields — _includes the **admin UI** for attribute definitions + sets (one Attributes page): PH1-03 shipped the definitions backend only (scope decision, 2026-10-05)_ — shipped 2026-10-05: `attributeSets` table + CRUD, `attributes.forCategory` inheritance resolver, definitions delete guard, `/catalog/attributes` page + sidebar group
- [x] **PH1-05** Storefront-ready indexes: category path/products-by-category, attribute filters index — _shipped 2026-10-05: `categories.urlPath` + `by_url_path` (tree-wide re-derivation after create/update/move, seed heals old rows); `productCategories` join (Convex indexes an array field as one whole-array value — "contains category X" needs a join table); `attributeValues` + typed `by_attribute_*` facet indexes (schema-first for PH1-07)_

### 1.2 Product master

- [x] **PH1-06** `products` table: name, slug, SKU, barcode, brand, short/long description (rich), status (draft/active/archived), taxCategory, track flags, warranty/shelf-life fields, UoM, images[], categoryIds[], attributeSetIds[] — _core identity/lifecycle fields (name, slug, SKU, status, categoryIds + indexes) + the table itself landed early with PH1-02 because its counts/uncategorized stats read it; this task adds the remaining fields and the SKU rules_ — shipped 2026-10-05: full field manifest (all optional so pre-PH1-06 rows keep reading) + `by_barcode`, `lib/sku.ts` format rules (scope call: rules module only — uniqueness enforced by PH1-07's mutations), `categories.remove` products-reference guard (the check promised in PH1-02)
- [x] **PH1-07** Product create/edit page: sections (Basic, Pricing, Attributes [dynamic from set — `attributes.forCategory` resolver shipped with PH1-04], Inventory/Tracking, Media, SEO), autosave draft, validation — _every write touching `categoryIds` must call `syncProductCategoryRows` in the same transaction (PH1-05's join; delete cleans `by_product` rows — PH1-15), and values rows go to `attributeValues` (PH1-05's typed columns); SKU validation = `validateSku`/`skuFormatError` from `lib/sku` (PH1-06) + org-wide uniqueness via `by_sku` `.unique()` at write — format errors surface verbatim like slug errors, no auto-derivation ever rewrites a typed SKU; product deletes must also run the PH1-06 category guard's inverse (clean `by_product` rows) and set every PH1-06 field explicitly (optional schema fields, writer always sends them)_ — shipped 2026-10-06: `catalog/products` get/create/update/remove (audited, permission-first), SKU verbatim + `by_sku` org-wide uniqueness, same-transaction `syncProductCategoryRows` on every `categoryIds` write, values full-replace diffed by value-key (absent arg = untouched), editor at `/catalog/products/new` + `/[id]` (sections, Tiptap sanitized at write, 1.5s autosave), `products.get` → null for missing ids, delete cleans `attributeValues.by_product`
- [x] **PH1-08** Product list: reactive table — filter by category/brand/status/flags, search by name/SKU/barcode, bulk status change, column sort — _one bounded full scan serves every combo (substring search over three fields can't ride an index; a Convex search index exposes one searchable field, so name/SKU/barcode would need merging — revisit if catalogs outgrow it), category filter reads `categoryIds` (PH1-05 source of truth), sort ties break on `_id` so pagination never reshuffles, page window clamps 1..200; bulk change is one transaction that resolves every id first and audits per CHANGED row_ — shipped 2026-10-06: `catalog/products:list` + `:brands` + `:bulkStatus` (audited, `catalog.edit`), list page at `/catalog/products` replacing the redirect stub (DataTable: debounced search, category/brand/status/flags filters, column sort, selection-gated bulk bar)
- [x] **PH1-09** Variants: option axes (from set attributes e.g. color/config) → variant matrix, per-variant SKU/price/barcode/track flags; product-level defaults fill variants — _axes are APPLICABLE Select attributes (same resolver the editor renders), matrix = cartesian product capped at 200 with the count named before any write; sync preserves exact-coordinate combinations with their edits, inserts new from product defaults, deletes orphans in ONE transaction — derived SKUs `<productSku>-TOKEN-TOKEN` (generation-time only; clash fails the whole reconcile naming the SKU), variant SKU unique org-wide ACROSS products+variants (a scan resolves one thing); matrix writes ride catalog.edit (rows are product-document entries); sync audits ONE product-level entry naming every removed row_ — shipped 2026-10-20: `variants` table + `catalog/variants:list|sync|update|remove`, option/type guards in `attributes.*`, variants page at `/catalog/products/[id]/variants` (axis chips, editable matrix, flags dropdown)
- [ ] **PH1-10** Pricing fields: `listPrice`, `costPrice` (display only — true moving average cost computed in inventory/finance), margin % shown to staff roles
- [ ] **PH1-11** Units of measure + conversions (each → box → case) with purchase/sales UoM — _base `unitOfMeasure` field landed with PH1-06; this task adds the conversions + doc-level UoM_
- [ ] **PH1-12** Track flags + fields per product: `serialTracked`, `lotTracked`, `expiryRequired`, `warrantyEligible`, `warrantyMonths`, `shelfLifeDays`, `allowBackorder` — _all seven fields landed with PH1-06 (names final); this task adds the rules/behavior (hard blocks, defaults, UI)_
- [ ] **PH1-13** Images via Convex storage (upload, reorder, cover image), alt text — _`images[]` field landed with PH1-06 (cover-first); this task adds the upload/reorder flow_
- [ ] **PH1-14** _(schema-first)_ `serials`, `lots` tables + helpers skeleton: serial state machine (available/reserved/shipped/returned/service/disabled), lot master (supplier, receivedDate, mfgDate, expiryDate, status: released/quarantined/recalled/expired) — with unit tests only
- [ ] **PH1-15** Product duplicate + archive (archived hidden from all pickers/storefront)

### 1.3 Warehouses & stock ledger

- [ ] **PH1-16** `warehouses` table + admin CRUD (code, name, address, isDefault, active)
- [ ] **PH1-17** `stockMovements` **append-only ledger**: type (receipt, issue, transferIn, transferOut, adjustment, reservation, release), qty (signed), product/variant, warehouse, lotId?, serialIds[], reference doc (type+id), unitCost at time of movement, actor, timestamp
- [ ] **PH1-18** Derived stock queries: `onHand(productId, warehouseId)`, `available = onHand − reserved`; per-warehouse stock list with valuation placeholders
- [ ] **PH1-19** Reservation engine: `reserve/release/allocate` helpers operating transactionally inside order mutations; over-reservation impossible (test proves it)
- [ ] **PH1-20** Manual stock adjustment: reason codes (damage, count correction, write-off, found), qty +/- , optional photo note; role-gated
- [ ] **PH1-21** Stock transfer workflow: draft → in-transit (goods out of source) → received (goods in dest); partial receipts; in-transit visible report
- [ ] **PH1-22** Generic goods receipt (manual intake with reference note) — PO-linked receiving lands in Phase 2
- [ ] **PH1-23** Inventory UI: stock list (filter warehouse/category/low-stock), product stock detail (ledger history + reserves), transfers pages, adjustments page
- [ ] **PH1-24** Reorder points per product(+warehouse) + daily low-stock cron → notification
- [ ] **PH1-25** Stock correctness test suite: multi-warehouse scenario (receive → transfer → reserve → issue → adjust) asserts ledger sums == on-hand; concurrent reservation test

---

## 4. Phase 2 — Sales & Procurement (O2C + P2P documents)

**Goal:** The full document flows with correct stock effects. Financial postings are **prepared as journal intents** (table + hook), consumed in Phase 3.
**Exit criteria:**

- [ ] Manual O2C run end-to-end: Quote → SO → Delivery → Invoice (+ Return/Credit Note) with stock moving correctly
- [ ] Manual P2P run end-to-end: Requisition → PO → Receipt → Bill (+ Payment intent), with 2/3-way match visibility
- [ ] Pricing engine resolves list/group/contract/volume prices identically for staff and (future) storefront
- [ ] Doc-flow navigation works across linked documents; all PDFs generate

### 2.1 Business partners (master data)

- [ ] **PH2-01** `customers`: company + contacts, addresses (bill/ship-to, default flags), payment terms, tax group, currency, credit limit, account status, notes timeline
- [ ] **PH2-02** Customer groups/tiers (Retail, Wholesale, Institutional) with assigned customers
- [ ] **PH2-03** `vendors`: contacts, addresses, terms, currency, tax/license fields (license number, jurisdiction, expiry — enforced Phase 5), active status
- [ ] **PH2-04** Product↔Vendor links: preferred vendor, vendor SKU, last purchase price (auto-updated on receipt)
- [ ] **PH2-05** Admin UIs for customers/vendors: list, detail (with related docs), create/edit, statement summary

### 2.2 Pricing engine

- [ ] **PH2-06** `priceLists` (base list) + `customerGroupPrices` + `customerPrices` + `quantityBreaks` (min qty → price) + date-ranged promotions hook
- [ ] **PH2-07** **`resolvePrice(customerId, productId|variantId, qty, date, currency)`** — one function, deterministic precedence: customer-specific → group → list; volume break applies last; rounding rules documented
- [ ] **PH2-08** Price override on a document line: manual price/discount with reason; if beyond threshold → flags `needsApproval` (basic two-person confirm now; full rules engine Phase 6)
- [ ] **PH2-09** Pricing UI: price list manager, per-customer price table, quantity-break editor; margin preview on sales lines
- [ ] **PH2-10** Pricing test matrix (customer tiers × qty breaks × overrides) locked in CI

### 2.3 Sales documents (Order-to-Cash)

- [ ] **PH2-11** `quotes`: lines, discounts, tax, validity date, notes, status (draft/sent/accepted/rejected/expired), PDF output, convert → SO (carry lines/prices)
- [ ] **PH2-12** `salesOrders`: draft → confirmed (stock **checked + reserved**) → fulfilling → invoiced → closed/cancelled; line-level fulfillment; partial shipment support; backorder flag per line
- [ ] **PH2-13** SO screen: header (customer, ship-to, terms, channel: manual/storefront), lines with live pricing + availability, actions bar (confirm, deliver, invoice, cancel), doc-flow breadcrumb
- [ ] **PH2-14** `deliveries` (packing slips): pick list view (grouped by warehouse), pack confirmation, ship (date, carrier, tracking #) → **goods issue** posts `stockMovements` (issue) + captures unit cost → journal intent `cogs` created
- [ ] **PH2-15** Delivery PDF (packing slip) + printable pick list
- [ ] **PH2-16** `salesInvoices`: generate from SO/delivery (line pricing snapshot, tax breakdown), statuses (draft/posted/paid/void), number from sequence, PDF; posted → journal intent `salesInvoice`
- [ ] **PH2-17** `creditNotes` for returns/adjustments: links to invoice, posts journal intent `creditNote`, restock decision
- [ ] **PH2-18** `salesReturns`/RMA-lite: return request (from invoice/order, lines + qty + reason) → receive (inspect: restock / quarantine / write-off) → credit note or exchange
- [ ] **PH2-19** Order desk dashboard: open orders, to-pick, to-ship, to-bill, returns pending (reactive tiles)

### 2.4 Procurement documents (Procure-to-Pay)

- [ ] **PH2-20** `requisitions` (internal): lines, need-by date, requester, status (draft/approved/rejected) → convert to PO _(simple threshold: role-gated approve; rules engine Phase 6)_
- [ ] **PH2-21** `purchaseOrders`: lines, agreed price, tax, expected date, status draft → sent → partiallyReceived → received → billed; PDF; send action (print/PDF now; email when Phase 4 wires Resend)
- [ ] **PH2-22** `goodsReceipts` against PO: partial receipts, qty accepted/rejected, auto stock receipt movement + unit cost → moving-average update hook; _(capture serials/lots — fields exist, dedicated UI Phase 5)_
- [ ] **PH2-23** `vendorBills`: record from PO (pre-filled, **2/3-way match view**: ordered vs received vs billed with tolerance warnings) or standalone; status open → matched → paid (payment Phase 3); journal intent `vendorBill`
- [ ] **PH2-24** Purchase returns to vendor: link receipt lines → stock out movement → debit note reference
- [ ] **PH2-25** Procurement dashboard: open POs, overdue deliveries, receipts pending, bills pending match

### 2.5 Cross-cutting

- [ ] **PH2-26** **Journal intent table** (`journalIntents`): every operational event that must post writes an intent (type, amount lines, source doc, period) — Phase 3 posting engine consumes them; backlog never lost
- [ ] **PH2-27** Doc-flow UI component: linked-document breadcrumb (quote ⇄ SO ⇄ delivery ⇄ invoice ⇄ payment) used across documents
- [ ] **PH2-28** PDF service module: shared template kit (company header/logo, tables, totals, footer) — reused by quotes/POs/invoices/deliveries
- [ ] **PH2-29** O2C + P2P integration tests: full happy path + exceptions (partial delivery, price variance, return) assert stock + intents

---

## 5. Phase 3 — Finance (double-entry)

**Goal:** The ledger that makes everything real: automatic postings, AR/AP, reports an accountant trusts.
**Exit criteria:**

- [ ] Automated scenario test: run O2C + P2P → **trial balance balances**, P&L/Balance Sheet/Cash Flow generate
- [ ] Period close locks entries; posted docs immutable (reversal only)
- [ ] AR/AP aging + statements correct; payments applied; tax report by period
- [ ] Accountant review pack (journal CSV export) produced

### 3.1 Ledger core

- [ ] **PH3-01** `accounts` chart: seeded default template (asset/liability/equity/income/expense, codes, parents), CRUD + activate/deactivate, account mapping settings screen
- [ ] **PH3-02** `journalEntries` + `journalLines` (append-only): debit==credit enforced in mutation, source doc ref, user, memo, period; reversal entries (never edit/delete)
- [ ] **PH3-03** Fiscal `periods`: open/close/lock per month; posting validates period is open
- [ ] **PH3-04** **Posting engine**: consumes `journalIntents` (from Phase 2) → maps event type → accounts via settings → writes balanced entries; retry + error surfacing (dead-letter view)
- [ ] **PH3-05** Auto-posting matrix implemented & tested: sales invoice (AR / revenue / tax payable), credit note (reverse), goods issue (COGS / inventory asset), goods receipt (inventory asset / GR-IR clearing), vendor bill (GR-IR / expense-or-inventory / AP), customer payment (cash / AR), vendor payment (AP / cash), adjustments, discounts
- [ ] **PH3-06** **Moving average cost** engine: updated on receipt; issues priced at current MAC; inventory valuation report per warehouse/category

### 3.2 Receivables & payables

- [ ] **PH3-07** Customer payments: record (full/partial/unapplied cash), apply to invoices, over/under payment handling, receipts PDF/print, journal posting
- [ ] **PH3-08** AR views: open invoices, aging (30/60/90+), customer statement, overdue list; _(dunning emails → Phase 6)_
- [ ] **PH3-09** Vendor payments: pay bills (full/partial), payment runs, AP aging, vendor statement view
- [ ] **PH3-10** Deposits/down-payments on sales orders (receive deposit → apply to final invoice)
- [ ] **PH3-11** Bank/cash accounts: create accounts, record transfers, **basic bank reconciliation** (import statement lines manually/CSV → match to entries → reconcile)

### 3.3 Tax & currency

- [ ] **PH3-12** Tax postings from documents (tax payable/receivable accounts per rate), **tax report**: collected vs paid by period, by rate — CSV export
- [ ] **PH3-13** Multi-currency postings: transaction-date exchange rate, base-currency ledger values, realized FX gain/loss on settlement

### 3.4 Reports & close

- [ ] **PH3-14** Report engine on maintained aggregates (daily rollup cron + on-post increments — no full scans): **Trial Balance, General Ledger detail, Profit & Loss, Balance Sheet, Cash Flow** — period pickers, compare columns, drill to journal lines
- [ ] **PH3-15** Period close checklist UI: open items (unclosed intents, unmatched payments), close period button, reopen (Owner only) with audit
- [ ] **PH3-16** Accountant export: journal + trial balance CSV; document the mapping of every automated posting
- [ ] **PH3-17** Finance test suite: intent → posting mapping, period locking, immutability/reversal, aging math, FX settlement — all in CI

---

## 6. Phase 4 — Ecommerce Storefront (B2C + B2B)

**Goal:** A fast, SEO-friendly store sharing the same database: guest checkout at list price, B2B accounts at contract price.
**Exit criteria:**

- [ ] Test-mode Stripe payment succeeds end-to-end; stock + reservation update live; ERP sees the order instantly
- [ ] B2B user sees contract prices, can submit PO-number orders and RFQs
- [ ] SEO checks pass (meta, sitemap, structured data); transactional emails arrive

### 4.1 Storefront foundation

- [ ] **PH4-01** `(store)` layout: Untitled UI-based header (logo, search, nav by top categories, cart, account), footer, responsive mobile nav
- [ ] **PH4-02** Home page: hero/banner slots, featured categories, featured/new products (admin-configurable selections)
- [ ] **PH4-03** Category page: grid/list product cards, **facets** (brand, price range, in-stock, category attributes), sort (price/popularity/newest), pagination, mobile filter drawer
- [ ] **PH4-04** Product detail: gallery, variant selector (price/stock per variant), specs table from attribute set, description, stock badge, quantity, add-to-cart, breadcrumbs, SEO meta + JSON-LD
- [ ] **PH4-05** Search: Convex keyword search over name/SKU/brand/attrs — instant dropdown + results page with filters
- [ ] **PH4-06** Static/content pages (About, Terms, Privacy) — minimal CMS tables with rich text
- [ ] **PH4-07** SEO plumbing: dynamic sitemap, robots, canonical, OG images, RSS optional

### 4.2 Cart & checkout (B2C)

- [ ] **PH4-08** Cart: guest (cookie) + logged-in carts (merge on login), add/update/remove with **live price resolution + stock check**, line errors (out of stock)
- [ ] **PH4-09** Cart drawer + cart page: subtotal, tax estimate (ERP tax engine), shipping estimate, coupon field
- [ ] **PH4-10** Checkout flow: contact → shipping address (validation, saved addresses) → shipping method → payment → review; abandoned-guest supported (no account required)
- [ ] **PH4-11** **Stripe integration**: PaymentIntent via Convex action, webhook handler (signature-verified) → payment status; refunds on cancellation (staff action)
- [ ] **PH4-12** Order placement mutation: creates `salesOrder` (channel=storefront, guest customer link or account) → validates stock → reserves → captures payment → confirmation page + order number
- [ ] **PH4-13** Customer accounts: register/login (same auth), profile, address book, order history (status + tracking), invoice/PDF download, re-order button

### 4.3 B2B portal

- [ ] **PH4-14** Company B2B accounts: `companies` with multiple users, buyer roles, assigned customer record → **contract pricing applies on login** (resolvePrice)
- [ ] **PH4-15** B2B checkout options: PO number field, "pay on terms" (credit) gated by credit limit + approval hold vs card payment; company addresses/ship-to selection
- [ ] **PH4-16** B2B self-service: order history & reorder, saved lists/wishlists, saved carts, invoices & statements download
- [ ] **PH4-17** **RFQ flow**: "Request quote" from cart/product → creates ERP `quote` → staff responds → customer accepts → converts to order (payment/terms on invoice)
- [ ] **PH4-18** Account approval: new B2B company signup → admin approves → notify

### 4.4 Commerce growth & comms

- [ ] **PH4-19** Promotions: coupon codes (%/fixed/free-shipping), auto category/product sales (date-ranged), usage limits; validated in cart + checkout
- [ ] **PH4-20** Shipping methods config: flat rate, free-over-threshold, weight/zone tables; per-warehouse stock routing decision (which warehouse ships)
- [ ] **PH4-21** Stock messaging: in-stock/low-stock/backorder badges, "notify me" capture → notification when stock arrives
- [ ] **PH4-22** Related products / frequently bought together (manual rules per product/category)
- [ ] **PH4-23** **Resend + React Email**: templates — welcome, order confirmed, payment received, shipped (with tracking), quote sent/accepted, password reset; staff notification emails
- [ ] **PH4-24** Ecommerce safety: rate limits on checkout/auth, inventory double-sell guard test, webhook idempotency

---

## 7. Phase 5 — Traceability & Service (serial / lot / warranty)

**Goal:** Activate the compliance schema: unit-level histories, FEFO with hard blocks, recalls in minutes, warranty & repair operations.
**Exit criteria:**

- [ ] Recall drill: pick a lot → full forward/backward trace + customer list exported in minutes
- [ ] Expired/quarantined lot provably cannot be sold (test proves block)
- [ ] Serial → warranty status lookup works for customers and staff
- [ ] Service order → parts issue → invoice flow complete

### 5.1 Serial operations

- [ ] **PH5-01** Serial receiving UI: against PO receipt / transfer / manual intake — batch scan/paste entry, validation (dupes blocked), attaches to stock
- [ ] **PH5-02** Serial assignment at delivery pick (auto FEFO/oldest or manual scan); released serials on return
- [ ] **PH5-03** Serial detail page: full lifecycle timeline (received → reserved → shipped → returned → service → disabled), current holder/customer
- [ ] **PH5-04** Serials search page (scan input, lookup by number) for support staff

### 5.2 Lots, expiry & FEFO

- [ ] **PH5-05** Lot creation on receipt (supplier, mfg/expiry dates), lot list with qty/warehouse/status; split/merge lots (basic)
- [ ] **PH5-06** **FEFO allocation**: pick suggestions ordered by earliest expiry; delivery allocation records which lot shipped
- [ ] **PH5-07** **Hard blocks**: mutations reject expired / quarantined / recalled lot allocation (tests included); min-remaining-shelf-life rule per customer optional
- [ ] **PH5-08** Expiry dashboard: short-dated stock (30/60/90-day buckets), daily expiry cron → notifications; write-off action from expired lots
- [ ] **PH5-09** Quarantine stock status + returns-to-stock inspection workflow (quarantine → inspect → release/reject)

### 5.3 Traceability & compliance

- [ ] **PH5-10** **Traceability report**: enter lot or serial → backward (supplier receipt + docs) / forward (every delivery + customer) with CSV/PDF export (**recall pack**)
- [ ] **PH5-11** Recall mode: mark lot/serial batch "recalled" → blocks sales → affected-customers list + recovery status (recovered qty per customer)
- [ ] **PH5-12** Customer license enforcement: for categories flagged "license-required", block shipment when customer license missing/expired (schema from PH2-03) + pre-expiry alerts

### 5.4 Warranty & service

- [ ] **PH5-13** Warranty registration: auto-register serials sold (start = delivery date, months from product) + manual registration page; public "Check warranty" lookup by serial
- [ ] **PH5-14** Warranty claims: claim intake (customer, serial, issue) → status flow (submitted → inspecting → approved/rejected → repair/replace/refund) linked to original order; parts/labor cost captured
- [ ] **PH5-15** **Service/repair orders**: job intake (equipment, customer, issue, accessories logged), statuses (received → diagnosing → awaiting parts → repaired → ready → delivered), parts issued from stock, labor lines, **invoice on completion** (links sales invoice)
- [ ] **PH5-16** Service dashboard: open jobs, SLA age, warranty vs billable split; workload view

### 5.5 Scanning

- [ ] **PH5-17** Camera barcode/QR scanning component (works on phone): scan → lookup product/serial/lot; used in receive, pick, stock count, service intake

---

## 8. Phase 6 — Depth, Automation & Hardening (go-live)

**Goal:** The polish that makes it production-grade: configurable approvals, deeper reports/automation, performance, security, ops.
**Exit criteria:**

- [ ] Approval rules configurable and enforced; reports dashboards populated
- [ ] Performance + security review passed; observability live; backups tested
- [ ] E2E smoke covers O2C, P2P, checkout; operator docs published; go-live checklist signed

### 6.1 Approvals & automation

- [ ] **PH6-01** Approval rules engine: rules by document type + condition (amount, discount %, credit override) → approver role/user; approval inbox + approve/reject with comment; audit
- [ ] **PH6-02** State-machine automations: auto-cancel stale unpaid orders (configurable days), auto-confirm store orders, auto-release held B2B orders after approval
- [ ] **PH6-03** Dunning/overdue automation: scheduled reminder emails (T+7/T+30), overdue digest to finance
- [ ] **PH6-04** Reorder suggestions engine: usage-rate × lead time → suggested PO lines (accept → requisition)
- [ ] **PH6-05** Webhooks/outgoing API keys: events (order.created, stock.changed) → external endpoints (future POS/couriers)

### 6.2 Inventory & procurement depth

- [ ] **PH6-06** Cycle counting: count sheet generation (by warehouse/ABC), count entry, variance → approval → adjustment posting
- [ ] **PH6-07** Blanket/contract POs + auto-replenishment; drop-ship flow (vendor → customer direct)
- [ ] **PH6-08** Vendor performance report: on-time %, price variance, return/defect rate
- [ ] **PH6-09** Purchase RFQ: send to multiple vendors, compare quotes, convert winner to PO

### 6.3 Finance depth

- [ ] **PH6-10** Fixed assets-lite: register, straight-line depreciation schedules → monthly journal posting
- [ ] **PH6-11** Budget vs actual by account/department; variance report
- [ ] **PH6-12** Multi-currency revaluation of open AR/AP → unrealized gain/loss posting
- [ ] **PH6-13** Bank statement import mapping rules (per-bank CSV column presets)

### 6.4 Reporting, CRM & UX

- [ ] **PH6-14** Executive dashboard v2: revenue/margin trends, cash position, top products/customers, aging, stock health, channel split (ERP vs store)
- [ ] **PH6-15** Reports library: sales by product/category/customer/period, rep performance, procurement spend, ecommerce funnel + channel attribution; scheduled CSV/email digests
- [ ] **PH6-16** CRM lite+: lead/opportunity pipeline (kanban), convert → quote; activities/tasks with reminders; notes timeline on accounts
- [ ] **PH6-17** Saved views/filters per user (tables), global search expansion (docs + serials + lots)
- [ ] **PH6-18** CSV/XLSX importers: products, customers, vendors, **opening balances** (migration tool)
- [ ] **PH6-19** Storefront reviews/ratings (moderated), recently-viewed, personalization basics
- [ ] **PH6-20** Custom fields on products/customers (P2, if demanded) + feature toggles per role

### 6.5 Quality, security & ops

- [ ] **PH6-21** Performance pass: index audit (every query indexed), Convex read/cost monitoring, storefront caching/ISR where safe, image optimization
- [ ] **PH6-22** Security review: permission-matrix audit across all mutations, secrets handling, rate limits, webhook signatures, dependency audit
- [ ] **PH6-23** Observability: error tracking (Sentry), Convex usage alerts, uptime checks, structured logging for actions
- [ ] **PH6-24** E2E suite (Playwright): login, O2C flow, P2P flow, checkout with Stripe test cards, warranty lookup
- [ ] **PH6-25** Deployment hardening: prod Convex + Vercel, custom domain, staging env, backup/restore drill documented
- [ ] **PH6-26** Operator documentation: per-module user guides (screenshots) + admin setup guide
- [ ] **PH6-27** Go-live checklist & sign-off (data migration, tax/account mapping validated by accountant, smoke tests, monitoring green)

---

## 9. Continuous track (every phase)

- [ ] **CT-01** Status Board updated at every session end; checkboxes accurate
- [ ] **CT-02** CI green (typecheck/lint/tests) before marking any task done
- [ ] **CT-03** Demo seed data extended as new modules land (always runnable demo)
- [ ] **CT-04** Design QA pass vs Untitled UI (spacing/typography/dark mode spot checks)
- [ ] **CT-05** Research doc cross-check: no P0 feature left unassigned to a phase
- [x] **CT-06** Session log: brief entry (what shipped, decisions, next up) appended to §12

---

## 10. Dependency map (what blocks what)

```
Phase 0 (auth/RBAC/settings/audit)
   └─► Phase 1 (catalog, stock ledger, serial/lot schema)
          ├─► Phase 2 (quotes, orders, POs, bills) ── journal intents
          │      └─► Phase 3 (postings, AR/AP, reports) ── real money data
          │             └─► Phase 4 (storefront checkout on live orders/prices)
          └─► Phase 5 (serial/lot workflows — schema from Phase 1)
                   (can start after Phase 2; parallel with Phase 3/4)
Phase 6 needs Phases 1–5 features to polish; runs last.
```

---

## 11. Backlog / Icebox (explicitly not in phases)

_Move into a phase only via explicit re-prioritization._

- Multi-company / multi-tenant consolidation · POS terminals · EDI & punchout (Ariba/Coupa)
- Full QMS (CAPA, 21 CFR Part 11 e-signatures) · cold-chain IoT sensor capture
- Service contracts/AMC recurring billing · field technician scheduling
- Sales commissions/consignment · email sync (Gmail/Outlook) · campaign mailing lists
- e-invoicing national formats · custom report builder · AI assists (copywriting, margin anomaly alerts)
- Native mobile apps · multi-storefront channels · blog/content calendar

---

## 12. Session log

### 2026-10-05 · Phase 0 finish line (PH0-25 → PH0-35)

**Shipped**

- Numbering sequences (11 canonical docs, `formatSequence`/`nextSequence`),
  audit trail (`auditedMutation` + viewer), file storage with avatars,
  notification bell, company settings, document-numbering UI, currency
  settings, tax engine config (rates/groups/category explainer),
  locale+timezone formatting prefs, idempotent demo seed (`npm run seed`),
  and the PH0-35 mutation sweep. **Phase 0: 35/35, gate ☑.**
- Suite grew to 92 tests (17 files); CI green (typecheck/lint/format/test/build).

**Decisions**

- Audit `redact()` masks bare `code` keys — payload keys were renamed
  (`currency`, `label`) rather than weakening the redactor.
- Exactly one default tax group: promoting one demotes the others in the same
  transaction, and the demoted ids ride inside the audit payload.
- Formatting prefs = one global `settings` row (key `formatting`),
  session-gated read like `organization:get`; the locale drives numbers too.
- Seed is Owner-only and strictly additive (never overwrites your org/
  currencies/roles); invite URLs appear only in the mutation result — never
  in the audit trail. `inviteUser` extracted to `_lib/invites.ts` (shared
  with `invites.create`).
- Sweep conventions: a local `require*` identity helper counts as a gate;
  audit exemptions are a reasoned allowlist that also fails when stale.

**Next up:** Phase 1 — Catalog & Inventory core (schema-first), PH1-01.

### 2026-10-05 · Phase 1 kick-off (PH1-01)

**Shipped**

- Category tree backend: `convex/catalog/categories.ts`
  (`list`/`create`/`update`/`move`/`remove`) + `categories` schema table
  (adjacency list, `by_slug` + `by_parent_position` indexes), shared
  `lib/slug.ts` helper, and the PH0-35 sweep now recurses into domain
  folders (`convex/catalog/…`). **Phase 1: 1/25.**

**Decisions**

- Slugs are globally unique: omitted → derived from the name with a
  `-2/-3…` suffix on collision; provided → normalized, errors on
  collision. `update` keeps the slug when it's omitted (renames never
  change URLs); `""` re-derives from the current name.
- Depth/paths are computed on read — never stored — so reparents can't
  leave stale breadcrumbs. Max depth 6 (root = 1); `move` rejects cycles
  and deep-subtree violations, clamps position, and renumbers every
  touched sibling set 0..n-1 in the same transaction.
- `list` returns the whole tree unpaginated — bounded config data like
  sequences/taxRates (pagination would break tree assembly).
- Delete is blocked while subcategories exist; the products-reference
  check lands with PH1-06.

**Next up:** PH1-02 — Category admin UI (tree view + side editor).

### 2026-10-05 · Category admin UI (PH1-02)

**Shipped**

- `/catalog` (redirect) + `/catalog/categories`: tree card (collapse via
  computed paths, per-row product counts, hidden indicator, add-child) and
  a persistent side editor — create/edit with live slug suggestion, parent
  select (self/descendants excluded), position Up/Down, two-step delete
  confirm, SEO fields. View-only roles get a read-only summary panel;
  pinned "Uncategorized" row under the tree. **Phase 1: 2/25.**
- `categories:stats` query (catalog.view): per-category counts +
  uncategorized bucket in one round trip.
- `products` table core (name/slug/sku/status/categoryIds +
  `by_slug`/`by_sku`/`by_status`) landed here because the counts read it —
  PH1-06 completes the table with the remaining fields (noted in §1.2).
- Demo seed extended (CT-03): 5 categories + 7 products incl. one
  uncategorized and one archived → the page shows real numbers on a
  fresh `npm run seed`.

**Decisions**

- Counts include draft+active, exclude archived (hidden everywhere per
  PH1-15), and count a product in several categories in each; nothing
  left → `uncategorized`. Stats full-scan `products` — one bounded admin
  read, same rationale as the unpaginated tree.
- Sidebar stays flat (`/catalog` → redirect) until Products (PH1-08)
  takes the index route; no nav changes this task.
- Reparent from the editor = `update` + `move`: two audited entries
  (field edit + explicit tree move) rather than doubling move logic into
  `update`.
- `tests/rateLimit.test.ts` lock test: explicit 20s timeout — 11
  password-hash round trips trip vitest's 5s default under 18 parallel
  workers (load-sensitive flake; logic untouched).

**Next up:** PH1-03 — Attribute definitions (name/type/units).

### 2026-10-05 · Attribute definitions (PH1-03)

**Shipped**

- `attributeDefinitions` schema table (name, 6-value type union, optional
  unit, `options[]`, `by_name` index) + `convex/catalog/attributes.ts`
  (`list`/`create`/`update`/`remove` — catalog matrix, audited).
  **Phase 1: 3/25.**
- Server-side shape rules: unit only on `number` (≤ 50 chars), options
  only on `select`/`multi_select` (≥ 1 after trimming, ≤ 100 chars each,
  ≤ 100 total, case-insensitive dedupe, admin order preserved); explicit
  errors for cross-type payloads. 12-test suite + HTTP E2E (23 checks —
  normalization, exact RBAC messages, no-op unrecorded, audit snapshots).

**Decisions**

- Scope: backend only per the task text (PH1-16-style tasks say "admin
  CRUD" when they mean UI); Phase 1 had no attribute-UI task, so **PH1-04
  was amended to include the Attributes admin page** (definitions + sets
  together) — user's call.
- `options[]` ships with the definition even though the task text lists
  only name/type/units: select types are unusable without their choice
  list (PH1-07 product editor and PH1-09 variant axes both need it).
- No slug/key field — identity is the document id; add a machine key only
  if PH1-05's filter index proves it needs one.
- `update` is full-form (omitted unit/options clear) matching the
  category editor; arrays compared element-wise so no-op saves stay
  unrecorded. Type changes are free-form until PH1-07 stores product
  values (narrowing may then need a guard). Delete's "still used by a
  set/product" check noted for PH1-04/PH1-07.

**Next up:** PH1-04 — Attribute sets + the Attributes admin UI.

### 2026-10-05 · Phase 1 (PH1-04)

**Shipped**

- `attributeSets` table (name, ordered `attributeIds`, `categoryIds`,
  `by_name` + `by_category` array index) + `convex/catalog/attributeSets.ts`
  (list/create/update/remove): names 1-100 trimmed, id lists deduped
  first-wins with existence checks, full-form update (omitted lists clear)
  and element-wise no-op detection so unchanged saves record nothing,
  catalog permission matrix, every write audited.
- `attributes.forCategory` (catalog.view) — the inheritance resolver:
  union of every set covering the category, set-name order then each set's
  own attribute order, deduped, returned as full definition rows for the
  PH1-07 product editor; unknown category → clear error.
- `attributes.remove` now runs PH1-03's promised reference check: blocked
  while any set lists the definition ("used by N attribute set(s) — remove
  it there first"), freed once the set drops it.
- **Attributes admin UI**: `/catalog/attributes` — Definitions card (name,
  option count, type badge) + Attribute sets card (attribute/category
  counts) + persistent side panel (create/edit; view-only roles get a
  read-only facts panel; two-step delete; type picker shows unit only for
  number and the options textarea only for select family). Sidebar Catalog
  became a group (Categories, Attributes) following the Settings pattern,
  `NAV_MODULES` keys added for both children.
- `lib/schemas/attributes.ts` zod (name/type/unit/one-per-line options)
  with `ATTRIBUTE_TYPES` + labels shared by form and lists; seed (CT-03)
  adds Weight (number/kg), Color (select: Black/Silver), Dimensions (text)
  grouped as "Physical specs" → ultrasound-systems — idempotent re-run.
- Verified: tsc/lint/format green, **123 tests / 20 files** (+8), HTTP
  E2E 30 checks (seed idempotency, inheritance order + dedupe, reference
  guard round trip, no-op unrecorded, exact RBAC messages, audit
  snapshots) + SSR 200 / anon → login.

**Decisions**

- **Assignment lives on the SET** (`attributeSets.categoryIds`), not on
  categories: single-document edits give one clean audit snapshot, deleting
  a set takes its assignments with it (no orphan cleanup — categories never
  point at sets), and `by_category` serves the covering-sets lookup. It also
  avoids adding a required field to existing category documents (Convex
  validates reads → old rows would break until backfilled).
- Inheritance order: set name order → the set's own `attributeIds` order,
  first-wins dedupe. The panel's checkbox lists (definitions in name order)
  are the display order — reordering UI can come later if a task asks.
- Sidebar: Catalog grew children once it had 2+ pages (the flat `/catalog`
  link was a placeholder until Products takes the index in PH1-08 — the
  `/catalog` → Categories redirect stays).
- `forCategory` resolves a single category id; if PH1-07 needs one call for
  multi-category products it widens then (bounded config data either way).

**Next up:** PH1-05 — storefront-ready indexes.

### 2026-10-05 · Phase 1 (PH1-05)

**Shipped**

- **Category path index**: `categories.urlPath` (stored URL string,
  "/parent/child/", root-level "/slug/") + `by_url_path` — the storefront
  resolves a whole URL in one indexed hit and scans a branch's subtree by
  prefix. `syncUrlPaths` re-derives every row's path after
  create/update/move (a slug rename or reparent rewrites the whole
  descendant chain in the same transaction); the field is optional so
  pre-PH1-05 rows keep reading — the next write or a seed run heals them
  (the dev DB's hand-created `it-equipments` row got its path that way).
  Storefront phase queries: `eq(urlPath, url)` exact, `gte/lt` prefix range.
- **Products-by-category**: `productCategories` join table
  (by_category, by_product) + `syncProductCategoryRows` helper
  (`convex/_lib`) — see the Convex finding below; reconciles rows both
  ways (insert missing, delete orphans) and returns the insert count.
  Seed (CT-03) reconciles every product after the demo loop → 7 demo join
  rows on first run, 0 on re-runs.
- **Attribute filters index**: `attributeValues` table — one row per
  (product, attribute, value); multi-select stores one row per option;
  exactly one typed value column per definition type (`valueText` /
  `valueNumber` / `valueBoolean` / `valueDate`) — schema-first for
  PH1-07's editor. Indexes: `by_product` (spec sheet) and four typed
  `by_attribute_*` = attributeId range prefix + value narrowing, which is
  what research §4.7 P0's faceted filter ("Color = Black", "Weight ∈
  [3,5]") scans. Empty until PH1-07 writes rows.
- `attributeSets` lost its `by_category` index (PH1-04 comment claimed it
  served the covering-sets lookup — the finding below disproves that);
  `attributes.forCategory`'s by_name scan + JS filter stands.
- Verified: tsc/lint/format green, **129 tests / 21 files** (+6: urlPath
  materialization, rename/reparent freshness, legacy-row heal, join sync
  round trip, typed facet ranges), HTTP E2E 19 checks + SSR 200 /
  anon → login.

**Decisions**

- **Convex can't index "array contains"** — an index on an array field
  sorts by the WHOLE array value, so it only matches arrays equal to /
  starting with a given array (Convex's own guidance: "you can't index an
  array" → use a join table). That corrects the plan's assumption that
  `.index("by_category", ["categoryIds"])` would serve category pages:
  `productCategories` is the index, `products.categoryIds` stays the
  source of truth (stats/display), and **PH1-07 must write both in the
  same transaction** (noted on the task line). Same finding backs the
  separate `attributeValues` table instead of a values array on the
  product, and resolves PH1-04's open question: facets key on
  `attributeId`, so definitions need no machine key.
- Materializing `urlPath` revises PH1-01's "never stored" for the URL
  string only — the admin breadcrumb `path` (Id[]) stays computed on
  read. Staleness (the original concern) is prevented by re-deriving the
  whole tree on every structural/slug write and proven by tests; the
  payoff is O(1) URL resolution + prefix subtree scans instead of
  slug-lookup + parent walk on every storefront request.
- Optional field (not required) so no backfill step is needed: absent
  values sit under the index's null key (PH1-06 finding — they ARE
  indexed, just sorted before real values), so `eq()` lookups on real
  values skip un-healed rows — invisible to `by_url_path` until healed.
- `categories:stats` keeps its single JS pass over products — the
  uncategorized bucket needs an empty-array scan that `by_category`
  (now `productCategories`) can't provide anyway, and the table is
  bounded config data.

**Next up:** PH1-06 — products table, remaining fields + SKU rules.

### 2026-10-05 · Phase 1 (PH1-06)

**Shipped**

- **Products table completed**: `barcode` (+ `by_barcode`), `brand`,
  `shortDescription`/`longDescription` (rich HTML, sanitized at write),
  `taxCategory` (strict union of the PH0-24 `taxGroups.rates` keys —
  standard/reduced/zero — plus exempt), the seven PH1-12 track fields
  (`serialTracked`, `lotTracked`, `expiryRequired`, `warrantyEligible`,
  `warrantyMonths`, `shelfLifeDays`, `allowBackorder`), `unitOfMeasure`,
  `images[]` (cover-first file ids), `attributeSetIds[]` (product-level
  sets beyond the category-inherited ones). Every new field is OPTIONAL —
  documents written before this task keep reading; writers always set
  them (contract noted on PH1-07). Field → later task map lives in the
  schema comment; PH1-11/12/13 lines annotated so those tasks don't
  re-create fields.
- **SKU rules** (`lib/sku.ts`): `normalizeSku` (trim + uppercase ONLY —
  identifiers are never silently rewritten, unlike slugs), `skuFormatError`
  (3–32 chars, letters/digits plus `- . / _` between alphanumeric ends,
  exact user-facing message per rule), `validateSku` (one-call entry
  point). Uniqueness stays the write-time half — `by_sku` `.unique()` in
  PH1-07's mutations (same split as category slugs).
- **`categories.remove` products-reference guard** (the check PH1-02
  promised): blocked while any product's `categoryIds` lists the
  category — "assigned to N product(s)" with singular/plural wording;
  archived/draft count too so membership never dangles; children guard
  still fires first; blocked deletes record no audit entry.
- Verified: tsc/lint/format green, **141 tests / 23 files** (+12: SKU
  rules, full-manifest round trip + minimal-row reads + taxCategory enum
  - barcode index semantics, two guard scenarios), HTTP E2E 12 checks +
    SSR 200 / anon → login.

**Decisions**

- **Scope (user's call): rules module only** — no product CRUD in this
  task; `lib/sku.ts` is the canonical format spec, enforcement arrives
  with PH1-07's mutations (annotated on that line).
- All new fields optional (not defaulted-required): Convex validates
  reads against the schema, so a required field would break the seven
  existing product documents (and the seed that reads them) until
  backfilled — and a backfill mutation can't find rows it can't read.
  Optional costs `?? false` / `?? []` at read time; the writer-always-
  sets-them contract keeps new rows complete.
- **Index finding (corrects a PH1-05 note):** a missing optional field
  IS indexed — under a null key that sorts before every real value — so
  `eq(value)` lookups never match blank rows, but a full index scan
  returns them, blanks first. Proven in `tests/products.test.ts`
  (`by_barcode` full scan); schema + the PH1-05 log wording updated.
- The delete guard scans `categoryIds` (source of truth) rather than the
  `productCategories` join: the join is a derived read model and could be
  stale for direct writes; deletes are rare and the table is bounded
  until import tooling, so correctness beats the index here.
- Guard order: children first, then products (a parent category with
  products reports its subcategories — E2E covers the overlap case).

**Next up:** PH1-07 — product create/edit page + product mutations.

### 2026-10-06 · Phase 1 (PH1-07)

**Shipped**

- **Product mutations** (`convex/catalog/products.ts`): `get` returns
  `{product, attributes, values}` in one call — the row, its applicable
  attributes (set-inheritance order), and its stored value rows; malformed
  or missing id → `null` (typo URLs get "not found", not the error
  boundary). `create`/`update`/`remove` are `auditedMutation` with
  `requirePermission("catalog", …)` first; remove deletes the
  `attributeValues` `by_product` rows (the PH1-06 guard inverse) and the
  `productCategories` join via `syncProductCategoryRows`, same transaction.
- **SKU enforced at write**: `validateSku`/`skuFormatError` messages
  verbatim (like slug errors), org-wide uniqueness via `by_sku` — the
  uniqueness probe normalizes (trim + uppercase) for LOOKUP only and never
  re-derives a typed SKU; blank/whitespace names rejected.
- **`categoryIds` contract**: every write runs `syncProductCategoryRows`
  in the same transaction (create + update; seed already did), and the
  writer sets every PH1-06 field explicitly — new rows are complete while
  pre-PH1-06 rows keep reading (`?? false` / `?? []` at compare time).
- **Values → typed columns**: `attributeValues` present = full replace,
  diffed by value-key (attributeId + typed value) so unchanged entries
  keep their row ids; absent = stored rows untouched. Entries validate
  against the NEW `categoryIds` + `attributeSetIds` ("One of those
  attributes isn't assigned to this product." / option-membership
  messages); `attributes.update` (type changes) and `attributes.remove`
  are blocked while value rows exist.
- **Slug resolver extracted** to `convex/_lib/slugs.ts`:
  `resolveUniqueSlug(isTaken, name, provided, noun)` probe API — categories
  pass an array probe, products probe `by_slug` (unbounded rows, so
  `.first()` + explicit message, never `.unique()`); the `noun` param keeps
  exact per-entity messages ("A product with slug … already exists.").
  Product slug is KEPT when omitted (passed as `currentSlug`), re-derived
  only when blank.
- **Editor UI**: `/catalog/products/new` + `/catalog/products/[id]`
  (`product-editor` shell: queries, permission branches, not-found;
  `product-form`: Basic / Pricing / Attributes (dynamic from set via shared
  `lib/attributes.ts` `orderApplicableAttributes` — same order on client
  and server) / Inventory & Tracking / Media / SEO sections, ProductFacts
  view-only), Tiptap WYSIWYG sanitized server-side at write
  (`lib/richText.ts`), 1.5 s debounced autosave with a quiet schema gate;
  create-mode first save does `history.replaceState` (no remount → caret
  survives) then continues as an update. `/catalog/products` stub hands off
  to `/new` until PH1-08; sidebar Products entries added.
- **Seed**: 6 demo `attributeValues` rows (3 attrs × 2 ultrasound products)
  so the editor, spec tables, and later facets render real data.
- Verified: tsc/lint/format green, **160 tests / 25 files** (+16:
  `productCrud` 14 + `richText` + seed count), HTTP E2E **37 checks**
  (SSR gating both directions, SKU verbatim + org-wide dup, slug `-2`
  suffix, sanitize-at-write, applicable attributes, values replace /
  absent-arg / no-op via `updatedAt`, move + option guards, RBAC, remove
  cleanup).

**Decisions**

- **HTTP/E2E findings** (session resumed after a power loss killed the dev
  processes): Convex function paths use SLASHES for nested modules —
  `catalog/products:create`, colon only between root module and function
  (`auth:signIn`); ConvexError messages arrive clean in `errorData` while
  `errorMessage` wraps them in "[Request ID …] Server Error" + stack;
  SSR checks must sign in through `POST /api/auth` so BOTH auth cookies
  are set — a lone access-token cookie makes @convex-dev/auth's middleware
  null the request cookies (`refreshTokens === null` → forwarding step)
  and the route reads as signed-out.
- **Streamed redirect accepted**: `/catalog/products` → `/new` answers 200
  with a `NEXT_REDIRECT;replace;…;307` flight digest instead of an HTTP
  Location, because `(admin)/loading.tsx` commits 200 before the page
  renders (Next 16's documented mid-stream fallback — identical to
  PH1-02's `/catalog` stub). The E2E asserts the digest and target.
- Update compare treats legacy flag rows as `false` (`?? false`) and
  compares arrays element-wise; no-op saves return `audit: undefined`, so
  `updatedAt` and the audit log both stay untouched (proven in E2E).
- `products.get` takes `v.string()` id rather than `v.id` so a malformed
  URL segment resolves to `null` (404 branch) instead of throwing a
  validation error.
- Values are replaced as rows (an edited value = a new row id); typed
  columns are written explicitly per entry, so facet indexes stay exact.

### 2026-10-06 · Phase 1 (PH1-08)

**Shipped**

- **List query** (`catalog/products:list`): one bounded full scan,
  filtered and sorted in memory — same "bounded admin read" rationale as
  `categories.stats` (PH1-02) and the audit filters (PH0-26); search is a
  case-insensitive trimmed substring over name/SKU/barcode (an index can't
  serve that, and a Convex search index exposes ONE searchable field —
  name/SKU/barcode would need three queries merged; revisit if catalogs
  outgrow this). Filters: category via `categoryIds` (source of truth, not
  the join — we already hold every row, so a stale join can't hide a
  product from staff), brand exact, single status, flags with AND
  semantics. Sort keys name/sku/brand/status/updatedAt, default newest
  first, `_id` ascending tiebreak so bulk-stamped equal `updatedAt` values
  never reshuffle pages; `limit` clamps to 1..200 (default 50).
  `catalog/products:brands` = distinct non-empty brands for the dropdown
  (full scan — brands live on the product row, nothing to index).
- **`bulkStatus`**: same `catalog.edit` ladder as `update`. Every id
  resolves BEFORE any patch — a vanished product fails the whole batch, so
  a selection can never half-apply; duplicates dedupe first; rows already
  in the target status keep their `updatedAt` and record nothing (PH0-30).
  Audit is ONE entry per CHANGED row (`auditedMutation`'s single-entry
  shape can't name a batch — wrapper returns `audit: undefined`, handler
  calls `appendAudit` per row with `{status}` before/after).
- **List page** (`/catalog/products`) replaces the PH1-07 redirect stub:
  DataTable with a 300 ms debounced search input, category (indented) /
  brand / status selects, a flags dropdown (Check-marked multi-select),
  column sort, server-side page window (Load more grows `limit`), rows →
  editor (Link in the primary cell for keyboard + `onRowClick` for
  pointer), and a selection-gated bulk bar (Set active / Set draft / Set
  archived → "N set to X · M already X" toast, error toast via
  `toUserMessage`) rendered only with `catalog.edit`. Filter/search/sort
  changes rewind the window and clear the selection so bulk actions can't
  target rows the user can't see.
- Verified: tsc/lint/format green, **169 tests / 26 files** (+9:
  `productList` — gating, search ×3 fields, every filter + intersection,
  sort order/stability, brands facet, bulk audit/no-op/permission/dead-id
  cases), HTTP E2E **41 checks** (SSR stub replaced, list semantics over
  the wire, per-row audit snapshots, RBAC, cleanup).

**Decisions**

- **HTTP/E2E finding**: the admin shell streams `(admin)/loading.tsx` and
  children hydrate client-side — a static fetch of an (admin) page never
  contains page copy, so the "stub replaced by the list" assertion rides
  the flight payload instead: `app/(admin)/catalog/products/page.tsx
[app-client]` present AND no `NEXT_REDIRECT;replace;/catalog/products/new`
  digest.
- The page keeps Convex's `useQuery` (not `usePaginatedQuery`): filters +
  sort require materializing the match set anyway, so the query returns
  `{rows, total, hasMore}` for the current window and "Load more" grows
  the limit — no opaque cursors to invalidate when a filter changes.
- Status filter is single-select (All/Active/Draft/Archived) and category
  filter is direct membership (the stats counts PH1-02 reports) — subtree
  "include descendants" can come later with the storefront facet work.
- Sidebar/nav unchanged: `/catalog` still redirects to Categories (the
  PH1-04 note's promise); Products entries already pointed at the index.

### 2026-10-20 · Phase 1 (PH1-09)

**Shipped**

- **`variants` table** (schema): one row per option combination of the
  product's `variantAxisIds` — `optionValues` pins one option per axis
  (attributeId + stored label), plus SKU/barcode/listPrice and the five
  track flags. Combination uniqueness within a product can't ride an index
  (the PH1-05 array finding), so it's enforced in JS with a canonical key
  (coordinates sorted by attributeId+value — axis ORDER doesn't matter).
  Indexes: `by_product` (matrix page), `by_sku` (scan identity),
  `by_barcode`. No status field — variants inherit product lifecycle
  (PH1-15's archive revisits per-variant states).
- **`catalog/variants:sync`** (`catalog.edit`, audited): validates axes
  against the SAME `applicableAttributes` resolver the editor renders from
  (Select-typed, non-empty options, assigned to the product), then
  reconciles the whole matrix in ONE transaction: exact-coordinate
  combinations are PRESERVED with their per-variant edits, new ones are
  inserted with product-default flags and a derived SKU
  `<productSku>-TOKEN-TOKEN` in axis order (the 32-char cap trims the
  product part; the suffix always survives), orphans are deleted. The
  cartesian count is computed and capped (200) BEFORE any write; a derived
  SKU clash — in-batch, with any product/variant, even the parent itself —
  fails the whole reconcile naming the SKU. Empty axes = "clear the
  matrix" (a deliberate full-form operation).
- **Audit shape**: `sync` returns ONE product-level entry (a matrix is a
  product-document operation) whose after-snapshot carries the new axes,
  the count, and the identity (SKU + coordinates) of every removed row —
  deletions stay reconstructable without 200 per-row entries.
  `update`/`remove` snapshot the single row like other editors; no-op
  saves record nothing (PH0-30).
- **`catalog/variants:update`** (full form, `catalog.edit`): SKU validated
  with `validateSku` verbatim + uniqueness in ONE namespace shared with
  PRODUCTS (`by_sku` probes both tables — a scan must resolve to exactly
  one thing, parent SKU included); barcode same trim/64-cap as products
  (no uniqueness — the PH1-06 call); `listPrice: nullable` (null clears);
  the five flags explicit. `variants:remove` also rides `catalog.edit` —
  rows are matrix entries of a product document, and `sync` deletes
  orphans under the same ladder; `catalog.delete` keeps guarding whole
  products.
- **Guards extended** (`attributes.ts`): option removal, type change, and
  definition removal are blocked while variants pin the definition (the
  same "explicit beats an orphaned matrix" reasoning as the PH1-07 value
  guard); `products.remove` deletes variant rows in the same transaction.
- **UI**: `/catalog/products/[id]/variants` — axis chips (applicable
  Select attributes with option counts + live combination preview vs the
  200 cap), "Save axes & regenerate" (result toast), and the matrix table
  (axis badges, SKU/barcode/price committing on blur, flags dropdown);
  `catalog.view`-only roles get the same table read-only. A "Variants"
  button in the product editor header links here once the product exists.

**Pipeline**: prettier → tsc → lint → format:check → **183 tests / 27
files** (+14 `variants`) → build → **HTTP E2E 30/30** (own fixtures,
cleaned up: generation + defaults + derived SKUs, shared SKU namespace,
verbatim errors, option/type guards, regeneration preservation, row
remove, audit visibility, delete cascade, SSR flight stub).

**Next up:** PH1-10 — pricing fields (`listPrice`/`costPrice`, display-only
margin).

| Date       | Session         | Shipped (task IDs) | Decisions / notes                                                                                                          | Next up                            |
| ---------- | --------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-10-04 | Plan created    | —                  | Research doc + development plan aligned with scoping decisions                                                             | Start Phase 0 (PH0-01…)            |
| 2026-10-05 | Phase 1 start   | PH1-01             | Category tree backend; global unique slugs, computed paths, guarded moves                                                  | PH1-02 (category admin UI)         |
| 2026-10-05 | Phase 1 (cont.) | PH1-02             | Category admin UI + stats; products core landed early (PH1-06 note); demo catalog seed (CT-03)                             | PH1-03 (attribute definitions)     |
| 2026-10-05 | Phase 1 (cont.) | PH1-03             | Attribute definitions backend (type/unit/options shape rules); admin UI folded into PH1-04 (plan amended)                  | PH1-04 (attribute sets + admin UI) |
| 2026-10-05 | Phase 1 (cont.) | PH1-04             | Attribute sets + `forCategory` inheritance resolver + Attributes admin UI; definitions delete guard                        | PH1-05 (storefront indexes)        |
| 2026-10-05 | Phase 1 (cont.) | PH1-05             | urlPath + by_url_path, productCategories join (Convex: no array-contains index), attributeValues facets                    | PH1-06 (products table fields)     |
| 2026-10-05 | Phase 1 (cont.) | PH1-06             | Products field manifest + by_barcode, lib/sku rules, categories.remove products guard; null-key finding                    | PH1-07 (product editor)            |
| 2026-10-06 | Phase 1 (cont.) | PH1-07             | Product editor + CRUD: SKU verbatim + by_sku uniqueness, same-txn join sync, values diff, E2E 37 checks                    | PH1-08 (product list)              |
| 2026-10-06 | Phase 1 (cont.) | PH1-08             | Product list: bounded-scan list query + brands facet + bulkStatus (per-changed-row audit), E2E 41 checks                   | PH1-09 (variants)                  |
| 2026-10-20 | Phase 1 (cont.) | PH1-09             | Variant matrices: cartesian sync w/ preserve-by-coordinate + derived SKUs, SKU namespace shared w/ products, E2E 30 checks | PH1-10 (pricing fields)            |
