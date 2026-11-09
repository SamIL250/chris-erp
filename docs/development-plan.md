# Development Plan — ERP + Ecommerce (Phased Build)

> **Companion to:** [`erp-research-and-features.md`](./erp-research-and-features.md) (research, decisions, feature priorities)
> **Stack:** Next.js (App Router) · Convex · Untitled UI (components + icons) · Stripe · Resend · Tailwind v4
> **Status:** Phase 2 🔨 in progress — integration tests (29 / 29, Sales & Procurement)
> **Last updated:** 2026-11-09

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
| **Phase 1**    | Catalog + Inventory core (schema-first)            | ✅ Complete    | 25 / 25 | ☑    |
| **Phase 2**    | Sales & Procurement (O2C + P2P documents)          | 🔨 In progress | 29 / 29 | ☐    |
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

- [x] Full product catalog maintainable (categories, attributes, variants, images) — _archive hides a product from pickers and the storefront without deleting it; duplicate makes a draft copy (PH1-15)_
- [x] Stock per warehouse provably correct under test (receipts, issues, transfers, adjustments) — _PH1-25: one scenario walks receive → transfer → reserve → issue → adjust and checks each warehouse's ledger sum against on-hand. A removal that would eat a hold is refused and writes nothing_
- [x] `onHand` vs `available` (reserved) distinction working; low-stock alerts firing — _available is on-hand minus the hold (PH1-18), and the same suite keeps them apart after every step. Low stock notifies once per dip below the reorder point (PH1-24)_
- [x] Serial/lot/expiry/warranty **tables exist** with tests around helpers (UI waits for Phase 5) — _warranty is not a third table: registration is `warrantyStart` + `warrantyMonths` on `serials`, and `warrantyLookup` answers valid/expired/none (PH1-14)_

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
- [x] **PH1-10** Pricing fields: `listPrice`, `costPrice` (display only — true moving average cost computed in inventory/finance), margin % shown to staff roles — _prices optional, finite, 0..MAX_PRICE (999999999.99 typo guard in `lib/pricing`, one cap shared with the variant price); cost is display-only (the moving-average cost arrives with inventory/finance) and margin derives at READ time (`marginPercent`, one decimal, negative margins shown not hidden — selling below cost is real); margin/cost are staff-side only: the storefront (PH4) must project listPrice alone; product `listPrice` is the variant override's display fallback (PH1-09 note, resolvePrice formalizes in PH2-07); prices ride the commercial audit snapshot + full-form no-op diff_ — shipped 2026-10-20: `listPrice`/`costPrice` on `products` (create/update validation, audit snapshot, update diff), `lib/pricing.ts` (MAX_PRICE + marginPercent), Pricing section in the editor filled (two inputs + live margin readout, negative in error color), facts panel rows, variants matrix price cell falls back to the product price, demo seed prices, 10 new tests → 193 total, E2E 19 checks
- [x] **PH1-11** Units of measure + conversions (each → box → case) with purchase/sales UoM — _base `unitOfMeasure` field landed with PH1-06; this task adds the conversions + doc-level UoM_ — shipped 2026-11-05: per-product conversion CHAINS (`1 unit = factor × parent`, every chain terminating at the base — no global catalog: pack sizes are per-product by nature) + `purchaseUoM`/`salesUoM` doc-level defaults (must be the base or a conversion unit, so PH2 lines can always convert to base stock); codes normalize trim+lowercase (1–16, letters/digits + `.`/`-`) — one vocabulary across base/chain/doc fields; `lib/uom.ts` is the single validator+message source shared by the editor's build gate and the mutation (sku pattern); conversion rows diff as an ORDER-INSENSITIVE key set (reorder = no-op, no audit) and land in the audit snapshot; Inventory section gained the row editor (parent choices = base + other units, can't construct dangling chains) + doc-level selects; demo seed gives every product `unitOfMeasure: "each"` and the Lab Bench Stand the full chain
- [x] **PH1-12** Track flags + fields per product: `serialTracked`, `lotTracked`, `expiryRequired`, `warrantyEligible`, `warrantyMonths`, `shelfLifeDays`, `allowBackorder` — _all seven fields landed with PH1-06 (names final); this task adds the rules/behavior (hard blocks, defaults, UI)_
- [x] **PH1-13** Images (upload, reorder, cover image, alt text) — _`images[]` landed with PH1-06 as cover-first file ids; this task is the upload/reorder flow. **Decision (this phase): asset bytes live in Cloudinary, not Convex storage.** The `files` row stays the registry (`cloudinaryPublicId` + a permanent `url`); legacy Convex-storage rows still resolve through `resolveFileUrl`. `products.images` is `{ fileId, alt }[]` (index 0 = cover); `lib/images` is the alt rule (≤ 255, blank = decorative) shared by the editor and `products.create`/`update`; the Media gallery uploads with a signed direct POST, reorders, and defers deletion until the save succeeds_
- [x] **PH1-14** _(schema-first)_ `serials`, `lots` tables + helpers skeleton: serial state machine (available/reserved/shipped/returned/service/disabled), lot master (supplier, receivedDate, mfgDate, expiryDate, status: released/quarantined/recalled/expired) — with unit tests only — _shipped 2026-11-08: tables + indexes, `lib/serials` / `lib/lots` (transitions, date order, effective expiry, warranty lookup). No public mutations — Phase 5 owns the workflows_
- [x] **PH1-15** Product duplicate + archive (archived hidden from all pickers/storefront) — _shipped 2026-11-08: `products.duplicate` (catalog.create) copies fields, categories, attribute values, images, and variants into a draft with a derived SKU/slug and no barcode; `products.picker` and the default list omit archived (`isPickerListed`); drafts stay in staff pickers and off the storefront (`isStorefrontListed`); editor Archive / Restore and Duplicate buttons_

### 1.3 Warehouses & stock ledger

- [x] **PH1-16** `warehouses` table + admin CRUD (code, name, address, isDefault, active) — _shipped 2026-11-08: `warehouses` (code unique, uppercase), exactly one default, inactive rows stay listed, default can't be dropped or deactivated until another takes the flag; `/inventory/warehouses` (inventory.view/create/edit/delete). Product list shows the cover image_
- [x] **PH1-17** `stockMovements` **append-only ledger**: type (receipt, issue, transferIn, transferOut, adjustment, reservation, release), qty (signed), product/variant, warehouse, lotId?, serialIds[], reference doc (type+id), unitCost at time of movement, actor, timestamp — _shipped 2026-11-08: `stockMovements` insert-only (`post` is the only writer; a correction is a new line). Sign is fixed by type in `lib/stock` (in/hold > 0, out/release < 0, adjustment ≠ 0). On-hand ignores holds; reserved is reservation + release. A variant product must name its variant; an inactive warehouse takes no new lines; named serials are one unit each and their status is not changed here_
- [x] **PH1-18** Derived stock queries: `onHand(productId, warehouseId)`, `available = onHand − reserved`; per-warehouse stock list with valuation placeholders — _shipped 2026-11-08: `stock.balance` and `stock.byWarehouse` (inventory.view). On-hand sums physical lines, reserved sums reservation + release, available is the difference. `value` is on-hand × the latest physical unit cost, rounded to the cent — a placeholder until moving-average cost (PH3-06). No lines is a zero balance; a warehouse list only includes products that have moved there_
- [x] **PH1-19** Reservation engine: `reserve/release/allocate` helpers operating transactionally inside order mutations; over-reservation impossible (test proves it) — _shipped 2026-11-08: `reserveStock` / `releaseStock` / `allocateStock` take the caller's mutation context (not `ctx.runMutation`) and read lines already written in that transaction. Quantity is a positive amount; the helper writes the ledger sign. A reserve cannot exceed available at that product, variant, and warehouse. Release and allocate cannot exceed what that document still holds, and allocate posts the release and the issue together so the hold ends as the units leave on-hand. Public `reserve` / `release` / `allocate` are `inventory.create` and audited — sales calls the helpers from the order mutation after its own permission check. A thrown transaction keeps none of the hold_
- [x] **PH1-20** Manual stock adjustment: reason codes (damage, count correction, write-off, found), qty +/- , optional photo note; role-gated — _shipped 2026-11-08: `stock.adjust` (`inventory.approve` — warehouse, admin, owner). Damage and write-off are negative, found is positive, a count correction may go either way and never zero. A removal cannot take on-hand below what is still reserved. The note is optional (blank stored as absent, 500 characters); the photo is an existing image file. The raw `post` action refuses type `adjustment`, so a count change always carries a reason. No adjustments screen yet — that is PH1-23_
- [x] **PH1-21** Stock transfer workflow: draft → in-transit (goods out of source) → received (goods in dest); partial receipts; in-transit visible report — _shipped 2026-11-08: `transfers.create` / `update` / `cancel` (draft only) / `ship` / `receive`, plus `get`, `list`, and `inTransit` (`inventory.view`). Ship posts a transfer-out for every line and drops source on-hand; a receipt posts a transfer-in for the quantity that arrived and leaves the document in transit until every line is complete. A ship that does not fit the free stock rolls back. Numbers come from the new `TR-` sequence. No transfers screen yet — that is PH1-23_
- [x] **PH1-22** Generic goods receipt (manual intake with reference note) — PO-linked receiving lands in Phase 2 — _shipped 2026-11-08: `goodsReceipts.create` (`inventory.create`) posts the document and one ledger receipt per line in the same transaction. The reference note is required (delivery note, opening balance). Number is `GRN-`. A bad line rolls the whole intake back. No purchase order, no draft, no edit — a correction is another movement. `get` and `list` are `inventory.view`. The receiving screen is PH1-23; receiving against a PO is PH2-22_
- [x] **PH1-23** Inventory UI: stock list (filter warehouse/category/low-stock), product stock detail (ledger history + reserves), transfers pages, adjustments page — _shipped 2026-11-08: `/inventory` opens the stock list. Filters are warehouse, category, and low stock, which until PH1-24 means nothing available to promise. A row opens the product at that warehouse: on-hand, reserved, available, the placeholder value, the reservation lines, and the ledger. Transfers list defaults to the in-transit report; a draft can be shipped and received in part. Adjustments post through `stock.adjust` (`inventory.approve`) with a reason, a note, and an optional photo. The manual receipt screens landed here too, since PH1-22 left them for this task_
- [x] **PH1-24** Reorder points per product(+warehouse) + daily low-stock cron → notification — _shipped 2026-11-08: a point sits on the product, and a warehouse row overrides it there (`reorderPoints.set` / `clear`, `inventory.edit`). Low stock is available at or below that point; a slice with no point is never low, and an inactive warehouse is skipped. The stock list filter is “Below reorder point”. The daily job at 06:00 UTC notifies active inventory editors once per dip and again only after the slice has risen above the point. The stock-correctness suite is PH1-25_
- [x] **PH1-25** Stock correctness test suite: multi-warehouse scenario (receive → transfer → reserve → issue → adjust) asserts ledger sums == on-hand; concurrent reservation test — _shipped 2026-11-08: `tests/stockCorrectness.test.ts`. Ten received at MAIN, four transferred and received at EAST, three reserved there, two issued at MAIN, one written off as damage. After every step the balance query matches an independent sum of the ledger, and a further write-off that would take the hold is refused. Two reservations started together both stick when they fit, and exactly one sticks when they would oversell_

---

## 4. Phase 2 — Sales & Procurement (O2C + P2P documents)

**Goal:** The full document flows with correct stock effects. Financial postings are **prepared as journal intents** (table + hook), consumed in Phase 3.
**Exit criteria:**

- [ ] Manual O2C run end-to-end: Quote → SO → Delivery → Invoice (+ Return/Credit Note) with stock moving correctly
- [ ] Manual P2P run end-to-end: Requisition → PO → Receipt → Bill (+ Payment intent), with 2/3-way match visibility
- [ ] Pricing engine resolves list/group/contract/volume prices identically for staff and (future) storefront
- [ ] Doc-flow navigation works across linked documents; all PDFs generate

### 2.1 Business partners (master data)

- [x] **PH2-01** `customers`: company + contacts, addresses (bill/ship-to, default flags), payment terms, tax group, currency, credit limit, account status, notes timeline — _shipped 2026-11-08: a customer is a company. The code is unique, uppercased, and limited to letters, digits, and dashes. Status is active, on hold, or closed; there is no hard delete. Terms are 0–365 days (0 is due on receipt). Tax group and credit limit can be cleared, and the currency must be an active catalog code. The first contact is primary, and removing the primary promotes the oldest remaining contact. Bill-to and ship-to defaults are independent. Notes are append-only. `customers.create` is `sales.create`; the header, contacts, addresses, and notes are `sales.edit` (warehouse can edit, an accountant can only read). `list` / `get` / `options` are `sales.view`. `/sales` opens the customer list. Groups are PH2-02. Vendor screens, related documents, and the statement summary stay PH2-05_
- [x] **PH2-02** Customer groups/tiers (Retail, Wholesale, Institutional) with assigned customers — _shipped 2026-11-08: a company has one tier. The name is unique ignoring case. A group is deactivated, never deleted; companies already on it stay there, and a new assignment of an inactive tier is refused. `customerGroups.create` is `sales.create` (warehouse cannot open a tier). Rename and deactivate are `sales.edit`. `list` / `get` are `sales.view`, and `get` lists the assigned companies. Seed adds Retail, Wholesale, and Institutional when those names are missing. Prices for a tier wait for PH2-06_
- [x] **PH2-03** `vendors`: contacts, addresses, terms, currency, tax/license fields (license number, jurisdiction, expiry — enforced Phase 5), active status — _shipped 2026-11-08: a vendor is a company we buy from. The code is unique, uppercased, and limited to letters, digits, and dashes. Active is a flag; there is no hard delete, and an inactive vendor stays on file. Terms are 0–365 days (0 is due on receipt). Tax group, tax number, and the license fields can be cleared, and the currency must be an active catalog code. License number, jurisdiction, and expiry are stored; a past expiry is allowed, and Phase 5 (PH5-12) is what refuses an expired license. The first contact is primary, and removing the primary promotes the oldest remaining contact. Remit-to and ship-from defaults are independent, and the first address is both. `vendors.create` is `procurement.create` (warehouse can open a vendor; accountant and sales cannot). The header, contacts, and addresses are `procurement.edit` (accountant can edit; warehouse cannot). `list` / `get` / `options` are `procurement.view` (sales can read). `/procurement` opens the vendor list. Product links are PH2-04. Related documents and the statement summary stay PH2-05_
- [x] **PH2-04** Product↔Vendor links: preferred vendor, vendor SKU, last purchase price (auto-updated on receipt) — _shipped 2026-11-08: a product may name several vendors, and exactly one of those links is preferred. The first link is preferred. Removing the preferred one promotes the oldest remaining link. The vendor SKU is the supplier's code, optional, and kept in their casing. A new link to an inactive vendor is refused; one already on file may stay. Last purchase price is not typed. A goods receipt may name a vendor, and a line with a unit cost updates that product's existing link. A receipt does not create the link, and a line with no cost leaves the price alone. `productVendors.link` / `update` / `remove` are `catalog.edit` (sales can; warehouse and accountant cannot). `listForProduct` / `listForVendor` are `catalog.view`. The price write rides `goodsReceipts.create` (`inventory.create`). Deleting the product removes the links. Related documents and the statement stay PH2-05_
- [x] **PH2-05** Admin UIs for customers/vendors: list, detail (with related docs), create/edit, statement summary — _shipped 2026-11-08: list, detail, and create/edit shipped with PH2-01 and PH2-03. This task adds the statement on each company. A customer balance is invoices less credits and payments. Those documents are not posted yet, so the balance is zero, available credit is the limit minus that balance, and a missing limit is no cap. The document list is empty until quotes, orders, deliveries, and invoices exist. A vendor statement lists goods receipts that name them, newest first. A line with no unit cost is listed and adds nothing. The received total is the sum of the costed lines. Bills are not included. `customers.statement` is `sales.view`. `vendors.statement` is `procurement.view`. Aging and payments stay PH3-08 and PH3-09_

### 2.2 Pricing engine

- [x] **PH2-06** `priceLists` (base list) + `customerGroupPrices` + `customerPrices` + `quantityBreaks` (min qty → price) + date-ranged promotions hook — _shipped 2026-11-08: a price list holds product prices in one currency. The first list is the base, and naming another list the base clears the previous one. Unsetting the only base keeps it. Deactivating the base promotes the oldest other list; the only list stays the base when it is deactivated. A list is never deleted, and its currency cannot change once it has a price. A group price and a customer price are their own rows, one per product, variant, and currency. A new price on an inactive group or a closed customer is refused; a customer on hold can still be priced. A quantity break hangs off one of those prices, starts at a quantity of 2, and is removed with that price. A promotion stores a date window and may name the list in effect during it. Overlapping windows are both kept. Reads are `sales.view`. Every write, including a change or a removal, is `sales.create`, so warehouse cannot change a price. Deleting a product or a variant removes the prices that name it. Which row a sale uses is PH2-07. The manager screens are PH2-09_
- [x] **PH2-07** **`resolvePrice(customerId, productId|variantId, qty, date, currency)`** — one function, deterministic precedence: customer-specific → group → list; volume break applies last; rounding rules documented — _shipped 2026-11-08: `prices.resolvePrice` is `sales.view`. A customer price wins, then the customer's group price, then a list price. Inside a tier, a variant price beats the product price, and a higher tier with only a product price still beats a lower tier's variant price. Zero is a win. The list tier uses an active promotion whose window covers the UTC day of the date and whose list is active in the requested currency. The one that started latest wins; a tie goes to the one created latest. If that list has no price for the product, the next promotion is tried, then the active base list. A quantity break applies only to the row that won, and only the break with the greatest minimum the quantity still reaches. The catalog list price is last, and only in the company base currency. A variant's list price beats the product's. No match is a null unit price. The unit is rounded with `Math.round` to the currency's decimal places (a half rounds away from zero). A line amount rounds again after multiplying that unit by the quantity. A closed customer and an inactive group still resolve. A missing customer, product, variant, or currency is an error. Manual overrides stay PH2-08_
- [x] **PH2-08** Price override on a document line: manual price/discount with reason; if beyond threshold → flags `needsApproval` (basic two-person confirm now; full rules engine Phase 6) — _shipped 2026-11-08: a line may replace the resolved unit with a typed price, or take a percent off it. Both need a reason. The discount is how far the new unit sits below the resolved unit, after rounding, to two decimal places. Above 10% the row is `pending` and `needsApproval` stays set. A raise, or a discount at 10%, is applied immediately. A pending or rejected override still charges the resolved unit. A second person with `sales.approve` confirms it, and the person who asked cannot confirm their own. A rejection needs its own reason. There is one row per quote, order, invoice, or credit-note line; proposing again replaces it. The line tables arrive with the documents. Configurable approval rules stay PH6-01. The pricing screens stay PH2-09_
- [x] **PH2-09** Pricing UI: price list manager, per-customer price table, quantity-break editor; margin preview on sales lines — _shipped 2026-11-08: `/sales/prices` lists the price lists and the promotions that pick one. A list page edits the header and its product prices. A company page and a group page hold their own prices. A quantity break hangs off the price it replaces, from a quantity of 2. The sales-line panel asks `prices.linePreview` for the same winner `resolvePrice` would charge, then the line total and the margin against the product's display cost. A missing cost, or a unit that is not above zero, leaves the margin blank. Writes stay `sales.create`. An inactive list or group, or a closed customer, shows its prices and refuses a new one. Quote and order lines reuse the preview once those documents exist_
- [x] **PH2-10** Pricing test matrix (customer tiers × qty breaks × overrides) locked in CI — _shipped 2026-11-08: `tests/pricingMatrix.test.ts` walks a customer price, a group price, the base list, the catalog list price, and a product with no price, at quantities 1, 5, 7, and 10. A break applies only on the winning row: 5 and 7 take the break at 5, and 10 takes the break at 10. A promotion from last year that prices the product at 1 does not win. Each resolved unit is then crossed with no override, a 10% discount (applied at once), a 20% discount left pending, that discount approved, that discount rejected, and a typed raise. Pending and rejected keep charging the resolved unit. With no price, a percent off is refused and a typed price waits until a second person approves it. The sales-line preview matches `resolvePrice`, including the line total. An override does not change what `resolvePrice` returns. CI runs this file with the rest of the suite (`npm test`), so a cell that drifts fails the build. Quotes are PH2-11_

### 2.3 Sales documents (Order-to-Cash)

- [x] **PH2-11** `quotes`: lines, discounts, tax, validity date, notes, status (draft/sent/accepted/rejected/expired), PDF output, convert → SO (carry lines/prices) — _shipped 2026-11-08: a quote is a draft for one customer (`QT-`). A line prices through `resolvePrice` in the customer's currency and snapshots tax. A discount of 10% or less applies at once; above 10% it waits for a second person and the line keeps charging the resolved price. Send needs a line. Send and accept refuse a lapsed quote or a discount that is still pending. Status runs draft to sent to accepted, and draft or sent can be rejected or expired. Accept converts once into a draft sales order (`SO-`) that copies the charged lines and prices. The PDF is built in the browser. A customer's statement lists the quote and does not change the balance. Writes are `sales.create`, so warehouse cannot change a quote. Confirming the order is PH2-12_
- [x] **PH2-12** `salesOrders`: draft → confirmed (stock **checked + reserved**) → fulfilling → invoiced → closed/cancelled; line-level fulfillment; partial shipment support; backorder flag per line — _shipped 2026-11-08: confirming a draft reserves free stock at one warehouse (`sales.create`). A line that does not fit is flagged backorder and the order still confirms. `orders.reserve` (`sales.edit`) takes more when stock arrives. Shipping a reserved quantity allocates it — a release and an issue, with the latest unit cost on the issue — and the order moves to fulfilling. The rest of the line stays reserved, so a shipment can be partial. Invoice waits until every line has shipped, then the order can close. Cancel, until it is invoiced, releases whatever is still reserved; units that already left stay out. Warehouse can ship and top up a backorder, and cannot confirm, invoice, close, or cancel. The order page has those actions. The desk, with live pricing and the document trail, is PH2-13. A delivery note, carrier, and the COGS intent are PH2-14, and that ship must not issue these units again_
- [x] **PH2-13** SO screen: header (customer, ship-to, terms, channel: manual/storefront), lines with live pricing + availability, actions bar (confirm, deliver, invoice, cancel), doc-flow breadcrumb — _shipped 2026-11-08: the order page names the customer (and a hold or a closed account), the copied ship-to, the payment terms, and the channel. Staff orders are manual; storefront is reserved for the shop. Each line shows the charged unit, today's resolved price, the margin on the charged unit, and what is free and on hand at the order's warehouse. A draft previews the warehouse chosen for confirm. Confirm, deliver, invoice, and cancel stay the PH2-12 actions. The document trail is quote → order → delivery → invoice; delivery and invoice are named until those documents exist. The shared trail used on every document is PH2-27_
- [x] **PH2-14** `deliveries` (packing slips): pick list view (grouped by warehouse), pack confirmation, ship (date, carrier, tracking #) → **goods issue** posts `stockMovements` (issue) + captures unit cost → journal intent `cogs` created — _shipped 2026-11-08: the pick list groups reserved quantity by warehouse. Packing claims that quantity and does not move stock. Shipping records the date, carrier, and tracking number, posts one goods issue with the unit cost, and writes a pending `cogs` journal intent. A quantity that already left is not packed, so it is not issued again. The printable slip is PH2-15. Every other event writing an intent stays PH2-26_
- [x] **PH2-15** Delivery PDF (packing slip) + printable pick list — _shipped 2026-11-09: a packing slip downloads as a PDF from the delivery page, and the deliveries desk prints the pick list grouped by warehouse. Both are built in the browser. The slip names the order, the customer, the warehouse, the ship-to, and the quantity. A shipped slip also names the date, the carrier, and the tracking number. It does not print the unit cost. An empty pick list still downloads, and it says nothing is waiting. The shared template kit stays PH2-28_
- [x] **PH2-16** `salesInvoices`: generate from SO/delivery (line pricing snapshot, tax breakdown), statuses (draft/posted/paid/void), number from sequence, PDF; posted → journal intent `salesInvoice` — _shipped 2026-11-09: an invoice is drafted from quantity that has already shipped, on the order or on one delivery. The number is `INV-`. The charged price and the tax rate are copied from the order line, and the amounts are worked out for the quantity on the invoice. Draft can be posted or voided. Posting writes a pending `salesInvoice` journal intent and, once every line has shipped and been billed, marks the order invoiced. Paid is a status until a payment exists; it does not reduce the balance. A posted invoice is not voided here — a credit note is PH2-17. The PDF is built in the browser. Every other event writing an intent stays PH2-26_
- [x] **PH2-17** `creditNotes` for returns/adjustments: links to invoice, posts journal intent `creditNote`, restock decision — _shipped 2026-11-09: a credit note reduces a posted or paid invoice. The number is `CR-`. The charged price and the tax are copied from the invoice line for the credited quantity. A return may put the goods back in the order's warehouse, at the latest unit cost. An adjustment never does. Posting writes a pending `creditNote` journal intent and lowers the customer's balance. A draft can be voided. A posted note stays. The return request and the inspection are PH2-18_
- [x] **PH2-18** `salesReturns`/RMA-lite: return request (from invoice/order, lines + qty + reason) → receive (inspect: restock / quarantine / write-off) → credit note or exchange — _shipped 2026-11-09: a return is requested from a posted invoice or from an order that has shipped. The number is `RMA-`. Receiving inspects each line into the order's warehouse. Restock puts the goods back. Quarantine holds them. A write-off receipts them and removes them, so on-hand does not change. Credit posts one credit note and lowers the balance. Exchange opens a draft order at the charged price and does not reserve stock. Cancel is only while the return is still a request. The order desk tiles stay PH2-19_
- [x] **PH2-19** Order desk dashboard: open orders, to-pick, to-ship, to-bill, returns pending (reactive tiles) — _shipped 2026-11-09: `/sales` is the order desk. Five tiles read one query, so a pack, a shipment, an invoice, or a return moves the count. Open is not closed and not cancelled. To pick is reserved quantity that is not already on a packed slip. To ship is a packed slip. To bill is shipped quantity on an order that can still be invoiced, plus a draft invoice. A return stays pending until it is credited, exchanged, or cancelled. The procurement desk stays PH2-25_

### 2.4 Procurement documents (Procure-to-Pay)

- [x] **PH2-20** `requisitions` (internal): lines, need-by date, requester, status (draft/approved/rejected) → convert to PO _(simple threshold: role-gated approve; rules engine Phase 6)_ — _shipped 2026-11-09: a requisition is `REQ-`. The requester is the signed-in user. Warehouse can draft one. Approve and reject are `procurement.approve`, so warehouse, sales, and accountant cannot. The approver may be the requester. Rejected stays rejected. Convert runs once from approved and writes a draft `PO-` for an active vendor, copying the lines and the need-by date. Stock stays put. Sending, receiving, and billing that order stay PH2-21_
- [x] **PH2-21** `purchaseOrders`: lines, agreed price, tax, expected date, status draft → sent → partiallyReceived → received → billed; PDF; send action (print/PDF now; email when Phase 4 wires Resend) — _shipped 2026-11-09: a draft keeps the agreed price, the vendor's tax, and the expected date. Sending freezes that snapshot and marks the order sent. The PDF downloads in the browser. A receipt moves sent to partially received or received (PH2-22). A vendor bill marks a received order billed (PH2-23). Email waits for Phase 4_
- [x] **PH2-22** `goodsReceipts` against PO: partial receipts, qty accepted/rejected, auto stock receipt movement + unit cost → moving-average update hook; _(capture serials/lots — fields exist, dedicated UI Phase 5)_ — _shipped 2026-11-09: warehouse receives a sent order (`inventory.create`). Accepted quantity posts a stock receipt at the agreed price and stores the moving average. Rejected quantity is recorded and stays out of stock. The accepted total moves the order to partially received or received. A rejection-only receipt leaves the status. Serials and lots can be named on the line; the picker is Phase 5. A vendor bill stays PH2-23_
- [x] **PH2-23** `vendorBills`: record from PO (pre-filled, **2/3-way match view**: ordered vs received vs billed with tolerance warnings) or standalone; status open → matched → paid (payment Phase 3); journal intent `vendorBill` — _shipped 2026-11-09: a bill is `BILL-`. From a received purchase order it copies the accepted quantity and the agreed price. A standalone bill has no order. An open bill can be edited (`procurement.edit`). Match is `finance.post`. Billed quantity must equal received quantity. A unit price within 2% of the order passes; past that, match is blocked. Ordered versus received warns and does not block. Match writes one pending `vendorBill` intent and marks the linked order billed. Paid is never set. Recording a payment is Phase 3_
- [x] **PH2-24** Purchase returns to vendor: link receipt lines → stock out movement → debit note reference — _shipped 2026-11-09: a return is `DBN-`. It names receipt lines whose quantity entered stock. Warehouse posts it (`inventory.create`). Each line issues that quantity at the receipt's unit cost. The number is the debit note reference. Rejected quantity cannot be returned, and reserved stock stays. The receipt, the purchase order, and the vendor's received total stay as they were. A journal intent waits for PH2-26. The vendor's credit is Phase 3_
- [x] **PH2-25** Procurement dashboard: open POs, overdue deliveries, receipts pending, bills pending match — _shipped 2026-11-09: `/procurement` is the desk. Four tiles read one query, so a receipt or a matched bill moves the count. Open is not billed. Overdue is a sent or partly received order whose expected date is before today. Receipts pending is quantity still to accept on those orders. Bills pending match are open vendor bills. A received order with no bill is not in that queue. A billed order is in none of them_

### 2.5 Cross-cutting

- [x] **PH2-26** **Journal intent table** (`journalIntents`): every operational event that must post writes an intent (type, amount lines, source doc, period) — Phase 3 posting engine consumes them; backlog never lost — _shipped 2026-11-09: a goods receipt that puts stock on hand writes one pending `goodsReceipt` intent. A rejection-only receipt writes none. A purchase return writes one pending `debitNote` intent. A manual stock adjustment writes one pending `stockAdjustment` intent, and the amount keeps the sign. A missing unit cost is zero, so the event stays on the backlog. `/finance` lists the pending rows. Nothing there is posted. Payments and the posting engine stay Phase 3_
- [x] **PH2-27** Doc-flow UI component: linked-document breadcrumb (quote ⇄ SO ⇄ delivery ⇄ invoice ⇄ payment) used across documents — _shipped 2026-11-09: quote, order, delivery, invoice, credit note, and return share one trail. A missing delivery, invoice, or payment is still named. The open page is not a link. A credit, a return, or an exchange sits before payment when one exists. Payment has no document until Phase 3_
- [x] **PH2-28** PDF service module: shared template kit (company header/logo, tables, totals, footer) — reused by quotes/POs/invoices/deliveries — _shipped 2026-11-09: quotes, purchase orders, invoices, packing slips, and the pick list share one letterhead. It draws the company name, a PNG or JPEG logo when the file embeds, a column table, totals on a priced document, and the invoice footer on every page. A logo that will not embed is left off, and the PDF still downloads. A packing slip and a pick list still leave the unit cost off the page_
- [x] **PH2-29** O2C + P2P integration tests: full happy path + exceptions (partial delivery, price variance, return) assert stock + intents — _shipped 2026-11-09: one suite walks the public mutations. A quote for two ships in full, the invoice posts, stock goes to zero, and the goods-receipt, cost-of-goods, and sales-invoice intents stay pending. A quote for four ships one: the invoice is that one unit, the other three stay reserved, and a restocked return puts the unit back with a credit-note intent and no stock-adjustment intent. A requisition for two is received and matched, stock is those two, and the goods-receipt and vendor-bill intents stay pending. A unit price 3% off the order is refused; 2% matches and the bill intent uses that price. Returning one unit then issues stock at the receipt cost, and the order stays billed. Nothing is posted or marked paid_

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

### 2026-10-20 · Phase 1 (PH1-10)

Pricing fields landed — the two numbers staff enter today, and the one
number they read off them:

- **`products.listPrice` / `products.costPrice`** (both optional): the
  sell price becomes the variant override's DISPLAY FALLBACK (the PH1-09
  note — the matrix's price cell shows the product price when a row has
  no override; `resolvePrice` formalizes the chain in PH2-07); cost is
  DISPLAY-ONLY — the true moving-average cost is computed from stock
  receipts once inventory/finance exist, so nothing derives accounting
  numbers from it. Validation: finite, 0..MAX_PRICE (`lib/pricing.ts`,
  999999999.99 — a typo guard, not a pricing policy); NaN/Infinity ride
  the same "zero or more" error as negatives (Convex admits them, HTTP
  can't send them, a direct caller can).
- **Margin % is derived, never stored**: `marginPercent(list, cost)` in
  `lib/pricing.ts` — (list − cost)/list × 100 rounded to one decimal,
  `null` when a price is missing or the list price isn't positive (a
  giveaway has no meaningful rate), and NEGATIVE margins display as-is in
  the error color — selling below cost is real data, not something to
  hide. Staff-side only: the editor's live readout + the facts panel;
  the storefront (PH4) must project `listPrice` alone — noted in the
  schema comment so the PH4 queries can't leak cost/margin by accident.
- **Commercial snapshot + no-op diff**: prices join the audit
  before/after identity (they're commercial fields, like barcode/brand),
  participate in the full-form change detection (a price-only save is a
  real edit; an identical save records nothing — PH0-30), and omitted
  optionals clear like every other field.
- **UI**: the Pricing section placeholder (PH1-07 reserved it) is now
  live — list/cost inputs + a margin row that computes as you type;
  ProductFacts gains List price / Cost price / Margin rows; the variants
  matrix price cell shows the product default as the placeholder (edit)
  and in tertiary text with a "Product list price (default)" title
  (read-only). Demo seed products carry prices now (incl. one sold below
  cost — the legacy monitor — so the negative margin is visible in demo
  data).
- **One cap, one family**: the variant price guard gained the same
  MAX_PRICE cap (wording: "Variant price must be 999999999.99 or fewer.")
  so product and variant prices can't diverge at the edges.

**Pipeline**: prettier → tsc → lint → format:check → **193 tests / 28
files** (+10 `pricing`: margin math, create/update/no-op/clear, verbatim
guards, RBAC ladder; variants cap case added to the existing suite) →
build → **HTTP E2E 19/19** (own fixtures, cleaned up: prices round-trip,
guards verbatim, audit carries prices without margin, clear-on-omit,
warehouse reads/can't-edit, anonymous blocked, variant cap + override +
fallback, SSR editor page).

**Next up:** PH1-11 — units of measure + conversions (each → box → case).

### 2026-11-05 · Phase 1 (PH1-11)

Units of measure + pack-size conversions + doc-level UoM:

- **Per-product conversion CHAINS, no global catalog**: a product's BASE
  UoM (`unitOfMeasure`, "each" by convention) plus edges
  `1 unit = factor × parent` — "1 box = 12 each", "1 case = 6 box" —
  because pack sizes are per-product by nature (a box of gloves ≠ a box
  of monitors). Every chain must terminate at the base: no cycles, no
  duplicate units, no dangling parents, no unit converting to itself or
  to the base; factors finite, > 0, ≤ 1e9 (typo guard), at most 12 rows.
  `lib/uom.ts` holds every rule AND message, shared by the editor's
  build gate and the mutation — identical wording on both sides (the
  `lib/sku` pattern); rejection never writes an audit entry.
- **Codes normalize once**: trim + lowercase, 1–16 chars, letters/digits
  with "."/"-" separators — one vocabulary across base, chain units and
  doc-level UoMs. Unlike SKUs, UoM codes are case-insensitive vocabulary
  (not user identifiers), so silent normalization can't lose meaning.
- **Doc-level UoM** (`purchaseUoM`/`salesUoM`): defaults that will
  prefill PH2 purchase/sales document lines; each must be the base or a
  conversion unit, so a line can always convert to base stock. The
  LINE'S OWN UoM may differ — PH2 lines carry theirs and resolve through
  these edges (`conversionFactors`/`convertQuantity` land now as pure
  base-relative math for the stock/doc layers to build on).
- **Full-form semantics**: conversions ride `products.create`/`update`
  (no new mutation → no new gate; RBAC matrix unchanged); omitted
  optionals clear (`[]` for conversions); the update diff compares rows
  as an ORDER-INSENSITIVE key set (rows arrive normalized, one row per
  unit), so re-saving rows in a different order is still a no-op while a
  real change lands in the audit snapshot beside the doc-level UoMs.
- **UI**: the Inventory section gains the conversion row editor —
  `Unit / Factor / Converts to`, where parent choices are only the base +
  other rows' units (a fresh row can't construct a dangling chain, and
  new rows prefill parent = base) — plus Purchase/Sales UoM selects whose
  choices are exactly what's convertible. Cross-field validation runs in
  `buildProductArgs` (zod can't see the rows — sibling state like the
  attribute values), surfacing the shared messages through the
  save-error alert; ProductFacts renders "1 box = 12 each · 1 case = 6 box".
- **Demo data**: every seeded product carries `unitOfMeasure: "each"`;
  the Lab Bench Stand gets the full chain (box = 2 each, case = 5 box) +
  buy-by-case/sell-by-box. The seed skips existing SKUs, so the dev
  org's DEMO-* rows were healed through audited `products.update`
  (slugs passed explicitly — never re-derive them).

**Pipeline**: prettier → tsc → lint → format:check → **213 tests / 29
files** (+20 `uom.test`: code rules, chain validation incl. cycle/
dangling/dupe/self/base + factor guards + row cap, factor composition +
`convertQuantity`, doc-UoM membership, create round-trip with messy-code
normalization, verbatim guards, reorder-no-op + real-change before/after

- clear-on-omit) → build → **HTTP E2E 33/33** (own fixtures, cleaned up:
  messy-code round-trip, 7 guards verbatim, reorder = no audit entry,
  warehouse reads/can't-edit, SSR auth semantics — owner/view 200 vs
  anonymous 307 → /login; the form's HTML needs a browser, still deferred)
  → demo-data heal (7 rows through audited updates).

**Next up:** PH1-12 — track-flag rules/behavior (the seven fields
landed with PH1-06; this task adds hard blocks, defaults, UI).

### 2026-11-05 · Phase 1 (PH1-12)

**Shipped:** track-flag rules/behavior for the seven PH1-06 fields —
four cross-field hard blocks in one shared module, the editor's
dependency UI (mutual disable + dependent clears), product audit
snapshots now carrying all seven flags, and demo data exercising every
bucket (E2E 37/37).

- **Four rules, one module** (`lib/tracking`): `serial ⊥ lot` (one
  policy per product — research: "serial OR lot policy per product"),
  `expiry ⇒ lot` (the batch carries the date; `lots.expiryDate` lands
  with PH1-14), `warrantyMonths > 0 ⇒ warrantyEligible`,
  `shelfLifeDays > 0 ⇒ expiryRequired` (the Odoo coupling — shelf
  life only feeds expiry math at receipt; free-form display specs
  belong to attribute definitions). First violation wins; `0` counts as
  unset (same as the readers' `=== true` / present checks); the zod
  quiet gate mirrors the NUMERIC couplings only — the boolean pairs
  have no wired error path (a pathless issue would block autosave
  silently) and the UI makes them unreachable anyway, so the mutation
  enforces all four verbatim BEFORE any diff or patch (rejected writes
  never audit). Range checks run first: a typo'd 5000 still reports
  the range, not the coupling.
- **Deliberate non-rules**: eligible without months (terms can vary —
  PH1-17's claim flow may require them at claim time), expiry without
  shelf life (supplier-stated dates land on the lot), warranty without
  serial (receipt-based coverage is legitimate), and `allowBackorder`
  (nothing consumes it until sales exist — PH2).
- **UI**: serial/lot disable each other (both-on is unreachable, not
  silently corrected); expiry disables without lot, and unchecking lot
  clears it; warranty months / shelf life disable without their flag
  and unchecking clears the value — an orphaned number would be a save
  the server must reject, so the form never builds one. The "(PH1-12)"
  placeholder hints became the actual rules.
- **Audit**: the seven flags join the product snapshot (variants
  already carried theirs) — flipping serial tracking OFF now shows
  before/after instead of an unexplained "update".
- **Variants**: `variants.update` runs the same module over its five
  boolean flags (the numeric terms don't exist on variant rows);
  sync-inserted rows copy from a product that already passed, so
  they're valid by induction.
- **Demo data**: seed entries spread `UNTRACKED` (the state every new
  product starts in) with overrides — the three equipment rows get
  serial + warranty (X5 24 months, S3/M7 12), the rotor kit
  backorder-allowed — plus a new `DEMO-1008` Ultrasound Gel 5L carrying
  lot + expiry + 730-day shelf life (the catalog's only perishable, so
  the bucket has real data). `seed.test` now proves EVERY seeded row
  satisfies `lib/tracking` (the seed bypasses mutations, so the seed
  itself is the guarantee): products 7 → 8, join rows unchanged at 7.

**Pipeline**: prettier → tsc → lint → format:check → **221 tests / 30
files** (+8 `tracking.test`: shared rules incl. first-violation order,
0/NaN handling, four verbatim create guards + no-audit, both buckets
round-trip, snapshot before/after on a flag flip + no-op + rejected
flip, range-before-coupling, variants boolean pairs) → build →
**HTTP E2E 37/37** (seed buckets over HTTP, three own fixtures with
cleanup, four guards verbatim, ordering contract, flip audited with
before/after, identical re-save = no audit entry, warehouse reads/
can't-edit, SSR auth semantics — owner 200 vs anonymous 307 → /login;
form HTML still needs a browser, deferred) → dev org healed (seed
inserted the gel idempotently; 8 DEMO rows verified against the seed).

**Next up:** PH1-13 — product images (upload/reorder/cover via Convex
storage; the `images[]` field landed with PH1-06).

### 2026-11-08 · Phase 1 (PH1-13) — plan catch-up

**Shipped:** the product image flow was already in the tree; this entry
records it and the storage decision the task line still had wrong.

- **Cloudinary, not Convex storage.** Signed direct upload
  (`files.generateCloudinarySignature` → browser POST → `files.saveCloudinary`).
  The API secret stays on the deployment. `files` remains the registry:
  Cloudinary rows keep `cloudinaryPublicId` + a permanent `url`; pre-PH1-13
  Convex-storage rows still resolve (signed URL re-minted on read). Callers
  persist `fileId`, never a URL. The same picker serves product images,
  avatars, and the company logo.
- **Attachment shape:** `products.images` is cover-first `{ fileId, alt }[]`.
  Order is the display order (index 0 badged Cover). Alt text is on the
  attachment, not the file, so the same bytes can be described per use.
  `lib/images` is the one message (≤ 255; blank stores as absent). The
  mutation rejects a missing file and a too-long alt before any patch, and
  a reorder or alt edit is a real audit change.
- **Gallery** (`components/catalog/media-gallery.tsx`): add, drag-and-drop,
  move, make cover, alt, remove. Removal is deferred until a save excludes
  the file, so a failed save can't drop a byte the form still references.

**Decision:** Convex storage stays only as the legacy reader. New bytes
go to Cloudinary.

**Next up:** PH1-14 — `serials` / `lots` tables and helper tests.

### 2026-11-08 · Phase 1 (PH1-14)

**Shipped:** schema-first serial and lot masters, plus the pure helpers
Phase 5's receipt and pick mutations will call. No UI, no public
mutations (the guards sweep is unchanged). **Phase 1: 14/25.** The
serial/lot/expiry/warranty exit criterion is met; the other three stay
open (archive, then the stock ledger).

- **`serials`:** `number` (trim only, case kept — a scan must match),
  `productId`, optional `variantId`, `status`. Indexes `by_number`,
  `by_product`, `by_product_status`, `by_status`. Warranty registration
  is columns on this row (`warrantyStart`, `warrantyMonths` snapshotted
  at shipment), not a third table.
- **`lots`:** `number`, optional `supplier` (a label until `vendors`
  exists in PH2-03), `receivedDate`, optional `mfgDate` / `expiryDate`,
  `status`. Indexes `by_product`, `by_product_number`, `by_product_expiry`
  (null expiry sorts first, so a FEFO range over real dates skips it),
  `by_status`. Quantity is not on the lot — the ledger (PH1-17) will
  point at `lotId`. `warehouseId` and `customerId` wait until those
  tables exist.
- **`lib/serials`:** transitions
  `available → reserved|disabled`, `reserved → available|shipped`,
  `shipped → returned`, `returned → available|service|disabled`,
  `service → available|shipped|disabled`, `disabled` terminal. Same
  state is a no-op. `warrantyLookup` uses UTC calendar months (a 24-month
  term from 31 Jan ends 31 Jan two years later).
- **`lib/lots`:** `released ↔ quarantined`, both may become `recalled` or
  `expired`; recall and expiry stick. `effectiveLotStatus` reads a
  released lot past its expiry as `expired` without a write; quarantine
  and recall outrank the date. `lotBlocksSale` is that answer as a
  boolean for PH5-07.

**Pipeline:** prettier → tsc → **235 tests / 31 files** (+12
`serialsLots`: both machines, illegal jumps, warranty boundaries, lot
date order, expiry-blocks-sale, index round trip including the null
expiry key).

**Next up:** PH1-15 — product duplicate + archive.

### 2026-11-08 · Phase 1 (PH1-15)

**Shipped:** duplicate a product into a recoverable draft, and keep
archived products out of pickers and the storefront. **Phase 1: 15/25.**
The catalog exit criterion is met. Stock (PH1-16 onward) is what's left
of the phase.

- **`products.duplicate`** (`catalog.create`, one create audit on the
  copy, `sourceId` in the snapshot). Copies fields, category join,
  attribute values, images (same file rows), variant axes, and variant
  rows. Status is always `draft`. Name gains ` (copy)`. SKU is
  `<base>-COPY`, then `-COPY2`…, trimmed to 32 from the base so the
  suffix survives. Slug derives from the new name. Barcodes are NOT
  copied (a scan must resolve to one thing). Serials and lots stay on
  the source — they are physical units.
- **Hidden, not deleted.** `isPickerListed` is everything except
  archived. The catalog list and `products.brands` omit archived unless
  the status filter is explicitly `archived` (that's the way back;
  Archive on the editor and the bulk bar set that status, Restore
  returns it to draft). `products.picker` is the staff selector contract.
  `isStorefrontListed` is `active` only — drafts stay in staff pickers
  and off the store. PH4 must use that helper, not `picker`.

**Pipeline:** prettier → tsc → **240 tests / 32 files** (+5
`productDuplicate`: visibility, picker, copy round trip, second-copy
suffix, 32-char SKU, sales allowed / warehouse denied).

**Next up:** PH1-16 — warehouses table + admin CRUD.

### 2026-11-08 · Phase 1 (PH1-16)

**Shipped:** warehouse master data and the admin screen that maintains
it. **Phase 1: 16/25.** The product list also shows each product's
cover image.

- **`warehouses`:** `code` (trim, uppercase, unique, letters/digits/
  dashes, ≤ 16), `name` (≤ 100), optional free-text `address` (blank
  stores as absent, ≤ 500), `isDefault`, `active`. Indexes `by_code`,
  `by_active`.
- **One default.** The first warehouse is the default and active even
  if the form says otherwise. Making another the default clears the
  previous flag in the same transaction. The current default cannot be
  unmarked, deactivated, or removed until another warehouse takes the
  flag. An inactive warehouse cannot be made the default. Inactive rows
  stay listed — later ledger history will still name them.
- **Permissions:** `list` is `inventory.view` (Sales can read), `create`
  / `update` / `remove` follow create/edit/delete. A no-op save writes
  no audit. UI at `/inventory/warehouses`; `/inventory` redirects there.
  Inventory in the sidebar is now a group.
- **Product list:** the Product column shows the cover (images[0]) and
  a `+N` when more images are attached. No image stays the placeholder.

**Pipeline:** prettier → tsc → **247 tests / 33 files** (+7
`warehouses`: field rules, first-is-default, code clash, default
guards, address clear, no-op audit, last-row delete, sales vs
anonymous).

**Next up:** PH1-17 — append-only stock ledger.

### 2026-11-08 · Phase 1 (PH1-17)

**Shipped:** the append-only stock ledger. **Phase 1: 17/25.** No
inventory screen yet — the list and the post are the contract PH1-18
through PH1-22 will call.

- **`stockMovements`:** type, signed `qty`, `productId`, optional
  `variantId`, `warehouseId`, optional `lotId`, `serialIds[]`, optional
  reference (`type` + `id`, both or neither), optional `unitCost`,
  `actorId`, `createdAt`. No `updatedAt`. Indexes by product, product +
  warehouse, warehouse, lot, and reference. The module never patches or
  deletes a row.
- **Sign.** Receipt, transfer in, and reservation are greater than zero.
  Issue, transfer out, and release are less than zero. Adjustment is
  either sign except zero. `onHandDelta` ignores holds; `reservedDelta`
  ignores physical lines. `available = onHand − reserved` is the PH1-18
  read, not a stored number.
- **Guards.** `post` is `inventory.create` (Sales can list, not post).
  A product that has variants must name one of them. An inactive
  warehouse takes no new line. A lot or serial must belong to the same
  product (and variant, when both name one). When serials are listed,
  |qty| equals how many, and the serial's status is left alone — Phase
  5 changes that. `postMovement` is the helper later workflows call
  inside their own transaction.

**Pipeline:** prettier → tsc → **260 tests / 35 files** (+9
`stockMovements`: sign sums, append, inactive warehouse, variant, lot,
serial count, sales vs anonymous, no patch/delete in the module).

**Next up:** PH1-18 — derived on-hand and available.

### 2026-11-08 · Phase 1 (PH1-18)

**Shipped:** derived stock balances. **Phase 1: 18/25.** Still no
inventory screen — these are the queries PH1-23 will render.

- **`stock.balance(productId, warehouseId, variantId?)`**
  (`inventory.view`). On-hand is the sum of physical lines. Reserved is
  the sum of reservation + release. Available is on-hand minus reserved,
  computed on read. Omit the variant to total every variant of the
  product at that warehouse. No lines yet is a zero balance, not an
  error. A total that cannot see every line (more than 5000) refuses
  rather than returning a short sum.
- **`stock.byWarehouse`** lists each product/variant that has moved at
  that warehouse, including a position that has since netted to zero.
  Name and SKU come from the product (the variant SKU when the line
  named one).
- **Valuation is a placeholder.** `unitCost` is the latest physical
  line that recorded one; `value` is on-hand × that cost, to the cent.
  A hold's cost is ignored. This is not moving-average cost — that
  engine is PH3-06.

**Pipeline:** prettier → tsc → **263 tests / 35 files** (+3 in
`stockMovements`: balance math, warehouse isolation, zero balance,
sales can read, anonymous cannot).

**Next up:** PH1-19 — reservation engine.

### 2026-11-08 · Phase 1 (PH1-19)

**Shipped:** reservation engine. **Phase 1: 19/25.** Still no inventory
screen — an order mutation calls the helpers; the warehouse entry
points are `stock.reserve`, `stock.release`, and `stock.allocate`.

- **Same transaction.** `reserveStock`, `releaseStock`, and
  `allocateStock` take the caller's mutation context. They read the
  ledger lines already written in that transaction, then insert through
  `postMovement`. `ctx.runMutation` would be a second transaction and
  could over-reserve.
- **A hold cannot exceed what is free.** The quantity is a positive
  amount. Reserve refuses anything above available at that product,
  variant, and warehouse (`Only N available to reserve.`). Release and
  allocate refuse anything above what that document still holds.
- **Allocate is a release plus an issue** of the same quantity. The
  hold ends and the units leave on-hand together. Available stays
  reduced by the units that shipped.
- **A thrown transaction keeps nothing it wrote.** The test reserves 4
  of 5, then proves a second reserve of 2 fails and the ledger still
  has exactly one reservation. A callback that reserves and then throws
  leaves that reservation unwritten.

**Pipeline:** prettier → tsc → **269 tests / 36 files** (+6 in
`reservations`: over-reserve, same-transaction visibility, rollback,
document-scoped release and allocate, refused allocation, sales vs
anonymous).

**Next up:** PH1-20 — manual stock adjustment.

### 2026-11-08 · Phase 1 (PH1-20)

**Shipped:** manual stock adjustments. **Phase 1: 20/25.** Still no
adjustments screen — that page is PH1-23. Warehouse staff post through
`stock.adjust`.

- **The reason fixes the sign.** Damage and write-off leave the shelf
  (negative). Found stock arrives (positive). A count correction may
  go either way and cannot be zero. The raw `post` action refuses an
  adjustment, so this path is the only one that writes the type.
- **A removal stops at the hold.** On-hand cannot fall below what is
  still reserved. With 5 on hand and 4 reserved, a write-off of 2
  fails (`Only 1 can be removed`) and a write-off of 1 leaves available
  at zero.
- **Note and photo are optional.** A blank note is stored as absent.
  A present note is at most 500 characters. The photo is an existing
  `files` row whose type is an image.
- **Role gate is `inventory.approve`.** Warehouse, admin, and owner
  can adjust. Sales and accountant can read stock and cannot post a
  count change. The write is audited.

**Pipeline:** prettier → tsc → **274 tests / 37 files** (+5 in
`adjustments`: reason signs, note and photo, reserved floor, sales
denied, raw post refused).

**Next up:** PH1-21 — stock transfer workflow.

### 2026-11-08 · Phase 1 (PH1-21)

**Shipped:** stock transfers. **Phase 1: 21/25.** Still no transfers
screen — that page is PH1-23. Warehouse staff run the document through
`transfers`.

- **Draft holds nothing.** Create names the source, the destination,
  and the lines (`TR-0001` from the new sequence). The two warehouses
  must differ and be active. Update and cancel work only while the
  document is a draft.
- **Ship takes the goods off the source.** One transfer-out per line,
  for the whole quantity, at the latest source cost. On-hand at the
  destination does not change. A line that exceeds what is free (on-hand
  minus reserved) fails the whole ship, and the draft stays a draft.
- **Receipts can be partial.** Each receipt posts a transfer-in for the
  quantity that arrived. The document stays in transit, and on the
  in-transit report, until every line is fully received. Receiving more
  than is still outstanding is refused and posts nothing.
- **Who can do it.** Create is `inventory.create`. Update, ship, and
  receive are `inventory.edit`. Cancel is `inventory.delete`. The report
  is `inventory.view`, so sales can see what is on the road and cannot
  move it. Each write is audited.

**Pipeline:** prettier → tsc → **278 tests / 38 files** (+4 in
`transfers`: rules, partial receipt, short shelf rolls back, cancel
and sales denied).

**Next up:** PH1-22 — generic goods receipt.

### 2026-11-08 · Phase 1 (PH1-22)

**Shipped:** manual goods receipts. **Phase 1: 22/25.** Still no
receiving screen — that page is PH1-23. Receiving against a purchase
order is PH2-22.

- **One posted document.** `goodsReceipts.create` writes the receipt
  and one ledger `receipt` per line in the same transaction. The number
  is `GRN-0001`. There is no draft and no edit. A correction is a later
  adjustment.
- **The reference note is required.** It is the record of where the
  goods came from — a delivery note, an opening balance. Blank is
  refused. A line carries an optional unit cost onto the ledger, so the
  stock value placeholder can see it.
- **A bad line keeps nothing.** Duplicate serials, an inactive
  warehouse, or a product listed twice refuse the intake. No receipt
  row and no ledger row remain.
- **Who can do it.** Create is `inventory.create`. `get` and `list` are
  `inventory.view`, so sales can read a receipt and cannot post one.

**Pipeline:** prettier → tsc → **282 tests / 39 files** (+4 in
`goodsReceipts`: note, on-hand and cost, rollback, sales denied).

**Next up:** PH1-23 — inventory UI.

### 2026-11-08 · Phase 1 (PH1-23)

**Shipped:** the inventory screens. **Phase 1: 23/25.**

- **Stock list.** `stock.positions` (`inventory.view`) groups the ledger
  by product, variant, and warehouse. Filters are warehouse, category,
  and low stock. Low stock is “nothing available” until reorder points
  (PH1-24) replace that reading.
- **Product detail.** One warehouse at a time: on-hand, reserved,
  available, the placeholder value, the reservation and release lines,
  and the full ledger (newest last).
- **Transfers.** The list opens on the in-transit report. A new draft
  can be shipped and received in part from the document page. Cancel is
  drafts only.
- **Adjustments.** Reason fixes the sign. The note and the photo are
  optional. Posting needs `inventory.approve`.
- **Receipts.** The manual intake screen PH1-22 deferred: list, post
  (required reference note, optional unit cost), and a read-only
  document. No purchase order.

**Pipeline:** prettier → tsc → **283 tests / 40 files** (+1 in
`stockPositions`).

**Next up:** PH1-24 — reorder points.

### 2026-11-08 · Phase 1 (PH1-24)

**Shipped:** reorder points and the daily low-stock notice. **Phase 1: 24/25.**

- **Points.** `reorderPoints.set` upserts a product-wide point or a
  warehouse override (`inventory.edit`). The warehouse point wins
  there. `clear` removes that one row. Viewers can read the numbers
  (`forProduct`, `inventory.view`) and cannot change them.
- **Low stock.** The stock list and the product page compare available
  to the effective point. At or below the point is low. No point means
  not low, even at zero. Inactive warehouses are skipped.
- **Daily job.** 06:00 UTC. One warning per dip to each active user
  with `inventory.edit`. The notice stays open while the slice stays
  low, closes when available rises above the point, and the next dip
  notifies again. A product with a point and no ledger lines is
  treated as zero at each active warehouse it covers.

**Pipeline:** prettier → tsc → **287 tests / 41 files** (+4 in
`reorderPoints`).

**Next up:** PH1-25 — stock correctness suite.

### 2026-11-08 · Phase 1 (PH1-25)

**Shipped:** the stock correctness suite. **Phase 1: 25/25, gate closed.**

- **One path, two warehouses.** Ten received at MAIN, four shipped and
  received at EAST, three reserved there, two issued at MAIN, one
  written off as damage. After every step the balance query matches an
  independent sum of the ledger. On-hand and available stay apart
  while the hold is open. A further write-off that would take the hold
  is refused and adds no line. Company on-hand ends at 7.
- **Together.** Two reservations started in the same moment both stick
  when they fit. When each would take the last unit, exactly one
  sticks and the other is told what is still free.

**Pipeline:** tsc → **289 tests / 42 files** (+2 in `stockCorrectness`).

**Next up:** PH2-01 — customers.

### 2026-11-08 · Phase 2 (PH2-01)

**Shipped:** customer master. **Phase 2: 1/29, gate still open.**

- **Company.** Code, name, status (active / on hold / closed), payment
  terms, tax group, currency, and credit limit. A blank credit limit is
  no cap. Zero is nothing on account. Closing the account is the way
  to retire it.
- **People, places, notes.** Contacts keep a single primary. Addresses
  keep one default bill-to and one default ship-to, and one address
  may be both. The first of each takes those flags. Notes append to a
  timeline and are not edited.
- **Who can write.** Sales, admin, and owner open accounts. Warehouse
  can edit an existing account (fulfillment already has `sales.edit`)
  and cannot create one. Accountant can read. The sales form loads
  active currencies and tax groups through `customers.options`, so it
  does not need settings access.

**Pipeline:** prettier → convex dev → tsc → **291 tests / 43 files**
(+2 in `customers`). Checked in the browser as Owner Two: created
Acme Clinic, added a primary contact, a default bill-to and ship-to,
and a note, saved On hold, and confirmed the list search and status
filter.

**Next up:** PH2-02 — customer groups.

### 2026-11-08 · Phase 2 (PH2-02)

**Shipped:** customer groups. **Phase 2: 2/29, gate still open.**

- **One tier.** Retail, Wholesale, and Institutional are the starting
  names. A company belongs to one group, or to none. Moving it clears
  the previous tier. The name is unique ignoring case.
- **Retire, don't delete.** An inactive tier stays on the companies
  that already use it. It cannot be chosen for anyone new.
- **Who can write.** Sales, admin, and owner open a group. Warehouse
  can rename, deactivate, and assign a company (it already has
  `sales.edit`) and cannot create a tier. Accountant can read.

**Pipeline:** prettier → convex dev → tsc → **293 tests / 44 files**
(+2 in `customerGroups`). Checked in the browser as Owner Two: created
the three tiers, assigned Acme Clinic to Wholesale, and confirmed the
company page, the group page, and the customer list.

**Next up:** PH2-03 — vendors.

### 2026-11-08 · Phase 2 (PH2-03)

**Shipped:** vendor master. **Phase 2: 3/29, gate still open.**

- **Company.** Code, name, active flag, payment terms, tax group, tax
  number, currency, and the license (number, jurisdiction, expiry).
  A past expiry is stored. Phase 5 is what blocks an expired license.
  Turning a vendor off keeps the row.
- **People and places.** Contacts keep a single primary. Addresses
  keep one default remit-to and one default ship-from, and one
  address may be both. The first of each takes those flags.
- **Who can write.** Warehouse, admin, and owner open a vendor.
  Accountant can edit an existing vendor (bills already have
  `procurement.edit`) and cannot create one. Sales can read. The
  form loads active currencies and tax groups through
  `vendors.options`, so it does not need settings access.

**Pipeline:** prettier → convex dev → tsc → **295 tests / 45 files**
(+2 in `vendors`). Checked in the browser as Owner Two: created Med
Supply with a past license, a primary contact, and a default remit-to
and ship-from, saved it inactive, and confirmed the list, the license
column, and the Active and Inactive filters.

**Next up:** PH2-04 — product↔vendor links.

### 2026-11-08 · Phase 2 (PH2-04)

**Shipped:** product↔vendor links. **Phase 2: 4/29, gate still open.**

- **One preferred vendor.** A product may name several. The first link
  is preferred, and removing it promotes the oldest one left. The
  vendor SKU is optional and keeps the supplier's casing.
- **Price comes from a receipt.** The link form does not take a last
  purchase price. A goods receipt may name a vendor. A line with a
  unit cost updates the existing link. No link, no new row. No cost,
  the old price stays. An inactive vendor cannot be newly linked.
- **Who can write.** Sales, admin, and owner maintain the link
  (`catalog.edit`). Warehouse and accountant can read it. Warehouse
  still posts the receipt, and that post is what writes the price.

**Pipeline:** prettier → convex dev → tsc → **297 tests / 46 files**
(+2 in `productVendors`). Checked in the browser as Owner Two: linked
Parts Co to Lab Bench Stand as preferred with vendor SKU PC-1006,
posted a receipt at 12.50, and confirmed the price on the product and
on the vendor.

**Next up:** PH2-05 — customer and vendor statements.

### 2026-11-08 · Phase 2 (PH2-05)

**Shipped:** partner statements. **Phase 2: 5/29, gate still open.**

- **Customer.** Balance is invoices, less credits and payments. None
  of those documents exist yet, so the balance is zero. Available
  credit is the limit minus that balance. No limit means no cap.
  Quotes, orders, deliveries, and invoices will fill the document list.
- **Vendor.** Goods receipts that name the vendor are the documents.
  A line with no unit cost is listed and adds nothing. Bills are not
  in the received total.
- **Who can read.** The customer statement is `sales.view`. The vendor
  statement is `procurement.view`. List, detail, and create/edit were
  already on the company pages.

**Pipeline:** prettier → convex dev → tsc → **299 tests / 47 files**
(+2 in `statements`). Checked in the browser as Owner Two: Acme Clinic
shows balance 0.00 and no cap, Parts Co shows GRN-0002 at 25.00 and
the receipt opens from the row, and Med Supply shows no receipts.

**Next up:** PH2-06 — price lists.

### 2026-11-08 · Phase 2 (PH2-06)

**Shipped:** stored prices. **Phase 2: 6/29, gate still open.**

- **Lists.** One list is the base. The first list becomes it, and a
  later list can take the flag. Unsetting the only base leaves it in
  place. Deactivating the base hands the flag to the oldest other
  list. A list is never deleted. Its currency stays once a price is
  on it.
- **Tiers.** A group price and a customer price are separate rows, one
  per product, variant, and currency. An inactive group and a closed
  customer cannot take a new price. A customer on hold can. A quantity
  break hangs off one of those prices and starts at 2. The price's
  currency is the break's currency.
- **Promotions.** A window of UTC dates, and optionally the list in
  effect during it. Two windows may overlap. A past window is kept.
  Deciding the winner is PH2-07.
- **Who can write.** Reads are `sales.view`. Every price write,
  including a change or a removal, is `sales.create`. Warehouse can
  read a price and cannot change one. Deleting a product or a variant
  removes the prices that name it.

**Pipeline:** prettier → convex dev → tsc → **301 tests / 48 files**
(+2 in `prices`). No screen in this task: the price list manager,
per-customer table, and quantity-break editor are PH2-09.

**Next up:** PH2-07 — resolvePrice.

### 2026-11-08 · Phase 2 (PH2-07)

**Shipped:** `resolvePrice`. **Phase 2: 7/29, gate still open.**

- **One winner.** A customer price, then the customer's group price,
  then a list price. Inside a tier, the variant price beats the product
  price. A higher tier still wins when it only has a product price.
  Zero is a real price. Nothing matched is a null unit price.
- **The list.** An active promotion whose window covers the UTC day,
  and whose list is active in the requested currency. The one that
  started latest wins. If that list does not price the product, the
  next promotion is tried, then the active base list.
- **The break.** It applies only to the row that won, and only the
  break with the greatest minimum the quantity still reaches.
- **Rounding.** The unit price rounds to the currency's decimal places.
  A half rounds away from zero. A line amount rounds again after
  multiplying that unit by the quantity. The catalog list price is the
  last fallback, and only in the company currency.

**Pipeline:** prettier → convex dev → tsc → **308 tests / 49 files**
(+7 in `resolvePrice`). No screen in this task. Overrides are PH2-08,
and the pricing screens are PH2-09.

**Next up:** PH2-08 — price override on a document line.

### 2026-11-08 · Phase 2 (PH2-08)

**Shipped:** line price overrides. **Phase 2: 8/29, gate still open.**

- **A typed price or a percent off.** Both need a reason. The discount
  is measured from the rounded resolved unit. Above 10% the line is
  flagged and waits. A raise, or a discount of exactly 10%, applies
  immediately. No resolved price means a typed price waits, and a
  percent off is refused.
- **Two people.** The person who asked cannot confirm their own.
  Confirming takes `sales.approve`. A rejection needs a reason. Until
  the override is applied or approved, the line still charges the
  resolved unit.
- **Where it sits.** One row per quote, order, invoice, or credit-note
  line. Proposing again replaces that row. The documents themselves
  are still PH2-11 onward. Phase 6 replaces the single 10% with
  configurable rules.

**Pipeline:** prettier → convex dev → tsc → **310 tests / 50 files**
(+2 in `priceOverrides`). No screen in this task. The pricing screens
are PH2-09.

**Next up:** PH2-09 — pricing screens.

### 2026-11-08 · Phase 2 (PH2-09)

**Shipped:** pricing screens. **Phase 2: 9/29, gate still open.**

- **Lists and promotions.** `/sales/prices` lists the price lists and the
  dated promotions. The first list is still the base. A list page edits
  the name, the base flag, and whether it is active. Currency stays
  once the list has a price. A promotion names the list in effect
  between two dates and is deactivated, never deleted.
- **Prices and breaks.** A list, a customer group, and a customer each
  have a price table. A quantity break hangs off one of those prices
  and starts at 2. An inactive list or group, or a closed customer,
  keeps the prices it has and refuses a new one.
- **A sales line.** The preview uses the same winner as `resolvePrice`,
  then the line total and the margin against the product's display
  cost. No cost, or a unit that is not above zero, leaves the margin
  blank. Quote and order lines reuse it once those documents exist.
- **Who can write.** Reads stay `sales.view`. Every price write stays
  `sales.create`. Warehouse can read a price and cannot change one.

**Pipeline:** prettier → convex codegen → tsc → **311 tests / 50 files**
(+1 in `prices`). Checked in the browser as Owner Two: a list price with a
quantity break, the sales-line preview for a list, a customer price, and a
group price (margin filled once the product has a display cost), and the
price tables on a customer and a group.

**Next up:** PH2-10 — pricing test matrix.

### 2026-11-08 · Phase 2 (PH2-10)

**Shipped:** the pricing matrix, locked in CI. **Phase 2: 10/29, gate still open.**

- **Tiers and breaks.** One file walks a customer price, that customer's
  group, the base list, the catalog list price, and a product with no
  price. Quantities are 1, 5, 7, and 10. The break at 5 covers 7, and
  the break at 10 replaces it. A cheaper break on a lower tier does not
  leak. A promotion from last year, aimed at a one-pound list, does not
  win on the day under test.
- **Overrides.** Each resolved unit is crossed with no override, a 10%
  discount, a 20% discount left pending, that discount approved, that
  discount rejected, and a typed raise. Pending and rejected keep the
  resolved unit. A raise, and a discount of exactly 10%, apply at once
  and cannot be confirmed again. With no price, a percent off is refused
  and a typed price waits for a second person.
- **Where it runs.** The sales-line preview matches `resolvePrice`,
  including the line total, and storing an override does not change the
  resolver. CI already runs `npm test`, which includes this file.

**Pipeline:** prettier → tsc → **313 tests / 51 files** (+2 in
`pricingMatrix`). No screen in this task.

**Next up:** PH2-11 — quotes.

### 2026-11-08 · Phase 2 (PH2-11)

**Shipped:** quotes, and a draft order copied from one. **Phase 2: 11/29, gate still open.**

- **A quote.** `/sales/quotes` opens a draft for a customer who is not
  closed. The number is `QT-`. The customer's currency, terms, and
  default bill-to and ship-to are copied. Notes and the validity date
  can change while it is a draft. The validity date cannot sit before
  the quote date. Today is still valid.
- **Lines, discount, tax.** A line prices through `resolvePrice` on the
  quote date and refuses a product with no price in that currency. Tax
  is snapshotted onto the line. A discount of 10% or less replaces the
  unit and recomputes tax. Above 10% the existing override waits for a
  second person, and the line keeps the resolved price until they
  approve it. Send and accept refuse that wait.
- **Status and the order.** Send needs a line. A lapsed quote cannot be
  sent or accepted, and expire refuses a quote that is still valid.
  Accepted, rejected, and expired stay put. Accept converts once into a
  draft sales order (`SO-`) that copies the charged lines and prices. A
  second convert is refused. Confirming that order is PH2-12.
- **PDF and the statement.** Download builds an A4 quote in the browser.
  The customer's statement lists the quote. The balance stays invoices
  less credits and payments.

**Pipeline:** prettier → convex codegen → tsc → **316 tests / 52 files**
(+3 in `quotes`). Checked in the browser as Owner Two: Acme Clinic, Lab
Bench Stand at the customer price of 450.00 GBP, a 10% discount applied
to 405.00, a 20% discount left at 450.00 and blocking send, expire
refused while the quote was still valid, then sent, accepted, and
converted to SO-0001 at 405.00. Bill-to and ship-to copied. The statement
lists the quote and the balance stays 0.00.

**Next up:** PH2-12 — confirm a sales order and reserve stock.

### 2026-11-08 · Phase 2 (PH2-12)

**Shipped:** the sales-order lifecycle. **Phase 2: 12/29, gate still open.**

- **Confirm.** A draft confirms at one active warehouse. Each line
  reserves what is free there, in line order, and a shortfall is
  flagged backorder. The order still confirms when nothing is free.
  A closed customer and an inactive warehouse are refused. A second
  confirm is refused.
- **Ship.** Shipping is line by line, and it can be less than the
  reserved quantity. That quantity is allocated: the hold ends and
  the units leave on-hand, carrying the latest unit cost. The order
  moves to fulfilling. The remainder stays reserved. When stock
  arrives, reserve takes the open backorder. Invoice waits until
  every line has shipped, and close waits until it is invoiced.
- **Cancel.** Draft, confirmed, and fulfilling can be cancelled.
  Whatever is still reserved is released. A quantity that already
  shipped stays out. An invoiced order cannot be cancelled.
- **Who.** Confirm, invoice, close, and cancel are `sales.create`.
  Shipping and topping up a backorder are `sales.edit`, so warehouse
  can fulfill and cannot commit the order. The customer's statement
  lists the order and the balance stays zero.

**Pipeline:** prettier → tsc → **320 tests / 54 files** (+3 in
`salesOrders`). Checked in the browser as Owner Two: SO-0001 confirmed
at MAIN and reserved 1 of Lab Bench Stand, then that 1 shipped. The
order is fulfilling (reserved 0, shipped 1). MAIN on hand went from 4
to 3. EAST stayed at 1. Invoice and close were left unclicked.

**Next up:** PH2-13 — the sales-order screen.

### 2026-11-08 · Phase 2 (PH2-13)

**Shipped:** the sales-order screen. **Phase 2: 13/29, gate still open.**

- **Header.** Customer, with a hold or a closed account called out,
  the ship-to copied onto the order, the payment terms, and the
  channel. A staff order is manual. Storefront is on the document
  for the shop, and nothing writes it yet.
- **Lines.** The charged unit stays the price from the quote. Beside
  it is today's resolved price, the margin on the charged unit, and
  what is free and on hand at the warehouse. A draft uses the
  warehouse selected for confirm. No warehouse yet leaves
  availability blank.
- **Actions and the trail.** Confirm, deliver, invoice, and cancel
  are the same transitions as PH2-12. Deliver stays on the line,
  because a shipment can be part of the quantity. The trail reads
  quote → order → delivery → invoice. Delivery and invoice are
  named and not links until those documents exist.

**Pipeline:** prettier → tsc → **321 tests / 54 files** (+1 in
`salesOrders`). Checked in the browser as Owner Two on SO-0001:
Acme Clinic on hold, ship-to 12 High Street, terms due on receipt,
channel manual. The bench charges 405.00 and today's price is
450.00, margin 21.0%. MAIN shows 3 available and 3 on hand. The
quote link opens QT-0001. Invoice was left unclicked.

**Next up:** PH2-14 — deliveries.

### 2026-11-08 · Phase 2 (PH2-14)

**Shipped:** packing slips. **Phase 2: 14/29, gate still open.**

- **Pick and pack.** Confirmed orders with quantity still reserved are
  grouped by warehouse. Packing opens a `DN-` slip and claims that
  quantity. Stock stays where it is. A packed slip can be cancelled,
  and cancelling the order cancels a slip that has not shipped.
- **Ship.** The date, carrier, and tracking number are required. Ship
  is the goods issue: a release and an issue, with the latest unit
  cost on the issue and on the slip. One pending `cogs` intent records
  the cost. Quantity that already left cannot be packed, so it is not
  issued a second time.
- **Trail.** The order names the slip once one exists. The customer
  statement lists the delivery at the selling price and the balance
  stays zero.

**Pipeline:** prettier → tsc → **324 tests / 55 files** (+3 in
`deliveries`). Checked in the browser as Owner Two: SO-0002 reserved
1 Lab Bench Stand at MAIN, packed DN-0001, and shipped it on
2026-11-08 with City Freight and tracking TRK-1006. The issue kept
unit cost 12.50. Cost of goods is 12.50 GBP, period 2026-11, pending.
MAIN went from 3 on hand to 2. EAST stayed at 1. Invoice was not
clicked.

**Next up:** PH2-15 — the delivery PDF.

### 2026-11-09 · Phase 2 (PH2-15)

**Shipped:** the delivery PDF. **Phase 2: 15/29, gate still open.**

- **Packing slip.** Download PDF on the delivery page. It names the
  company, the slip, the order, the customer, the warehouse, the
  ship-to, and each line's quantity. A shipped slip adds the date,
  the carrier, and the tracking number. The unit cost stays off the
  page that travels with the goods.
- **Pick list.** Print pick list on the deliveries desk, grouped by
  warehouse. An empty list still downloads, and it says nothing is
  waiting to pick.
- Both PDFs are built in the browser. The shared template kit stays
  PH2-28.

**Pipeline:** prettier → tsc → **325 tests / 55 files** (+1 in
`deliveries`). Checked in the browser as Owner Two. Print pick list
on the empty desk downloaded with no error. DN-0001 downloaded a
PDF (`%PDF-`, City Freight, TRK-1006 still on the page). Invoice
and Close were not clicked.

**Next up:** PH2-16 — sales invoices.

### 2026-11-09 · Phase 2 (PH2-16)

**Shipped:** sales invoices. **Phase 2: 16/29, gate still open.**

- **Draft.** Invoice on a shipped order, or on a shipped delivery,
  opens an `INV-` draft for the quantity that has left and is not
  already billed. The charged price and the tax rate are copied from
  the order line. The amounts are worked out for that quantity.
- **Post.** Posting writes a pending `salesInvoice` intent. When
  every line has shipped and been billed, the order becomes invoiced.
  A draft can be voided, which releases the quantity. A posted
  invoice is not voided here.
- **Paid.** Mark paid records the status. It does not record a
  payment, so the statement balance still includes it. The PDF is
  built in the browser.

**Pipeline:** prettier → tsc → **329 tests / 56 files** (+4 in
`invoices`). Checked in the browser as Owner Two. The empty pick
list sits in a card. SO-0002 drafted INV-00001 for 450.00 GBP, due
on receipt, and posting it marked the order invoiced. Acme's balance
is 450.00. Close was not clicked. SO-0001 was already marked
invoiced before this document existed, so it is not on the statement.

**Next up:** PH2-17 — credit notes.

### 2026-11-09 · Phase 2 (PH2-17)

**Shipped:** credit notes. **Phase 2: 17/29, gate still open.**

- **Draft.** A posted or paid invoice can be credited. The price and
  the tax come from the invoice line. A return may put the goods back
  in the order's warehouse. An adjustment cannot.
- **Post.** Posting writes a pending `creditNote` intent. A restock
  is a receipt at the latest unit cost. The posted note lowers the
  customer's balance. A draft can be voided. A posted note stays.
- The return request and the inspection stay PH2-18.

**Pipeline:** prettier → tsc → **331 tests / 57 files** (+2 in
`creditNotes`). Checked in the browser as Owner Two: INV-00001
drafted CR-0001 as an adjustment for 450.00 GBP, reason “Price
correction”, and posting it wrote the pending intent. The goods stay
out of stock. Acme’s balance is 0.00. Close and Mark paid were not
clicked.

**Next up:** PH2-18 — sales returns.

### 2026-11-09 · Phase 2 (PH2-18)

**Shipped:** sales returns. **Phase 2: 18/29, gate still open.**

- **Request.** A posted invoice or a shipped order can open an `RMA-`
  for a quantity and a reason. A request can be cancelled. Once the
  goods are received, it cannot.
- **Receive.** Each line is restocked, quarantined, or written off at
  the order's warehouse. Restock is a receipt. Quarantine is a receipt
  and a hold. A write-off is a receipt and a removal, so on-hand is
  unchanged.
- **Outcome.** Credit posts a credit note and lowers the balance.
  Exchange opens a draft order at the charged price. It does not
  reserve stock. The order desk tiles stay PH2-19.

**Pipeline:** prettier → tsc → **333 tests / 58 files** (+2 in
`salesReturns`). Checked in the browser as Owner Two: SO-0001
requested RMA-0001, reason “Damaged in transit”. Receiving it as a
write-off left MAIN at 2 on hand. Exchange drafted SO-0003 at
405.00 GBP, still a draft, nothing reserved. Confirm and Close were
not clicked. SO-0001 has no invoice document, so the credit was not
the browser path. The test credits a posted invoice.

**Next up:** PH2-19 — order desk.

### 2026-11-09 · Phase 2 (PH2-19)

**Shipped:** the order desk. **Phase 2: 19/29, gate still open.**

- **Queues.** `/sales` shows open orders, to pick, to ship, to bill, and
  returns pending. The counts come from one query, so they move when a
  document does.
- **Open** is not closed and not cancelled. **To pick** is reserved
  quantity not already on a packed slip. **To ship** is a packed slip.
  **To bill** is shipped quantity that can still be invoiced, plus a
  draft invoice. A return is pending until it is credited, exchanged,
  or cancelled.

**Pipeline:** prettier → tsc → **335 tests / 59 files** (+2 in
`orderDesk`). Checked in the browser as Owner Two. Open orders is 3:
SO-0001 and SO-0002 invoiced, SO-0003 draft. To pick, to ship, to
bill, and returns pending are empty. Opening SO-0003 left it a draft.
Confirm and Close were not clicked.

**Next up:** PH2-20 — requisitions.

### 2026-11-09 · Phase 2 (PH2-20)

**Shipped:** internal requisitions. **Phase 2: 20/29, gate still open.**

- **Request.** Lines, a need-by date, and the signed-in user. The number is
  `REQ-`. A draft can be edited. Rejected cannot.
- **Approve.** The role is the gate. Warehouse can request and cannot
  approve. An owner can approve their own request. There is no money
  threshold.
- **Convert.** An approved request becomes one draft purchase order for
  an active vendor. A second convert is refused. The order is not sent.

**Pipeline:** prettier → tsc → **337 tests / 60 files** (+2 in
`requisitions`). Checked in the browser as Owner Two. REQ-0001 asks for
1 Lab Bench Stand at its existing 320.00 cost, needed by 2026-11-16,
note “Spare bench stand”. Approved, then converted to draft PO-0001 for
Parts Co in GBP, expected 2026-11-16. MAIN stayed 2 on hand. SO-0003 was
not confirmed. Close was not clicked.

**Next up:** PH2-21 — purchase orders.

### 2026-11-09 · Phase 2 (PH2-21)

**Shipped:** purchase orders. **Phase 2: 21/29, gate still open.**

- **Draft.** Agreed price, tax from the vendor's tax group, and the
  expected date. A line can be added or removed. An accountant can edit.
  Warehouse cannot.
- **Send.** Owner or admin. The price and tax freeze, and the order is
  sent. Stock stays put. The PDF downloads in the browser. Email waits
  for Phase 4.
- **Later statuses.** A receipt moves the order to partially received or
  received. A vendor bill marks a received order billed.

**Pipeline:** prettier → tsc → **339 tests / 61 files** (+2 in
`purchaseOrders`). Checked in the browser as Owner Two. PO-0001 for
Parts Co, 1 Lab Bench Stand at the existing 320.00, expected
2026-11-16. Parts Co has no tax group, so tax is 0.00 GBP. Saved the
agreed price, sent the order, and downloaded the PDF. MAIN stayed 2 on
hand. Nothing was received or billed.

**Next up:** PH2-22 — goods receipts against a purchase order.

### 2026-11-09 · Phase 2 (PH2-22)

**Shipped:** goods receipts against a purchase order. **Phase 2: 22/29, gate still open.**

- **Receive.** Warehouse posts the receipt (`inventory.create`). Sales and
  accountant cannot. Accepted quantity enters the chosen warehouse at
  the agreed unit price. Rejected quantity is stored and does not move
  stock. A rejection on its own leaves the order where it is.
- **Status.** The accepted total, including earlier receipts, moves a
  sent order to partially received or received. Billing stays PH2-23.
- **Cost.** The ledger line keeps the purchase unit cost. The receipt
  line stores the moving average after that quantity lands. Valuation
  still reads the latest unit cost until PH3-06. An existing
  product↔vendor link takes the purchase price as its last cost.

**Pipeline:** prettier → tsc → **342 tests / 62 files** (+3 in
`purchaseReceipts`). Checked in the browser as Owner Two. REQ-0002 for
2 Ultrasound Gel 5L (DEMO-1008) at the stored cost 6.00, need-by
2026-11-16, note “Ultrasound gel”. Approved and converted to PO-0002
for Parts Co, tax 0.00 GBP, expected 2026-11-16, then sent. Received at
MAIN: 1 accepted and 1 rejected, GRN-0003. The order is partially
received, 1 of 2 accepted. Gel at MAIN is 1 on hand, value 6.00. The
bench stayed MAIN 2 / 25.00 and EAST 1 / 4.00. PO-0001 was not
received. Parts Co’s statement received total is 31.00 (the new receipt
adds 6.00). Gel has no vendor link, so no last purchase price was
written.

**Next up:** PH2-23 — vendor bills.

### 2026-11-09 · Phase 2 (PH2-23)

**Shipped:** vendor bills. **Phase 2: 23/29, gate still open.**

- **Record.** From a received purchase order, or on its own. The order
  bill copies the accepted quantity and the agreed price. An accountant
  can record and edit an open bill. Warehouse and sales cannot. A
  partially received order cannot be billed, and an order takes one bill.
- **Match.** Owner, admin, or accountant (`finance.post`). Billed quantity
  must equal what was received. A unit price within 2% of the agreed
  price passes; a wider gap blocks the match. Ordered versus received is
  a warning and does not block. A standalone bill has nothing to compare.
  Match writes one pending `vendorBill` journal intent and marks the
  linked order billed. The bill does not move stock.
- **Paid.** The status exists. Nothing sets it. Recording a payment is
  Phase 3.

**Pipeline:** prettier → tsc → **344 tests / 63 files** (+2 in
`vendorBills`). Checked in the browser as Owner Two. PO-0002 was
partially received, so the remaining gel unit was received at MAIN
(1 accepted, GRN-0004). The order is received, 2 of 2 accepted and 1
rejected. BILL-0001, dated 2026-11-09, shows ordered 2, received 2,
billed 2, order price 6.00 GBP, bill price 6.00 GBP, tax 0.00, total
12.00. Match made the bill matched and PO-0002 billed. The screen says
recording a payment is Phase 3. A standalone bill, BILL-0002, reference
GEL-ADJ, is 1 gel at 6.00 GBP with no order to compare, then matched.
Gel at MAIN is 2 on hand, value 12.00. The bench stayed MAIN 2 / 25.00
and EAST 1 / 4.00. PO-0001 was not received or billed. Parts Co’s
statement received total is 37.00 (GRN-0004 adds 6.00). The bills
themselves are not on that statement. Gel still has no vendor link.

**Next up:** PH2-24 — purchase returns to the vendor.

### 2026-11-09 · Phase 2 (PH2-24)

**Shipped:** purchase returns to the vendor. **Phase 2: 24/29, gate still open.**

- **Return.** From a goods receipt. Warehouse posts it (`inventory.create`).
  Sales and accountant can read the debit note and cannot post one. The
  quantity has to be stock that receipt line put on hand, minus what
  already went back. Rejected quantity never entered, so it cannot be
  returned. Reserved stock stays.
- **Stock.** Each line posts an issue at the receipt's unit cost. The
  latest unit cost does not change. The receipt and the purchase order
  stay as they were.
- **Debit note.** The document number (`DBN-`) is the reference. It does
  not write a journal intent (PH2-26) and it does not change the vendor's
  received total. The vendor's credit is Phase 3.

**Pipeline:** prettier → tsc → **347 tests / 64 files** (+3 in
`purchaseReturns`). Checked in the browser as Owner Two. GRN-0004 had
accepted 1 Ultrasound Gel 5L at 6.00. Returned that 1, reason “Damaged
seal”. DBN-0001, Parts Co, MAIN, amount 6.00. Gel at MAIN is now 1 on
hand, value 6.00. The bench stayed MAIN 2 / 25.00 and EAST 1 / 4.00.
PO-0002 stayed billed, with BILL-0001 matched and accepted 2 of 2.
Parts Co’s received total stayed 37.00. The debit note is not on that
statement. PO-0001 was not touched.

**Next up:** PH2-25 — the procurement dashboard.

### 2026-11-09 · Phase 2 (PH2-25)

**Shipped:** the procurement desk. **Phase 2: 25/29, gate still open.**

- **Open.** A draft, sent, partially received, or received purchase order.
  A billed order is finished.
- **Overdue.** Sent or partially received, and the expected date is before
  today. A draft has not been sent. A received order has arrived.
- **Receipts.** Quantity still to accept on a sent or partially received
  order. Rejected quantity does not count as received.
- **Bills.** An open vendor bill. Matched and paid are done. A received
  order with no bill is not in this queue.

**Pipeline:** prettier → tsc → **349 tests / 65 files** (+2 in
`procurementDesk`). Checked in the browser as Owner Two. The desk showed
1 open purchase order (PO-0001, sent, Parts Co), 0 overdue, 1 receipt
pending (PO-0001, 1 unit), and 0 bills pending match. PO-0001 is expected
2026-11-16, so it is not overdue. Opening it left it sent, accepted 0 of
1, and unbilled. Nothing was received or billed.

**Next up:** PH2-26 — the remaining journal intents.

### 2026-11-09 · Phase 2 (PH2-26)

**Shipped:** the remaining journal intents. **Phase 2: 26/29, gate still open.**

- **Goods receipt.** Quantity that enters stock writes one pending intent. The amount is that quantity times the purchase price, or the typed unit cost. A missing cost is zero. A receipt that only rejects writes nothing.
- **Debit note.** A purchase return writes one pending intent at the receipt line's unit cost. The receipt, the order, and the vendor's received total stay as they were.
- **Stock adjustment.** A manual adjustment writes one pending intent. The amount keeps the sign of the quantity. A sales-return write-off is not one of these: the goods come back and leave in the same receive, and the credit note is the posting.
- **Currency.** The purchase order's, otherwise the vendor's, otherwise the company base currency.
- **Backlog.** `/finance` lists the pending rows for anyone with finance view. Warehouse cannot open it. Posting them is Phase 3. Documents that already existed were not backfilled.

**Pipeline:** prettier → tsc → **351 tests / 66 files** (+2 in
`journalIntents`). Checked in the browser as Owner Two. The backlog
showed six pending rows and no post action: DN-0001 at 12.50 GBP,
INV-00001 at 450.00 GBP, CR-0001 at 450.00 GBP, BILL-0001 at 12.00 GBP,
BILL-0002 at 6.00 GBP, and BILL-0003 at 320.00 GBP. No stock was
received or adjusted.

**Next up:** PH2-27 — the doc-flow component.

### 2026-11-09 · Phase 2 (PH2-27)

**Shipped:** the document trail. **Phase 2: 27/29, gate still open.**

- One query, `sales.view`, reads the sale behind a quote, an order, a delivery, an invoice, a credit note, or a return.
- The trail is quote, order, delivery, invoice, then a credit, a return, or an exchange when one exists, then payment.
- A step with no document is still named. The page you are on is not a link.
- A void invoice, a cancelled delivery, and a cancelled return stay off the trail unless that page is open.
- An invoice keeps the delivery it was raised from. Several deliveries otherwise share one step.
- Payment is named. Recording one is Phase 3.

**Pipeline:** prettier → tsc → **356 tests / 67 files** (+5 in
`docFlow`). Checked in the browser. DN-0001 trailed to QT-0002, SO-0002,
INV-00001, and CR-0001, with Payment named and not a link. QT-0002 showed
the same chain with the quote as the current page. SO-0001, which was
invoiced before those documents existed, named Delivery and Invoice with
no link, and linked RMA-0001 and the exchange SO-0003. Nothing was
closed, confirmed, or marked paid.

**Next up:** PH2-28 — the shared PDF kit.

### 2026-11-09 · Phase 2 (PH2-28)

**Shipped:** the shared PDF kit. **Phase 2: 28/29, gate still open.**

- One letterhead draws the company name, an optional logo, a column table, the totals, and the invoice footer.
- Quotes, purchase orders, invoices, packing slips, and the pick list use it. A priced document has net, tax, and total. A slip and a pick list have item and quantity only.
- A PNG or JPEG logo is embedded when the file is valid. A logo that will not embed is left off, and the PDF still downloads.
- The invoice footer is printed at the bottom of every page. A packing slip and a pick list still leave the unit cost off the page.

**Pipeline:** prettier → tsc → **360 tests / 68 files** (+4 in
`pdfKit`). Checked in the browser as Owner Two. Download PDF on
QT-0002 saved a PDF with the company name, the quote number, the
line, the total, and the invoice footer. The unit cost was not on
it. The logo on file did not embed, and the download still
completed. Nothing was closed, confirmed, or marked paid.

**Next up:** PH2-29 — the order-to-cash and procure-to-pay integration tests.

### 2026-11-09 · Phase 2 (PH2-29)

**Shipped:** the order-to-cash and procure-to-pay integration tests. **Phase 2: 29/29, gate still open.**

- A quote for two ships in full. Stock goes to zero. The goods-receipt, cost-of-goods, and sales-invoice intents stay pending.
- A quote for four ships one. The invoice is that unit, and the other three stay reserved. A restocked return puts the unit back and writes a credit-note intent. It does not write a stock adjustment.
- A requisition for two is received and matched. Stock is those two. The goods-receipt and vendor-bill intents stay pending.
- A unit price 3% off the order does not match. A price 2% off does, and the bill intent uses that price. Returning one unit issues it at the receipt cost. The order stays billed.
- Nothing is posted, and nothing is marked paid. Recording a payment is Phase 3.

**Pipeline:** prettier → tsc → **364 tests / 69 files** (+4 in
`cycles`). These tests call the mutations. They are not a click-through
of the screens, so the Phase 2 exit checks stay open.

**Next up:** the Phase 2 exit checks, starting with a manual order-to-cash run.

| Date       | Session         | Shipped (task IDs) | Decisions / notes                                                                                                                                     | Next up                            |
| ---------- | --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-10-04 | Plan created    | —                  | Research doc + development plan aligned with scoping decisions                                                                                        | Start Phase 0 (PH0-01…)            |
| 2026-10-05 | Phase 1 start   | PH1-01             | Category tree backend; global unique slugs, computed paths, guarded moves                                                                             | PH1-02 (category admin UI)         |
| 2026-10-05 | Phase 1 (cont.) | PH1-02             | Category admin UI + stats; products core landed early (PH1-06 note); demo catalog seed (CT-03)                                                        | PH1-03 (attribute definitions)     |
| 2026-10-05 | Phase 1 (cont.) | PH1-03             | Attribute definitions backend (type/unit/options shape rules); admin UI folded into PH1-04 (plan amended)                                             | PH1-04 (attribute sets + admin UI) |
| 2026-10-05 | Phase 1 (cont.) | PH1-04             | Attribute sets + `forCategory` inheritance resolver + Attributes admin UI; definitions delete guard                                                   | PH1-05 (storefront indexes)        |
| 2026-10-05 | Phase 1 (cont.) | PH1-05             | urlPath + by_url_path, productCategories join (Convex: no array-contains index), attributeValues facets                                               | PH1-06 (products table fields)     |
| 2026-10-05 | Phase 1 (cont.) | PH1-06             | Products field manifest + by_barcode, lib/sku rules, categories.remove products guard; null-key finding                                               | PH1-07 (product editor)            |
| 2026-10-06 | Phase 1 (cont.) | PH1-07             | Product editor + CRUD: SKU verbatim + by_sku uniqueness, same-txn join sync, values diff, E2E 37 checks                                               | PH1-08 (product list)              |
| 2026-10-06 | Phase 1 (cont.) | PH1-08             | Product list: bounded-scan list query + brands facet + bulkStatus (per-changed-row audit), E2E 41 checks                                              | PH1-09 (variants)                  |
| 2026-10-20 | Phase 1 (cont.) | PH1-09             | Variant matrices: cartesian sync w/ preserve-by-coordinate + derived SKUs, SKU namespace shared w/ products, E2E 30 checks                            | PH1-10 (pricing fields)            |
| 2026-10-20 | Phase 1 (cont.) | PH1-10             | Pricing fields: listPrice/costPrice + read-time margin % (staff-only display, negative shown), product price = variant fallback, E2E 19 checks        | PH1-11 (UoM conversions)           |
| 2026-11-05 | Phase 1 (cont.) | PH1-11             | UoM + per-product conversion chains (1 unit = factor × parent, tree to base), doc-level UoM defaults, order-insensitive no-op diff, E2E 33            | PH1-12 (track-flag rules)          |
| 2026-11-05 | Phase 1 (cont.) | PH1-12             | Track-flag rules: 4 shared hard blocks (serial ⊥ lot, expiry ⇒ lot, months ⇒ eligible, shelf ⇒ expiry), UI dependency clears, flags in audit          | PH1-13 (product images)            |
| 2026-11-08 | Phase 1 (cont.) | PH1-13             | Product images already in tree: Cloudinary signed upload (not Convex storage), cover-first `{ fileId, alt }`, gallery reorder; plan catch-up          | PH1-14 (serial/lot schema)         |
| 2026-11-08 | Phase 1 (cont.) | PH1-14             | `serials` + `lots` tables and indexes; state machines, lot date/expiry, warranty lookup. No mutations — UI waits for Phase 5. 235 tests               | PH1-15 (duplicate + archive)       |
| 2026-11-08 | Phase 1 (cont.) | PH1-15             | Duplicate → draft (`-COPY` SKU, no barcode, variants/values/images copied). Archived hidden from list/picker unless the status filter asks. 240 tests | PH1-16 (warehouses)                |
| 2026-11-08 | Phase 1 (cont.) | PH1-16             | Warehouses CRUD: unique code, one default, inactive stays listed. Product list shows the cover. 247 tests                                             | PH1-17 (stock ledger)              |
| 2026-11-08 | Phase 1 (cont.) | PH1-17             | Append-only `stockMovements`: signed qty by type, variant/warehouse/serial guards. No update or delete. Sales can read, not post. 260 tests           | PH1-18 (on-hand / available)       |
| 2026-11-08 | Phase 1 (cont.) | PH1-18             | `balance` and `byWarehouse`: on-hand, reserved, available. Value is on-hand × latest unit cost, a placeholder until moving average. 263 tests                   | PH1-19 (reservation engine)        |
| 2026-11-08 | Phase 1 (cont.) | PH1-19             | `reserve` / `release` / `allocate` in the caller's transaction. A hold cannot exceed available, and a thrown order keeps none of it. 269 tests                  | PH1-20 (manual adjustment)         |
| 2026-11-08 | Phase 1 (cont.) | PH1-20             | `stock.adjust` (`inventory.approve`): reason fixes the sign, removal stops at the hold, optional note and image. 274 tests                                      | PH1-21 (stock transfer)            |
| 2026-11-08 | Phase 1 (cont.) | PH1-21             | Transfers: draft, ship (transfer-out), partial receive (transfer-in), in-transit report. A short ship rolls back. `TR-` sequence. 278 tests                    | PH1-22 (goods receipt)             |
| 2026-11-08 | Phase 1 (cont.) | PH1-22             | Manual `goodsReceipts`: required reference note, `GRN-` number, one ledger receipt per line. A bad line rolls the intake back. No PO. 282 tests                 | PH1-23 (inventory UI)              |
| 2026-11-08 | Phase 1 (cont.) | PH1-23             | Inventory screens: stock list and detail, transfers, adjustments, and the manual receipt pages. Low stock means nothing available until reorder points. 283 tests | PH1-24 (reorder points)            |
| 2026-11-08 | Phase 1 (cont.) | PH1-24             | Reorder points per product, with a warehouse override. Low stock is at or below the point. The daily job notifies inventory editors once per dip. 287 tests | PH1-25 (stock correctness suite)   |
| 2026-11-08 | Phase 1 close   | PH1-25             | Ledger sums match on-hand through receive, transfer, reserve, issue, and adjust. Two reservations started together cannot oversell. 289 tests. Phase 1 gate closed | PH2-01 (customers)                 |
| 2026-11-08 | Phase 2 start   | PH2-01             | Customer companies with contacts, bill/ship addresses, terms, tax, currency, credit limit, and an append-only note timeline. Warehouse can edit, not create. 291 tests | PH2-02 (customer groups)           |
| 2026-11-08 | Phase 2 (cont.) | PH2-02             | One tier per company. Retail, Wholesale, and Institutional start the list. An inactive tier stays on current companies and cannot take a new one. 293 tests | PH2-03 (vendors)                   |
| 2026-11-08 | Phase 2 (cont.) | PH2-03             | Vendor companies with contacts, remit/ship addresses, terms, tax, currency, and a stored license. A past expiry is kept. Warehouse can create, not edit. 295 tests | PH2-04 (product↔vendor links)      |
| 2026-11-08 | Phase 2 (cont.) | PH2-04             | A product names its vendors, one preferred. The vendor SKU is optional. A receipt writes the last purchase price onto an existing link. 297 tests | PH2-05 (statements)                |
| 2026-11-08 | Phase 2 (cont.) | PH2-05             | Customer balance is invoices less credits and payments, zero until those documents exist. A vendor statement lists the receipts that name them. 299 tests | PH2-06 (price lists)               |
| 2026-11-08 | Phase 2 (cont.) | PH2-06             | A base price list, group and customer prices, quantity breaks from qty 2, and a dated promotion. Writes are sales.create. 301 tests | PH2-07 (resolvePrice)              |
| 2026-11-08 | Phase 2 (cont.) | PH2-07             | One price: customer, then group, then list. A break applies only to the winning row. The unit rounds to the currency's decimal places. 308 tests | PH2-08 (price override)            |
| 2026-11-08 | Phase 2 (cont.) | PH2-08             | A line can take a typed price or a percent off, with a reason. Above 10% a second person confirms it. 310 tests | PH2-09 (pricing screens)           |
| 2026-11-08 | Phase 2 (cont.) | PH2-09             | Price lists, group and customer prices, quantity breaks, and a sales-line margin preview. Writes stay sales.create. 311 tests | PH2-10 (pricing test matrix)       |
| 2026-11-08 | Phase 2 (cont.) | PH2-10             | The pricing matrix crosses customer, group, list, and catalog with quantity breaks and overrides. CI runs it with the suite. 313 tests | PH2-11 (quotes)                    |
| 2026-11-08 | Phase 2 (cont.) | PH2-11             | Quotes: lines, tax, a discount through the 10% override, validity, PDF, and one conversion into a draft order that keeps the charged prices. 316 tests | PH2-12 (confirm and reserve)       |
| 2026-11-08 | Phase 2 (cont.) | PH2-12             | Confirm reserves free stock and flags a short line backorder. A line ships in part. Cancel releases the hold. 320 tests | PH2-13 (sales order screen)        |
| 2026-11-08 | Phase 2 (cont.) | PH2-13             | Order screen: customer, ship-to, terms, channel, today's price, availability, and the quote-to-invoice trail. 321 tests | PH2-14 (deliveries)                |
| 2026-11-08 | Phase 2 (cont.) | PH2-14             | Packing slips grouped by warehouse. Ship posts one goods issue with the unit cost and a pending cost-of-goods intent. 324 tests | PH2-15 (delivery PDF)              |
| 2026-11-09 | Phase 2 (cont.) | PH2-15             | Packing-slip PDF and a printable pick list, built in the browser. The slip leaves the unit cost off. 325 tests | PH2-16 (sales invoices)            |
| 2026-11-09 | Phase 2 (cont.) | PH2-16             | Invoices drafted from shipped quantity, with the charged price and tax snapshotted. Posting writes a sales-invoice intent. 329 tests | PH2-17 (credit notes)              |
| 2026-11-09 | Phase 2 (cont.) | PH2-17             | Credit notes against a posted invoice. A return can restock. An adjustment cannot. Posting writes a credit-note intent. 331 tests | PH2-18 (sales returns)             |
| 2026-11-09 | Phase 2 (cont.) | PH2-18             | Returns requested from an invoice or a shipped order. Receive restocks, quarantines, or writes off. Credit or a draft exchange. 333 tests | PH2-19 (order desk)                |
| 2026-11-09 | Phase 2 (cont.) | PH2-19             | Order desk at /sales: open orders, to pick, to ship, to bill, returns pending. 335 tests | PH2-20 (requisitions)              |
| 2026-11-09 | Phase 2 (cont.) | PH2-20             | Requisitions: lines, need-by, requester. Role-gated approve, then one draft purchase order. 337 tests | PH2-21 (purchase orders)           |
| 2026-11-09 | Phase 2 (cont.) | PH2-21             | Purchase orders: agreed price, vendor tax, expected date, send, and a PDF. Receipt and bill move the later statuses. 339 tests | PH2-22 (goods receipts against a PO) |
| 2026-11-09 | Phase 2 (cont.) | PH2-22             | Goods receipts against a sent purchase order. Accepted quantity enters stock at the agreed price and stores a moving average. Rejected quantity stays out. 342 tests | PH2-23 (vendor bills) |
| 2026-11-09 | Phase 2 (cont.) | PH2-23             | Vendor bills from a received order or standalone. Match compares ordered, received, and billed, then writes a vendor-bill intent and marks the order billed. Payment waits. 344 tests | PH2-24 (purchase returns) |
| 2026-11-09 | Phase 2 (cont.) | PH2-24             | Purchase returns from a receipt line. Stock leaves at the receipt cost, and the document number is the debit note. The order and the vendor total stay. 347 tests | PH2-25 (procurement dashboard) |
| 2026-11-09 | Phase 2 (cont.) | PH2-25             | Procurement desk at /procurement: open orders, overdue deliveries, receipts pending, bills pending match. 349 tests | PH2-26 (journal intents) |
| 2026-11-09 | Phase 2 (cont.) | PH2-26             | Goods receipts, debit notes, and stock adjustments write a pending journal intent. /finance lists the backlog. Posting stays Phase 3. 351 tests | PH2-27 (doc-flow) |
| 2026-11-09 | Phase 2 (cont.) | PH2-27             | One document trail on quote, order, delivery, invoice, credit, and return. Payment is named until Phase 3. 356 tests | PH2-28 (PDF kit) |
| 2026-11-09 | Phase 2 (cont.) | PH2-28             | Shared PDF letterhead for quotes, purchase orders, invoices, packing slips, and the pick list. Logo is skipped when it will not embed. 360 tests | PH2-29 (O2C + P2P tests) |
| 2026-11-09 | Phase 2 (cont.) | PH2-29             | Order-to-cash and procure-to-pay through the mutations. Partial delivery, price tolerance, and returns assert stock and pending intents. 364 tests | Phase 2 exit checks |
