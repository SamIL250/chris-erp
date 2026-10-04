# ERP + Ecommerce — Research & Feature Alignment

> **Project:** Multi-category product business ERP (IT equipment → pharmaceutical equipment) with an integrated ecommerce store.
> **Stack:** Next.js (App Router) · Convex (backend/db) · Untitled UI (design system, components, icons)
> **Status:** Research complete — feature list aligned, ready for development.
> **Next:** Build progress is tracked in [`development-plan.md`](./development-plan.md) (phases, tasks, checkboxes).
> **Date:** 2026-10-04

---

## 1. Decisions locked (from scoping)

| Scope question  | Decision                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales model     | **B2B-first, with B2C channel included** — contract pricing, quotes, credit terms for business buyers; guest/retail checkout at list price |
| Finance depth   | **Full double-entry accounting** — chart of accounts, journals, AP/AR, payments, tax, P&L / balance sheet / cash flow                      |
| Operations      | **Single company, multi-warehouse** · **Serial + lot/expiry tracking** · **Service/repair & warranties (RMA)**                             |
| Tax & currency  | **Multi-currency, pluggable tax engine** — country rules configurable, not hard-coded                                                      |
| Ecommerce model | **One system of record** — storefront and ERP share the same Convex database (no sync middleware)                                          |

---

## 2. Research: how existing ERPs are structured

### 2.1 What an ERP actually is

ERP (Enterprise Resource Planning) software unifies core business processes on **one shared database**. The value is not the individual modules — most existed as standalone tools before ERP — it's that a single transaction updates every connected module automatically:

- A **sales order** → reserves inventory → creates pick list → generates invoice → posts to Accounts Receivable → feeds dashboards.
- A **purchase order** → goods receipt increases stock → vendor invoice 3-way match → posts to Accounts Payable → pays from bank.

**Key insight for us:** the ERP product is _the integration_, not the screens. Design the data model so documents link to each other (quote → order → delivery → invoice → payment) before designing any UI.

### 2.2 The standard module map

Every major ERP converges on roughly the same 8 core modules (NetSuite, Oracle, SAP, Dynamics, Odoo, ERPNext all map to this):

| Module                                     | Responsibility                                                  | Needed by us?                                |
| ------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------- |
| **Finance & Accounting**                   | General ledger, AP, AR, tax, fixed assets, financial reporting  | ✅ Yes (core)                                |
| **Procurement / Purchasing**               | Vendors, requisitions, POs, goods receipt, invoice matching     | ✅ Yes                                       |
| **Inventory Management**                   | Stock by SKU/location, valuation, adjustments, reservations     | ✅ Yes (core)                                |
| **Warehouse Management (WMS)**             | Receiving, put-away, picking, packing, shipping, cycle counts   | ✅ Yes (light)                               |
| **Sales & Order Management**               | Quotes, orders, pricing/discounts, delivery, invoicing, returns | ✅ Yes (core)                                |
| **CRM**                                    | Accounts, contacts, pipeline, communication history             | ⚠️ Light version (accounts/contacts/history) |
| **Manufacturing / MRP**                    | BOMs, production orders, shop floor                             | ❌ Out of scope (trading business)           |
| **HR / Payroll**                           | Employees, payroll, attendance                                  | ❌ Out of scope → defer/integrate            |
| **Business Intelligence**                  | Dashboards, KPIs, drill-down reporting                          | ✅ Yes                                       |
| **Ecommerce / POS**                        | Online store, in-store selling                                  | ✅ Ecommerce yes, POS deferred               |
| **Quality / Service (QMS, Field Service)** | CAPA, RMA, warranty, service contracts                          | ✅ Service/RMA yes (light QMS)               |

### 2.3 Reference systems studied

| System                                                               | Stack               | What we take from it                                                                                                             |
| -------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **SAP S/4HANA**                                                      | ABAP/HANA           | Module separation (FI finance, MM materials, SD sales) and strict document flow discipline                                       |
| **Oracle NetSuite**                                                  | Cloud multi-tenant  | Module list for mid-market; SuiteCommerce = ERP + store on one DB (same idea as ours)                                            |
| **Microsoft Dynamics 365 BC**                                        | Cloud               | Order-to-cash / procure-to-pay process definitions, approval workflows                                                           |
| **Odoo**                                                             | Python + PostgreSQL | Modular app architecture, **one DB shared by ERP + website store**, doc-flow UI (quote→order→invoice buttons), price-list engine |
| **ERPNext**                                                          | Python (Frappe)     | Lightweight item master with attributes, serial/batch docs, sensible SMB defaults                                                |
| **Tryton**                                                           | Python + PostgreSQL | **Rigorous double-entry accounting**: append-only entries, period locking, no editing posted docs — only reversal                |
| **metasfresh**                                                       | Java                | Wholesale specifics: FEFO/batch/best-before as core, not add-ons                                                                 |
| **Dolibarr**                                                         | PHP                 | Progressive module activation — ship core, toggle advanced features                                                              |
| **B2B commerce platforms** (K-ecommerce, Clarity, Generator, B2Sell) | Various             | Ecommerce↔ERP integration feature checklist (contract pricing, account hierarchy, RFQ, re-order paths)                           |
| **Medical/Pharma ERPs** (Expandable, Ximple, Arion, Yaveon, VAI)     | Various             | Compliance features: lot/serial traceability, FEFO, license checks, recall reports, audit trail                                  |

### 2.4 The two core process cycles every ERP runs

**Order-to-Cash (O2C)** — money in:

1. Receive & validate customer order (manual, phone, or ecommerce)
2. Check customer credit / terms / pricing
3. Confirm & reserve stock (availability check)
4. Fulfill: pick → pack → ship (goods issue reduces stock, posts COGS)
5. Generate invoice → Accounts Receivable
6. Collect payment → apply to invoice → reconcile

**Procure-to-Pay (P2P)** — money out:

1. Identify need (manual or auto: low-stock reorder point)
2. Purchase requisition → approval by threshold
3. Purchase order issued to vendor
4. Goods receipt (increases stock, GR/IR clearing)
5. Vendor invoice → **3-way match** (PO ↔ receipt ↔ invoice, with tolerance)
6. Payment issued → reconcile → Accounts Payable cleared

_Exceptions matter as much as the happy path:_ partial deliveries, price variance, rush orders, returns, credit notes. Our data model must handle them from day one.

### 2.5 Ecommerce + ERP: the integration patterns (and our advantage)

Two patterns exist in the market:

1. **Two systems + middleware** (Shopify/Medusa/Saleor + NetSuite/SAP): requires a sync layer, SKU mapping, retry logic, conflict resolution. Research is blunt: _"ERP integration is where headless commerce budgets go to die"_ — data mapping, not APIs, is the cost.
2. **One system of record** (Odoo website, SuiteCommerce): the storefront reads/writes the same database as the ERP. No sync, no drift, price/stock always accurate.

**We are building pattern #2.** Next.js storefront + Next.js admin both talk to the same Convex backend. This is the single biggest architectural win of the project — cart, checkout, pricing and stock are resolved in real time against ERP data with zero integration code.

**Storefront ↔ ERP data ownership rules** (adopted from industry guidance — every field gets exactly one authoritative owner):

| Data                                   | Owner                                        | Consumers                                |
| -------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| Product master, categories, attributes | ERP (Convex catalog)                         | Storefront (read)                        |
| Prices & discounts                     | ERP pricing engine                           | Storefront (read, resolved per customer) |
| Stock / availability                   | ERP inventory                                | Storefront (read)                        |
| Carts, checkout, storefront orders     | Commerce (same Convex DB)                    | ERP order desk (read/manage)             |
| Payments                               | Payment provider (Stripe) via Convex actions | ERP (read status)                        |
| Marketing content / pages              | CMS tables (Convex)                          | Storefront (read)                        |

### 2.6 Domain-specific requirements (mixed IT + pharma equipment)

The product range drives the hardest requirements:

**IT equipment (laptops, servers, networking, peripherals):**

- **Serial number tracking** per unit — sales, warranty, RMA, theft control
- **Warranty registration & lookup** (start date, duration, provider), warranty claim flow
- **Variants** (color/storage/config), bundles/kits (server + drives + cables)
- Model/attribute-based search and filtering (compatibility specs)
- Depreciating goods → expiry is irrelevant, but _obsolescence_ and price-drop handling matter

**Pharmaceutical / medical equipment & consumables:**

- **Lot/batch + expiration date** tracking, **FEFO** (First-Expired-First-Out) picking
- **Hard blocks**: expired/quarantined/recalled lots cannot be sold
- **Traceability forward & backward**: which supplier lot → which customer shipment (recall in minutes)
- **License checks**: customer/supplier licenses (number, jurisdiction, expiry) with ship-blocking on lapse
- **Short-dated stock alerts** to reduce write-offs
- **Cold-chain flags** (temperature-sensitive items) — optional storage condition logs
- **Quarantine / returns-to-stock workflow**: returned goods land quarantined → inspection → approved back to saleable
- **Recall management report**: affected customers, quantities shipped/recovered
- **Audit trail**: who changed what, when (regulatory expectation)

**Common to both:** barcode/QR scanning, unit-of-measure handling, serial _or_ lot policy per product (configurable), full document history.

### 2.7 Design principles extracted from the research

1. **One database, one source of truth** — the ERP _is_ the integration (Odoo/SuiteCommerce pattern).
2. **Finance is the backbone** — every operational document posts somewhere in the ledger; design operations so accounting is automatic.
3. **Documents, not rows** — quote → order → delivery → invoice → payment must be linked and traceable ("doc flow").
4. **Posted documents are immutable** — fix mistakes with reversal/credit note, never by editing (Tryton rigor). Append-only journal + audit log.
5. **Compliance is a schema decision, not a feature** — lot/serial/expiry fields must exist in v1 inventory schema even if UI lands later.
6. **Approval workflows by threshold** — configurable rules (e.g., discount > X% or order > $Y needs approval).
7. **Phased adoption** — real ERPs go live with 3–6 modules and expand; ship in phases (see roadmap).
8. **Progressive disclosure** — advanced features toggleable per role (Dolibarr) so the UI doesn't overwhelm.

---

## 3. System architecture

```
┌────────────────────────────  Next.js (App Router)  ───────────────────────────┐
│                                                                              │
│  /(store)  Ecommerce storefront          /(admin)  ERP back-office           │
│  catalog · search · cart · checkout      dashboard · catalog · inventory     │
│  account: orders · invoices · quotes     sales · procurement · finance       │
│  B2B portal: pricing, reorder, RFQ       warehouse · service · reports       │
│                                                                              │
└───────────────┬───────────────────────────────────────────┬──────────────────┘
                │        Convex client (reactive)           │
┌───────────────▼───────────────────────────────────────────▼──────────────────┐
│                              CONVEX (single backend)                         │
│  tables: org/users/roles · products/categories/attrs · warehouses/stock ·    │
│          lots/serials · vendors/POs/GRN · customers/quotes/orders/deliveries │
│          invoices/payments · accounts/journal · returns/RMA/warranty ·        │
│          carts/checkout · auditLog                                            │
│  queries (read) · mutations (transactional writes) · actions (external APIs)  │
│  crons (expiry alerts, low-stock, scheduled reports) · storage (media)        │
└──────────┬──────────────┬──────────────┬──────────────┬──────────────────────┘
           │              │              │              │
        Stripe        Resend/email    PDF docs      Barcode scanning
      (payments)     (notifications) (invoices,     (camera-based in
                                   POs, labels)      warehouse UI)
```

**Stack notes:**

- **One Next.js app, two route groups** (`(store)` and `(admin)`) — shares components, types, Convex client; simplest for a small team. Split into two apps later only if needed.
- **Untitled UI**: React component library (MIT, open-source base, install via CLI, source-owned copy-paste components, built on React Aria + Tailwind v4) + **Untitled UI Icons** (1,100 free line icons via `@untitledui/icons`; PRO has 4,600+). Use for all forms, tables, dialogs, nav, charts containers, empty states.
- **Auth:** Convex Auth (email/password + OAuth), roles/permissions in DB, enforced in every mutation.
- **Payments:** Stripe (cards for B2C; payment links/invoices for B2B) — behind a Convex action so provider is swappable.
- **PDF:** server-generated invoices/POs/labels (React Email + PDF renderer).
- **Search:** Convex keyword search + attribute indexes initially; external search (Typesense/Algolia) only if catalog scale demands it.
- **Reporting:** maintained aggregates (running balances, daily rollups) via Convex scheduler — never compute reports by scanning full tables at request time.

---

## 4. Feature list (aligned)

Priority: **P0** = required for first usable release · **P1** = next · **P2** = later/optional

### 4.1 Foundation & platform

| Priority | Feature                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Auth (email/password, OAuth), sessions, password reset                                                                                        |
| P0       | RBAC — roles (Owner, Admin, Sales, Warehouse, Accountant, Storefront-only) + fine-grained permissions per module/action                       |
| P0       | Org settings: company profile, logo, addresses, document numbering sequences (INV-0001, PO-0001…), date/number formats                        |
| P0       | Multi-currency setup: base currency + exchange rates, per-customer/basket currency                                                            |
| P0       | Tax engine: named tax rates, inclusive/exclusive, multiple rates per region, customer tax group, product tax category — pluggable per country |
| P0       | Audit log: append-only record of who changed what (entity, action, before/after)                                                              |
| P0       | Notification center: in-app toasts/bell + email for key events (approval needed, low stock, payment received)                                 |
| P1       | Approval workflows engine: threshold rules (discount %, order value, credit override) with approver roles                                     |
| P1       | File storage: product images, attachments on documents, signed URLs                                                                           |
| P1       | Global search across records (customers, products, documents)                                                                                 |
| P2       | Feature toggles per organization/role; custom fields on entities                                                                              |

### 4.2 Product catalog & categories

| Priority | Feature                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Multi-level category tree (e.g., IT > Servers > Rack Servers), slug, SEO fields, visibility toggle, reorder                                                                                                             |
| P0       | Product master: name, SKU, barcode, brand/vendor, description (rich), images, status (draft/active/archived)                                                                                                            |
| P0       | Variants (attribute-based: size/config/color) with own SKU/price/stock                                                                                                                                                  |
| P0       | **Attribute sets per category** — IT products carry specs (CPU, RAM, warranty months); pharma items carry (registration no., storage temp, batch-controlled flag). One flexible attribute system, assigned per category |
| P0       | Units of measure + pack sizes (each/box/case) with conversion                                                                                                                                                           |
| P0       | Trackable flags per product: **serial-tracked**, **lot/batch-tracked**, **expiry-required**, **warranty-eligible**                                                                                                      |
| P0       | Cost price & list price fields; margin display for staff                                                                                                                                                                |
| P1       | Bundles/kits (sell configured package = components)                                                                                                                                                                     |
| P1       | Related/compatible products, cross-sell rules                                                                                                                                                                           |
| P1       | Supplier linking: preferred vendor(s), vendor SKU, last purchase price                                                                                                                                                  |
| P1       | Import/export CSV (products, categories, prices)                                                                                                                                                                        |
| P2       | Digital assets (datasheets/certificates) attached to product; revision control                                                                                                                                          |

### 4.3 Inventory & warehouse

| Priority | Feature                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Multiple warehouses/locations with per-warehouse stock ledger                                                                                        |
| P0       | Stock on hand = derived from append-only **stock movement ledger** (receipt, issue, transfer, adjustment) — never a mutable counter alone            |
| P0       | Stock reservations against open sales orders (available vs. on-hand)                                                                                 |
| P0       | Stock transfers between warehouses with status workflow (draft → in-transit → received)                                                              |
| P0       | Manual adjustments with reason codes + approval                                                                                                      |
| P0       | Goods receiving against purchase orders (partial receipts allowed)                                                                                   |
| P0       | Reorder points & low-stock alerts per product/warehouse                                                                                              |
| P1       | **Serial number tracking**: register serials on receipt, assign on shipment, full lifecycle history (in-stock → sold → RMA → returned/refurbished)   |
| P1       | **Lot/batch + expiry tracking**: lot master (supplier, received date, expiry), FEFO pick suggestions, short-dated alerts, hard block on expired lots |
| P1       | Picking/packing workflow per delivery: pick list, pack confirmation, shipment notes                                                                  |
| P1       | Barcode/QR scanning via device camera (receive, pick, count, lookups)                                                                                |
| P1       | Cycle counting (scheduled count sheets vs. system stock, variance posting)                                                                           |
| P2       | Quarantine/inspection stock status; returns-to-stock with approval                                                                                   |
| P2       | Batch/serial pick lists, label printing templates                                                                                                    |

### 4.4 Procurement (procure-to-pay)

| Priority | Feature                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Vendor master: contacts, addresses, payment terms, currency, tax/ license fields                                                 |
| P0       | Purchase orders: lines, pricing, tax, expected delivery, status workflow (draft → sent → partially received → received → billed) |
| P0       | Goods receipt against PO (link to inventory receiving)                                                                           |
| P0       | Vendor bills (purchase invoices) with **2/3-way match** (PO ↔ receipt ↔ bill) + tolerance handling                               |
| P1       | Purchase requisitions with approval thresholds                                                                                   |
| P1       | RFQ: request quotes from multiple vendors, compare, convert to PO                                                                |
| P1       | Vendor payments (full/partial), payment terms, due-date tracking                                                                 |
| P1       | Vendor performance view (on-time, price variance, defect/return history)                                                         |
| P2       | Blanket/contract POs, auto-replenishment suggestions from reorder points                                                         |
| P2       | Drop-ship flow (vendor ships directly to customer)                                                                               |

### 4.5 Sales & order management (order-to-cash)

| Priority | Feature                                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Customer master: company + contacts, addresses (bill/ship-to), payment terms, tax group, credit limit, notes                                                                                          |
| P0       | **Pricing engine**: base list price → customer group tiers → customer-specific contract price → volume/quantity breaks → manual override (with approval) — same engine serves ERP desk and storefront |
| P0       | Quotes/estimates: lines, discounts, expiry, send → convert to sales order (one click)                                                                                                                 |
| P0       | Sales orders: stock check & reservation, partial fulfillment, status workflow (draft → confirmed → picking → shipped → invoiced → closed)                                                             |
| P0       | Delivery notes / packing slips; goods issue posts stock out                                                                                                                                           |
| P0       | Sales invoices generated from order/delivery; credit notes for returns                                                                                                                                |
| P0       | Returns/RMA: request → approval → receive back (inspect) → refund/exchange/repair; restock or write-off decision                                                                                      |
| P1       | Customer payments: record against invoices, partial payments, unapplied cash                                                                                                                          |
| P1       | Deposit/down-payment & split payment terms                                                                                                                                                            |
| P1       | Backorders & back-in-date notifications                                                                                                                                                               |
| P1       | Sales orders created from storefront orders automatically (same DB — order desk sees them live)                                                                                                       |
| P2       | Consignment, sales commissions/rep attribution                                                                                                                                                        |

### 4.6 Finance (double-entry)

| Priority | Feature                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Chart of accounts (seeded default + editable), account types (asset/liability/equity/income/expense)                                                                                                |
| P0       | Journal entries: manual journals with debit=credit validation, period locking (closed periods immutable)                                                                                            |
| P0       | **Automatic postings from operations**: sales invoice → AR + revenue + tax; goods issue → COGS + inventory; receipt → inventory + GR/IR; vendor bill → AP + expense/inventory; payments clear AP/AR |
| P0       | Accounts receivable: customer statements, aging report, dunning-ready list                                                                                                                          |
| P0       | Accounts payable: vendor bills due, aging report                                                                                                                                                    |
| P0       | Payments in/out with bank/cash accounts; basic bank reconciliation (match statement lines to entries)                                                                                               |
| P0       | Tax reports: tax collected vs. tax paid by period (pluggable for local formats)                                                                                                                     |
| P0       | Financial reports: **Profit & Loss, Balance Sheet, Cash Flow**, trial balance, general ledger detail — by period                                                                                    |
| P1       | Fixed assets-lite: register + straight-line depreciation schedules                                                                                                                                  |
| P1       | Budget vs. actual by account                                                                                                                                                                        |
| P1       | Multi-currency: revaluation of open balances, realized/unrealized gain/loss                                                                                                                         |
| P2       | e-invoicing/export formats, audit export pack                                                                                                                                                       |

### 4.7 Ecommerce storefront (B2C + B2B)

| Priority | Feature                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0       | Storefront pages: home, category, product detail (variants, gallery, specs table, stock badge), search, static pages                                                                             |
| P0       | Faceted search/filter: category, brand, price, attributes (spec-based filtering for IT gear)                                                                                                     |
| P0       | Cart: add/remove/qty, persisted for logged-in users, tax & shipping estimate                                                                                                                     |
| P0       | Guest checkout (B2C) at list price with card payment (Stripe)                                                                                                                                    |
| P0       | Customer accounts: register/login, addresses, order history, invoice download                                                                                                                    |
| P0       | Storefront orders write directly into ERP order flow (validation, stock reservation, pricing engine)                                                                                             |
| P0       | SEO: meta, slugs, sitemap, structured data, OG images                                                                                                                                            |
| P1       | **B2B portal**: company account with multiple users, contract pricing on login, credit terms/PO-number checkout, approval before shipment, order history & reorder, download invoices/statements |
| P1       | Quote request (RFQ) from cart → converts to ERP quote → customer approves → order                                                                                                                |
| P1       | Wishlists / saved lists, saved carts, quick reorder from history                                                                                                                                 |
| P1       | Promotions: coupon codes, %/fixed discounts, category/product sales, free-shipping thresholds                                                                                                    |
| P1       | Inventory-aware messaging: in-stock / low-stock / backorder, "notify me"                                                                                                                         |
| P1       | Shipping options & rates (flat, free threshold, per-weight/zone); tax calculation at checkout from ERP tax engine                                                                                |
| P1       | Order confirmation + shipping emails                                                                                                                                                             |
| P2       | Product reviews/ratings (moderated)                                                                                                                                                              |
| P2       | Multiple storefront channels/currencies, blog/content pages                                                                                                                                      |
| P2       | Related products, recently viewed, personalization                                                                                                                                               |

### 4.8 Service, repair & warranty

| Priority | Feature                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Warranty terms on products; **serial → warranty status lookup** (valid / expired / remaining months)                                                                      |
| P1       | RMA/warranty claim flow: claim intake → inspection → outcome (repair, replace, refund, reject) → linked to original order/serial                                          |
| P1       | Service/repair orders: job intake for customer equipment, status (received → diagnosing → waiting parts → repaired → ready), labor & parts costing, invoice on completion |
| P1       | Warranty registration for sold units (auto from sales order; manual for walk-ins)                                                                                         |
| P2       | Service contracts/AMC with recurring billing & scheduled preventive maintenance reminders                                                                                 |
| P2       | Field visits / technician scheduling (light)                                                                                                                              |

### 4.9 CRM (light)

| Priority | Feature                                                              |
| -------- | -------------------------------------------------------------------- |
| P0       | Accounts & contacts with tags/segments, communication notes timeline |
| P1       | Lead/opportunity pipeline (kanban) for B2B deals → converts to quote |
| P1       | Activity log: calls, emails, tasks with reminders                    |
| P2       | Email sync (Gmail/Outlook), campaign mailing lists                   |

### 4.10 Reporting & dashboards

| Priority | Feature                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Executive dashboard: revenue (period), orders, gross margin, cash position, top products, low-stock alerts                                                 |
| P0       | Sales reports: by product/category/customer/period, sales rep performance                                                                                  |
| P0       | Inventory reports: stock on hand by warehouse, valuation (moving average/FIFO), stock movements, aging/slow-moving, **expiry exposure (short-dated lots)** |
| P0       | Financial reports (see 4.6)                                                                                                                                |
| P1       | Procurement reports: spend by vendor, PO status, price variance                                                                                            |
| P1       | Ecommerce analytics: conversion funnel basics, channel attribution (ERP vs. store)                                                                         |
| P1       | **Traceability report**: search lot/serial → forward (who received it) & backward (which supplier lot) — recall pack                                       |
| P1       | Scheduled report exports (CSV/Excel) & email digests                                                                                                       |
| P2       | Custom report builder, saved views per user                                                                                                                |

### 4.11 Automation

| Priority | Feature                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| P0       | Scheduled jobs (Convex crons): daily low-stock & expiry alerts, order due reminders, report digests              |
| P1       | State-machine automations: auto-cancel unpaid orders after X days, auto-receive transfers, auto-post on shipment |
| P1       | Webhook/API endpoints for external systems (POS later, courier APIs, e-commerce channels)                        |
| P2       | Reorder suggestions engine (usage rate × lead time)                                                              |
| P2       | AI assists (draft product descriptions, anomaly detection on margin)                                             |

---

## 5. Core data flows to build first

**Order-to-cash (single path, powers both ERP desk and storefront):**

```
Quote (optional) → Sales Order → [reserve stock] → Delivery/Pick-Pack-Ship
      → [stock ledger issue + COGS] → Invoice → [AR journal] → Payment → [cash journal, AR cleared]
Storefront checkout = entry point straight into "Sales Order" with payment captured.
```

**Procure-to-pay:**

```
Reorder alert / manual requisition → approval → Purchase Order → Goods Receipt
      → [stock ledger receipt] → Vendor Bill (3-way match) → [AP journal] → Payment → [AP cleared]
```

**Traceability:**

```
Supplier lot received → stock ledger → allocated to delivery → customer shipment
      ↺ recall lookup runs both directions from any lot/serial
```

---

## 6. Roadmap (phased, research-backed)

| Phase                            | Deliverable                                                                                                                                                   | Exit criteria                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **0 — Foundation**               | Project scaffold, Untitled UI setup, auth, RBAC, org settings, audit log, layout/nav shell                                                                    | Team can log in with roles                |
| **1 — Catalog + Inventory core** | Categories, attributes, products/variants, warehouses, stock ledger, receiving, transfers, alerts — **schema includes serial/lot/expiry fields from day one** | Stock accurate per warehouse              |
| **2 — Sales & Procurement**      | Customers, vendors, pricing engine, quotes, sales orders, deliveries, POs, receipts, bills, returns/RMA                                                       | Full O2C + P2P without finance close      |
| **3 — Finance**                  | COA, auto-postings, journals, AR/AP, payments, tax, multi-currency, core financial reports, period close                                                      | Trial balance ties out; reports generated |
| **4 — Ecommerce**                | Storefront (B2C guest checkout + accounts), faceted search, promotions, shipping/tax at checkout, B2B portal with contract pricing + RFQ                      | Live store selling real stock             |
| **5 — Traceability & Service**   | Serial/lot workflows & FEFO, warranty lookup/registration, recall/traceability reports, service/repair orders                                                 | Recall pack producible in minutes         |
| **6 — Depth & polish**           | Approvals engine, cycle counting, fixed assets, dashboards depth, automation, reviews, exports                                                                | Production-hardened                       |

_Schema-first rule:_ anything marked "P1" that affects the data model (serials, lots, warranty, service orders) gets its **tables designed in Phase 1** — only the UI/workflows wait.

---

## 7. Explicitly out of scope (for now)

- Manufacturing / MRP / BOMs (trading & distribution business)
- HR, payroll, attendance
- Multi-company / multi-tenant consolidation
- POS / physical retail terminals
- EDI & punchout catalogs (Ariba/Coupa) — enterprise procurement, revisit later
- Full QMS (CAPA, document control, electronic signatures per 21 CFR Part 11) — we provide _traceability & audit trail_, not certified compliance
- Cold-chain IoT temperature capture (manual notes on lots only, P2)
- Native mobile apps (responsive web only)

---

## 8. Risks & watch-outs

| Risk                                              | Mitigation                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Convex read cost/scale on storefront traffic      | Public catalog reads stay cheap via indexes + caching headers; heavy reporting uses pre-aggregated rollups, never full scans         |
| Accounting correctness (the hardest part)         | Append-only journal, debits==credits enforced, period locking, reversal-not-edit rule, reconciliation report from day one of Phase 3 |
| Scope creep (ERP projects famously fail on scope) | Phase gates above; anything new = re-prioritize the list, not append                                                                 |
| Search quality on large catalog                   | Convex keyword/attribute indexes first; external search engine only if needed                                                        |
| Mixed-category UI getting cluttered               | Attribute sets per category + progressive disclosure (advanced panels hidden by default)                                             |
| Stock race conditions (2 buyers, last unit)       | Reservation logic inside single Convex mutations (transactional)                                                                     |

---

## 9. Open questions (non-blocking)

1. Payment provider — Stripe assumed; confirm availability in target market (for B2B: bank transfer/manual credit too).
2. Email provider — Resend assumed.
3. Which country's tax defaults to seed first (engine stays pluggable)?
4. Estimated catalog size (SKU count) — affects search & import tooling.
5. Who validates the accounting reports (accountant sign-off in Phase 3).

---

_Research sources: NetSuite/Oracle/Dynamics module guides, SAP S/4HANA module docs, open-source ERP comparisons (Odoo, ERPNext, Tryton, Dolibarr, metasfresh, Axelor), B2B ecommerce integration platforms (K-ecommerce, Clarity, Generator, B2Sell, VARStreet), medical/pharma ERP vendors (Expandable, Ximple, Arion, Yaveon, VAI, JMJ), O2C/P2P process documentation (Acumatica, Microsoft, SAP), headless commerce cost/structure analyses._
