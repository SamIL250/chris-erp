# Development Plan — ERP + Ecommerce (Phased Build)

> **Companion to:** [`erp-research-and-features.md`](./erp-research-and-features.md) (research, decisions, feature priorities)
> **Stack:** Next.js (App Router) · Convex · Untitled UI (components + icons) · Stripe · Resend · Tailwind v4
> **Status:** Ready to start — Phase 0
> **Last updated:** 2026-10-04

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
| **Phase 0**    | Foundation (scaffold, auth, RBAC, settings, shell) | 🔨 In progress | 16 / 35 | ☐    |
| **Phase 1**    | Catalog + Inventory core (schema-first)            | ⬜ Not started | 0 / 25  | ☐    |
| **Phase 2**    | Sales & Procurement (O2C + P2P documents)          | ⬜ Not started | 0 / 29  | ☐    |
| **Phase 3**    | Finance (double-entry, postings, reports)          | ⬜ Not started | 0 / 17  | ☐    |
| **Phase 4**    | Ecommerce storefront (B2C + B2B portal)            | ⬜ Not started | 0 / 24  | ☐    |
| **Phase 5**    | Traceability & Service (serial/lot/FEFO, warranty) | ⬜ Not started | 0 / 17  | ☐    |
| **Phase 6**    | Depth, automation & hardening (go-live)            | ⬜ Not started | 0 / 27  | ☐    |
| **Continuous** | Tests, CI, docs, seed data                         | 🔨 Ongoing     | 0 / 6   | —    |

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

- [ ] A new user can sign up, be assigned a role, log in, and sees only permitted nav/actions
- [ ] Company profile, numbering sequences, base currency, tax rates configurable via UI
- [ ] Audit log records every mutation performed in the app
- [ ] Seed script produces demo org + users; CI (typecheck/lint/test) green

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
- [x] **PH0-13** Route protection middleware: unauthenticated → `(auth)`; storefront vs admin access by role (auth-level done; permission-derived route gating lands with PH0-23)
- [ ] **PH0-14** Global search box (searches customers/products/documents by phase availability — grows with features)
- [x] **PH0-15** Dashboard placeholder page with KPI tiles (values `—` until data exists)
- [ ] **PH0-16** Error boundary, 404, loading conventions, toast system wired

### 0.4 Auth & user management

- [x] **PH0-17** Convex Auth: email/password + Google OAuth; login, signup, logout, forgot/reset password pages (Untitled UI)
- [ ] **PH0-18** `users` profile table (name, avatar, role, status active/invited/disabled), profile settings page
- [ ] **PH0-19** Admin: invite user by email → invitee sets password → lands with assigned role
- [ ] **PH0-20** Session handling, auth rate limiting, security headers

### 0.5 RBAC

- [x] **PH0-21** Permission matrix spec (doc in repo): modules × actions (view/create/edit/delete/approve/post) for roles: **Owner, Admin, Sales, Warehouse, Accountant, Storefront (customer)**
- [ ] **PH0-22** `roles` + `userRoles` tables; `requirePermission(module, action)` helper used by every mutation; permission tests (denied access proves 403-equivalent error)
- [ ] **PH0-23** UI gating: nav items, buttons, route access derived from permissions (single `useCan()` hook)

### 0.6 Platform tables & core helpers

- [ ] **PH0-24** `schema.ts` foundations: `organizations` (single-company config), `users`, `roles`, `settings`, `sequences`, `currencies`, `exchangeRates`, `taxRates`, `taxGroups`, `auditLog`, `notifications`, `files`
- [ ] **PH0-25** `nextSequence(name)` document-number generator (INV-, SO-, PO-, QT-, DN-, CR-, JRNL-…)
- [ ] **PH0-26** `audit()` helper: append-only before/after snapshots, wired into a generic mutation wrapper; **audit log viewer UI** (filter by actor/entity/date)
- [ ] **PH0-27** File storage: Convex storage upload, signed URLs, image upload component (used later by catalog)
- [ ] **PH0-28** Notification center: in-app bell + list + read/unread; `notify()` helper for future events

### 0.7 Settings & configuration

- [ ] **PH0-29** Company settings: legal name, logo, addresses, contacts, tax ID, invoice footer/notes — displayed on future documents
- [ ] **PH0-30** Document numbering settings UI (view/edit sequences, preview format)
- [ ] **PH0-31** Currency settings: base currency, exchange-rate list + manual update (used by pricing in Phase 2)
- [ ] **PH0-32** Tax engine config UI: create rates (name, %, inclusive/exclusive), tax groups (customer assign), product tax categories (standard/reduced/zero/exempt)
- [ ] **PH0-33** Date/number formatting preferences (locale, timezone)

### 0.8 Seed & quality

- [ ] **PH0-34** Seed script: demo org, one user per role, currencies, tax rates, sequences — idempotent
- [ ] **PH0-35** Permission + audit tests green in CI; mutation helper coverage for future code

---

## 3. Phase 1 — Catalog & Inventory Core (schema-first)

**Goal:** Correct, auditable stock for multi-category products across warehouses — including the schema for serials/lots/expiry/warranty that later phases activate.
**Exit criteria:**

- [ ] Full product catalog maintainable (categories, attributes, variants, images)
- [ ] Stock per warehouse provably correct under test (receipts, issues, transfers, adjustments)
- [ ] `onHand` vs `available` (reserved) distinction working; low-stock alerts firing
- [ ] Serial/lot/expiry/warranty **tables exist** with tests around helpers (UI waits for Phase 5)

### 1.1 Categories & attributes

- [ ] **PH1-01** Category tree: CRUD nested nodes, slug auto + unique, SEO title/description, visibility toggle, manual ordering, move/reparent rules
- [ ] **PH1-02** Category admin UI: tree view + side editor, product counts, "uncategorized" handling
- [ ] **PH1-03** Attribute definitions: name + type (text, number, select, multi-select, boolean, date) + optional units
- [ ] **PH1-04** Attribute **sets**: group attributes, assign set(s) to category → products in that category inherit fields
- [ ] **PH1-05** Storefront-ready indexes: category path/products-by-category, attribute filters index

### 1.2 Product master

- [ ] **PH1-06** `products` table: name, slug, SKU, barcode, brand, short/long description (rich), status (draft/active/archived), taxCategory, track flags, warranty/shelf-life fields, UoM, images[], categoryIds[], attributeSetIds[]
- [ ] **PH1-07** Product create/edit page: sections (Basic, Pricing, Attributes [dynamic from set], Inventory/Tracking, Media, SEO), autosave draft, validation
- [ ] **PH1-08** Product list: reactive table — filter by category/brand/status/flags, search by name/SKU/barcode, bulk status change, column sort
- [ ] **PH1-09** Variants: option axes (from set attributes e.g. color/config) → variant matrix, per-variant SKU/price/barcode/track flags; product-level defaults fill variants
- [ ] **PH1-10** Pricing fields: `listPrice`, `costPrice` (display only — true moving average cost computed in inventory/finance), margin % shown to staff roles
- [ ] **PH1-11** Units of measure + conversions (each → box → case) with purchase/sales UoM
- [ ] **PH1-12** Track flags + fields per product: `serialTracked`, `lotTracked`, `expiryRequired`, `warrantyEligible`, `warrantyMonths`, `shelfLifeDays`, `allowBackorder`
- [ ] **PH1-13** Images via Convex storage (upload, reorder, cover image), alt text
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
- [ ] **CT-06** Session log: brief entry (what shipped, decisions, next up) appended to §12

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

| Date       | Session      | Shipped (task IDs) | Decisions / notes                                              | Next up                 |
| ---------- | ------------ | ------------------ | -------------------------------------------------------------- | ----------------------- |
| 2026-10-04 | Plan created | —                  | Research doc + development plan aligned with scoping decisions | Start Phase 0 (PH0-01…) |
