# chris-erp

Multi-category product business ERP (IT equipment → pharmaceutical equipment) with an
integrated ecommerce store — one database powering both the back office and the storefront.

**Stack:** Next.js 16 (App Router) · Convex · Untitled UI (components + icons) · Tailwind v4 ·
Stripe · Resend · Vitest/convex-test

## Documentation

| Doc                                                                      | Purpose                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`docs/erp-research-and-features.md`](docs/erp-research-and-features.md) | Research on existing ERPs, architecture decisions, full feature list (P0/P1/P2) |
| [`docs/development-plan.md`](docs/development-plan.md)                   | **Build progress** — phases, task checkboxes, status board                      |
| [`docs/permissions.md`](docs/permissions.md)                             | RBAC permission matrix (roles × modules × actions)                              |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local   # then fill in Convex values

# 3. Start Convex (creates/links a dev deployment, generates convex/_generated)
npm run convex:dev

# 4. In another terminal — start Next.js
npm run dev
```

Open http://localhost:3000.

## Scripts

| Script                            | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `npm run dev`                     | Next.js dev server (Turbopack)            |
| `npm run build`                   | Production build                          |
| `npm run lint`                    | ESLint (flat config, Prettier-compatible) |
| `npm run typecheck`               | `tsc --noEmit` (TypeScript strict)        |
| `npm run format` / `format:check` | Prettier write / check                    |
| `npm test` / `npm run test:watch` | Vitest + convex-test                      |
| `npm run convex:dev`              | Convex dev deployment watcher             |
| `npm run convex:deploy`           | Convex production deploy                  |

## Structure

```
app/
├── (admin)/      # ERP back office (dashboard, catalog, inventory, sales, …)
├── (store)/      # Ecommerce storefront
├── (auth)/       # login, signup, password reset
└── api/          # route handlers (webhooks, sitemap)
convex/
├── schema.ts     # all tables + indexes
├── _lib/         # auth, permissions, audit, sequences helpers
└── <domain>/     # queries / mutations per domain
components/
├── ui/           # Untitled UI primitives (wrapped once)
└── <feature>/    # feature components
lib/              # shared utils, status unions, formatting
tests/            # vitest + convex-test
```

## Conventions (short version)

- Tables plural camelCase; index everything you filter by; paginate every list.
- Money = **integer minor units** + currency field. Never floats.
- Posted accounting documents are **immutable** — reverse/credit, never edit.
- Business rules live **inside Convex mutations**, never only in the UI; every
  state change writes an audit log entry.
- Document flow: Quote → Sales Order → Delivery → Invoice → Credit Note;
  Requisition → PO → Receipt → Bill → Payment.

## CI

GitHub Actions runs typecheck, lint, format check, tests, and build on every push/PR
(`.github/workflows/ci.yml`).
