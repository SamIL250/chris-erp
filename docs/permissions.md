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
  `categories.list`/`categories.stats` (catalog.view),
  `categories.create` (catalog.create),
  `categories.update`/`categories.move` (catalog.edit),
  `categories.remove` (catalog.delete — Sales notably lacks it) (PH1-01);
  `attributes.list` (catalog.view), `attributes.create` (catalog.create),
  `attributes.update` (catalog.edit), `attributes.remove` (catalog.delete)
  (PH1-03); `attributes.forCategory` (catalog.view),
  `attributeSets.list` (catalog.view), `attributeSets.create`
  (catalog.create), `attributeSets.update` (catalog.edit),
  `attributeSets.remove` (catalog.delete) (PH1-04); `products.get`,
  `products.list`, `products.brands` (catalog.view),
  `products.create` (catalog.create), `products.update`,
  `products.bulkStatus` (catalog.edit), `products.remove`
  (catalog.delete) (PH1-07, PH1-08);
  `products.duplicate` (catalog.create — a copy is a new draft, not an
  edit), `products.picker` (catalog.view — archived excluded; the
  storefront must not use this query, drafts are still pickable; each
  row includes the cover URL), `products.covers` (catalog.view — cover
  URL for a set of product ids, null when the product has no image)
  (PH1-15);
  `warehouses.list` (inventory.view), `warehouses.create`
  (inventory.create), `warehouses.update` (inventory.edit),
  `warehouses.remove` (inventory.delete) (PH1-16);
  `stockMovements.list` (inventory.view), `stockMovements.post`
  (inventory.create — raw ledger insert; rows are never edited or
  removed) (PH1-17);
  `stockMovements.balance`, `stockMovements.byWarehouse`
  (inventory.view — on-hand, reserved, available; `value` is a
  placeholder, not moving-average cost) (PH1-18);
  `stockMovements.reserve`, `stockMovements.release`,
  `stockMovements.allocate` (inventory.create — an order mutation
  calls the helpers in its own transaction; these are the warehouse
  entry points. A hold cannot exceed available stock) (PH1-19);
  `stockMovements.adjust` (inventory.approve — damage and write-off
  are negative, found is positive, a count correction may go either
  way. A removal cannot pass what is reserved. Optional note and
  image. The raw `post` action refuses type `adjustment`) (PH1-20);
  `transfers.create` (inventory.create), `transfers.update` /
  `transfers.ship` / `transfers.receive` (inventory.edit),
  `transfers.cancel` (inventory.delete — drafts only),
  `transfers.get` / `transfers.list` / `transfers.inTransit`
  (inventory.view — goods leave the source on ship and arrive at the
  destination only as they are received) (PH1-21);
  `goodsReceipts.create` (inventory.create — manual intake; the
  reference note is required; one ledger receipt per line; no purchase
  order), `goodsReceipts.get` / `goodsReceipts.list` (inventory.view)
  (PH1-22);
  `stockMovements.positions` (inventory.view — one row per product
  slice at a warehouse; `lowStock` is available at or below the
  reorder point, and a slice with no point is not low) (PH1-23,
  reading replaced in PH1-24);
  `reorderPoints.set` / `reorderPoints.clear` (inventory.edit — a
  warehouse point overrides the product-wide point; an inactive
  warehouse cannot take a point), `reorderPoints.forProduct`
  (inventory.view). The daily job `lowStock.scan` is internal: it
  notifies active inventory editors once when a slice falls to its
  point, and again only after available has risen above it (PH1-24);
  `variants.list` (catalog.view), `variants.sync`,
  `variants.update`, `variants.remove` (catalog.edit — variant rows are
  product-document matrix entries, so row-level changes ride the edit
  ladder like the sync that manages them) (PH1-09);
  `customers.list` / `customers.get` / `customers.options`
  (sales.view — options returns active currencies, active tax groups,
  and the company base currency, so a sales user does not need
  settings.view), `customers.create` (sales.create — warehouse cannot
  open an account), `customers.update`, `customers.addContact` /
  `customers.updateContact` / `customers.removeContact`,
  `customers.addAddress` / `customers.updateAddress` /
  `customers.removeAddress`, `customers.addNote` (sales.edit —
  warehouse can maintain contacts, addresses, and notes; accountant
  is read-only). There is no delete: close the account. Notes are
  append-only (PH2-01).
  `customerGroups.list` / `customerGroups.get` (sales.view — `get`
  includes the companies on that tier), `customerGroups.create`
  (sales.create — warehouse cannot open a tier), `customerGroups.update`
  (sales.edit — rename or deactivate; there is no delete). Assigning a
  company is `customers.create` / `customers.update` via `groupId`. An
  inactive tier cannot be newly chosen. A company already on it may
  stay (PH2-02).
  `vendors.list` / `vendors.get` / `vendors.options` (procurement.view —
  options returns active currencies, active tax groups, and the company
  base currency, so a procurement user does not need settings.view;
  sales can read), `vendors.create` (procurement.create — warehouse can
  open a vendor; accountant and sales cannot), `vendors.update`,
  `vendors.addContact` / `vendors.updateContact` /
  `vendors.removeContact`, `vendors.addAddress` /
  `vendors.updateAddress` / `vendors.removeAddress` (procurement.edit —
  accountant can maintain the header, contacts, and addresses;
  warehouse cannot). There is no delete: mark the vendor inactive.
  License number, jurisdiction, and expiry are stored; a past expiry
  is allowed, and Phase 5 (PH5-12) is what refuses it (PH2-03).
  `requisitions.list` / `requisitions.get` and `purchaseOrders.list` /
  `purchaseOrders.get` (procurement.view — sales can read),
  `requisitions.create` / `requisitions.update` (procurement.create —
  warehouse can request and fix a draft; accountant and sales cannot),
  `requisitions.approve` / `requisitions.reject` / `requisitions.convert`
  (procurement.approve — owner and admin only). Approval is the role.
  The requester may approve their own request when they hold approve.
  Convert writes one draft purchase order and leaves stock where it is
  (PH2-20).
  `purchaseOrders.updateExpectedDate` / `purchaseOrders.updateLine` /
  `purchaseOrders.addLine` / `purchaseOrders.removeLine`
  (procurement.edit — accountant can change a draft; warehouse cannot),
  `purchaseOrders.send` (procurement.approve — owner and admin). Send
  freezes the agreed price and the vendor's tax and marks the order
  sent. It does not move stock and it does not email. A receipt moves
  sent to partially received or received (PH2-22). A vendor bill marks
  a received order billed (PH2-23). The PDF is downloaded in the
  browser (PH2-21).
  `purchaseReceipts.receive` (inventory.create — warehouse can receive;
  sales and accountant cannot). Accepted quantity posts a stock receipt
  at the agreed unit price and stores the moving average on the receipt
  line. Rejected quantity is recorded and does not enter stock. The
  accepted total moves a sent order to partially received or received.
  A receipt that only rejects leaves the status. Serials and lots can
  be named; their picker is Phase 5 (PH2-22).
  `vendorBills.list` / `vendorBills.get` / `vendorBills.forPurchaseOrder`
  (procurement.view — sales can read), `vendorBills.create` /
  `vendorBills.createFromPurchaseOrder` / `vendorBills.updateLine`
  (procurement.edit — accountant can record a bill and edit it while it
  is open; warehouse and sales cannot), `vendorBills.match`
  (finance.post — accountant, owner, and admin). A bill from a purchase
  order copies the accepted quantity and the agreed price, and only a
  received order can be billed. Match writes one pending `vendorBill`
  journal intent and marks that order billed. Billed quantity must equal
  received quantity. A unit price within 2% of the agreed price passes;
  a wider gap blocks the match. Ordered versus received is a warning and
  does not block. A standalone bill has nothing to compare. Paid is a
  status and is never set. Recording a payment is Phase 3 (PH2-23).
  `purchaseReturns.list` / `purchaseReturns.get` /
  `purchaseReturns.forReceipt` (procurement.view — sales can read),
  `purchaseReturns.create` (inventory.create — warehouse can return
  goods that a receipt put on hand; sales and accountant cannot). Each
  line posts a stock issue at that receipt line's unit cost. The
  document number (`DBN-`) is the debit note reference. Rejected
  quantity cannot be returned, and reserved stock stays. The receipt,
  the purchase order, and the vendor's received total stay as they
  were. Posting writes one pending `debitNote` journal intent at the
  receipt line's unit cost. A missing cost is an amount of zero, so the
  return is still on the backlog. The vendor's credit is Phase 3
  (PH2-24).
  `journalIntents.list` (finance.view — sales, accountant, owner, and
  admin can read the backlog; warehouse cannot). A goods receipt that
  puts stock on hand writes one pending `goodsReceipt` intent. A
  rejection-only receipt writes none. A manual stock adjustment writes
  one pending `stockAdjustment` intent, signed with the quantity. A
  sales-return write-off is not that adjustment: the receipt and the
  removal net to zero, and the credit note is the posting. Payments
  and the posting engine stay Phase 3 (PH2-26).
  `desk.get` (procurement.view — sales can read). One query feeds the
  four tiles at `/procurement`. Open is a purchase order that is not
  billed. Overdue is sent or partially received with an expected date
  before today. Receipts pending is quantity still to accept on those
  orders. Bills pending match are open vendor bills. A received order
  with no bill is not in that queue (PH2-25).
  `productVendors.listForProduct` / `productVendors.listForVendor`
  (catalog.view), `productVendors.link` / `productVendors.update` /
  `productVendors.remove` (catalog.edit — sales can maintain the link;
  warehouse and accountant cannot). There is no separate delete
  permission: unlinking rides edit. A new link to an inactive vendor
  is refused. Last purchase price is not an argument. A goods receipt
  that names the vendor (`goodsReceipts.create`, inventory.create)
  writes it onto an existing link when the line has a unit cost, and
  records a `productVendors` / `purchase` audit. A receipt does not
  create the link (PH2-04).
  `customers.statement` (sales.view — balance is invoices less credits
  and payments; those documents are not posted yet, so the balance is
  zero and the document list is empty; available credit is the limit
  minus the balance, and a missing limit is no cap).
  `vendors.statement` (procurement.view — goods receipts that name the
  vendor, newest first; a line with no unit cost adds nothing to the
  received total; bills are not included) (PH2-05).
  `prices.listLists` / `prices.getList` / `prices.listGroupPrices` /
  `prices.listCustomerPrices` / `prices.listPromotions` (sales.view —
  warehouse and accountant can read). `prices.createList` /
  `prices.updateList`, `prices.setListPrice` / `prices.removeListPrice`,
  `prices.setGroupPrice` / `prices.removeGroupPrice`,
  `prices.setCustomerPrice` / `prices.removeCustomerPrice`,
  `prices.setBreak` / `prices.removeBreak`, `prices.createPromotion` /
  `prices.updatePromotion` (sales.create — every price write, including
  a change or a removal, so warehouse's sales.edit cannot change a
  price; accountant cannot write). A list and a promotion are
  deactivated, never deleted. Deactivating the base promotes the oldest
  other list; the only list stays the base. A new price on an inactive list, an
  inactive group, or a closed customer is refused. A quantity break
  hangs off one existing price and starts at a quantity of 2 (PH2-06).
  `prices.resolvePrice` (sales.view — customer price, then the customer's
  group price, then a list price; a quantity break applies only to the
  winning row; the unit price rounds to the currency's decimal places;
  no match is a null unit price; a closed customer and an inactive
  group still resolve) (PH2-07).
  `prices.currencyChoices` (sales.view — currency codes and decimal
  places, without settings access). `prices.linePreview` (sales.view —
  the same winner as `resolvePrice`, then the line total and the margin
  against the product's display cost; a missing cost or a unit that is
  not above zero leaves the margin null) (PH2-09).
  `priceOverrides.get` / `priceOverrides.listPending` (sales.view).
  `priceOverrides.propose` (sales.create — a typed price or a percent
  off the resolved unit, with a reason; above a 10% discount the row
  waits). `priceOverrides.confirm` (sales.approve — a second person;
  the requester cannot confirm their own; a rejection needs a reason)
  (PH2-08).
  The cross of those tiers, quantity breaks, and overrides is
  `tests/pricingMatrix.test.ts`. CI runs it with the rest of the suite
  (PH2-10).
  `quotes.list` / `quotes.get` and `orders.list` / `orders.get`
  (sales.view). `quotes.create`, `quotes.update`, `quotes.addLine`,
  `quotes.removeLine`, `quotes.setDiscount`, `quotes.clearDiscount`,
  `quotes.send`, `quotes.accept`, `quotes.reject`, `quotes.expire`, and
  `quotes.convert` (sales.create — warehouse's sales.edit cannot change
  a quote). A discount on a quote line is the same override as
  `priceOverrides`: above 10% it waits, and `priceOverrides.confirm`
  then updates the line. Accept converts once into a draft sales order
  and copies the charged lines and prices (PH2-11).
  `orders.get` also returns today's price, the margin on the charged
  unit, and availability at the order's warehouse — or at the
  warehouse passed in while the order is still a draft (PH2-13).
  `orders.confirm`, `orders.invoice`, `orders.close`, and
  `orders.cancel` (sales.create — warehouse cannot commit an order).
  Confirm reserves free stock at one warehouse; a short line is
  `backorder` and the order still confirms. Cancel releases whatever
  is still reserved. Invoice waits until every line has shipped.
  `orders.reserve` and `orders.fulfill` (sales.edit — warehouse
  fulfillment). Reserve tops up a backorder. Fulfill allocates that
  quantity (release + issue) and can be less than the line. It
  refuses quantity already claimed by a packed slip. A customer's
  statement lists the order and does not change the balance (PH2-12).
  `deliveries.list` / `deliveries.get` / `deliveries.forOrder` /
  `deliveries.pickList` (sales.view — the pick list groups what is
  still reserved, by warehouse). `deliveries.pack`, `deliveries.ship`,
  and `deliveries.cancel` (sales.edit — warehouse can pack and ship;
  an accountant cannot). Pack claims reserved quantity and posts
  nothing. Ship is the goods issue, keeps the unit cost, and writes
  one pending `journalIntents` row of type `cogs`. A packed slip
  cancels without an issue. Quantity that already left cannot be
  packed. The statement lists the delivery at the selling price of
  its lines and does not change the balance (PH2-14).
  `deliveries.get` also returns the ship-to. The packing-slip PDF and
  the pick-list PDF are built in the browser from that query and
  `deliveries.pickList`, so they need no extra permission. The slip
  does not print the unit cost (PH2-15).
  `invoices.list` / `invoices.get` / `invoices.forOrder` /
  `invoices.forDelivery` (sales.view). `invoices.createFromOrder`,
  `invoices.createFromDelivery`, `invoices.post`, `invoices.voidInvoice`,
  and `invoices.markPaid` (sales.create — warehouse cannot invoice).
  A draft copies shipped quantity, the charged price, and the tax.
  Posting writes one pending `journalIntents` row of type
  `salesInvoice` and, once every line has shipped and been billed,
  marks the order invoiced. Void is draft only. Marking paid does not
  record a payment, so the statement balance still includes it
  (PH2-16).
  `creditNotes.list` / `creditNotes.get` / `creditNotes.forInvoice`
  (sales.view). `creditNotes.create`, `creditNotes.post`, and
  `creditNotes.voidCredit` (sales.create — warehouse cannot credit).
  A note reduces a posted or paid invoice. A return may restock into
  the order's warehouse. An adjustment does not. Posting writes one
  pending `journalIntents` row of type `creditNote`. A posted note
  lowers the statement balance. Void is draft only (PH2-17).
  `salesReturns.list` / `salesReturns.get` / `salesReturns.forInvoice` /
  `salesReturns.forOrder` (sales.view). `salesReturns.createFromInvoice`,
  `salesReturns.createFromOrder`, `salesReturns.receive`,
  `salesReturns.credit`, `salesReturns.exchange`, and
  `salesReturns.cancel` (sales.create — warehouse cannot open or
  receive a return). A request names lines and a quantity from a
  posted invoice or a shipped order. Receiving inspects each line:
  restock puts it back, quarantine holds it, and a write-off receipts
  it and removes it. Credit posts one `creditNote` intent and lowers
  the balance. Exchange opens a draft order and does not. Cancel is
  only while the return is still a request (PH2-18).
  `desk.get` (sales.view). The order desk counts open orders, reserved
  quantity still to pick, packed slips still to ship, shipped quantity
  still to bill plus draft invoices, and returns that are requested or
  received. It does not write (PH2-19).
  `docFlow.get` (sales.view — warehouse can read it on a delivery). One
  query feeds the quote, order, delivery, invoice, and payment trail
  on each of those documents, and on a credit note or a return. A void
  invoice, a cancelled delivery, and a cancelled return stay off the
  trail unless that page is the one open. Payment is named and has no
  document until Phase 3 (PH2-27).
  Pricing visibility (PH1-10): prices ride the existing
  `products.create`/`products.update` (no new gate), and every role that
  can view the catalog sees `listPrice`/`costPrice`/margin in the admin —
  cost and margin are STAFF-SIDE ONLY: storefront queries (PH4) must
  project `listPrice` alone, never cost or derived margin.
  UoM data (PH1-11): `unitOfMeasure`/`conversions`/`purchaseUoM`/
  `salesUoM` are product fields — they ride `products.create`/
  `products.update` (no new gate, no new mutation) and are visible to
  every catalog viewer in the editor/facts panel; PH2 document lines
  prefill their UoM from the doc-level defaults.
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
