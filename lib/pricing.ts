/**
 * Pricing math (PH1-10) and the stored-price rules (PH2-06).
 *
 * Margin is a DISPLAY figure computed from the manual `products.costPrice`
 * — never stored, never sent to the storefront. The authoritative moving-
 * average cost is computed from stock receipts once inventory/finance
 * exist (PH1-17+); until then cost is staff-entered display data.
 *
 * A stored price is a finite number from zero up to `MAX_PRICE`. Zero is
 * a real price. `resolvePrice` (PH2-07) decides which stored row wins.
 */

/** Sanity cap on any stored price — a typo guard, not a policy. */
export const MAX_PRICE = 999_999_999.99;

/** Price lists and promotions share this name length. */
export const PRICE_NAME_MAX = 80;

/** A quantity break starts above a single unit. Qty 1 is the row's own price. */
export const BREAK_QTY_MIN = 2;

export const BREAK_QTY_MAX = 1_000_000;

const DAY_MS = 86_400_000;

/** Blank is rejected. The stored name is the trimmed text. */
export function normalizePriceName(raw: string): string {
  return raw.trim();
}

export function priceListNameKey(raw: string): string {
  return normalizePriceName(raw).toLowerCase();
}

export function priceListNameError(raw: string): string | null {
  const name = normalizePriceName(raw);
  if (name.length < 1) return "Price list name is required.";
  if (name.length > PRICE_NAME_MAX) {
    return `Price list name must be ${PRICE_NAME_MAX} characters or fewer.`;
  }
  return null;
}

export function promotionNameError(raw: string): string | null {
  const name = normalizePriceName(raw);
  if (name.length < 1) return "Promotion name is required.";
  if (name.length > PRICE_NAME_MAX) {
    return `Promotion name must be ${PRICE_NAME_MAX} characters or fewer.`;
  }
  return null;
}

/** Zero is allowed. A missing number is the caller's problem, not this one's. */
export function priceError(price: number): string | null {
  if (!Number.isFinite(price)) return "Price must be a finite number.";
  if (price < 0) return "Price can't be negative.";
  if (price > MAX_PRICE) return `Price must be ${MAX_PRICE} or less.`;
  return null;
}

export function breakQtyError(qty: number): string | null {
  if (!Number.isInteger(qty)) return "Quantity must be a whole number.";
  if (qty < BREAK_QTY_MIN) return "A quantity break starts at 2.";
  if (qty > BREAK_QTY_MAX) return `Quantity must be ${BREAK_QTY_MAX} or less.`;
  return null;
}

function utcDayError(ms: number, label: string): string | null {
  if (!Number.isInteger(ms) || ms % DAY_MS !== 0) {
    return `Enter the ${label} as YYYY-MM-DD.`;
  }
  const iso = new Date(ms).toISOString().slice(0, 10);
  if (Date.parse(`${iso}T00:00:00.000Z`) !== ms) {
    return `Enter the ${label} as YYYY-MM-DD.`;
  }
  return null;
}

/**
 * Both ends are UTC midnight of a real calendar day. The end may equal
 * the start (a one-day window). A past window is still a valid record.
 * When two windows overlap, `resolvePrice` keeps the one that started
 * latest.
 */
export function promotionRangeError(startsOn: number, endsOn: number): string | null {
  const start = utcDayError(startsOn, "start date");
  if (start !== null) return start;
  const end = utcDayError(endsOn, "end date");
  if (end !== null) return end;
  if (endsOn < startsOn) return "The end date is before the start date.";
  return null;
}

/**
 * Unit prices round to the currency's `decimalPlaces` (0 through 6).
 * `Math.round` halves round away from zero for a positive price, which
 * is every stored price. `resolvePrice` returns that rounded unit.
 * A line amount rounds again after multiplying the already-rounded unit
 * by the quantity, so the unit on the line and the line total agree.
 */
export function roundUnitPrice(amount: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(amount * factor) / factor;
}

export function lineAmount(unitPrice: number, qty: number, decimalPlaces: number): number {
  return roundUnitPrice(unitPrice * qty, decimalPlaces);
}

/** A sale quantity. A break compares against this with `>=`. */
export function resolveQtyError(qty: number): string | null {
  if (!Number.isFinite(qty)) return "Quantity must be a finite number.";
  if (qty <= 0) return "Quantity must be greater than zero.";
  return null;
}

/** The UTC calendar day of an instant. `null` when the instant isn't finite. */
export function priceDay(date: number): number | null {
  if (!Number.isFinite(date)) return null;
  return Math.floor(date / DAY_MS) * DAY_MS;
}

/** A typed `YYYY-MM-DD` as UTC midnight. A blank or impossible day is refused. */
export function priceDayFromInput(raw: string): { error: string } | { ms: number } {
  const day = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Enter the date as YYYY-MM-DD." };
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    return { error: "Enter the date as YYYY-MM-DD." };
  }
  return { ms };
}

/** UTC day as `YYYY-MM-DD`. */
export function priceDayLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Staff display of a unit or a line total. The fraction digits are the currency's. */
export function formatUnitPrice(amount: number, decimalPlaces: number): string {
  return amount.toLocaleString("en-GB", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

export const PRICE_SOURCES = ["customer", "group", "list", "catalog"] as const;

export type PriceSource = (typeof PRICE_SOURCES)[number];

/** A stored unit price and the breaks that hang off it. Already one currency. */
export type PriceCandidate = {
  id: string;
  variantId: string | null;
  price: number;
  breaks: { id: string; minQty: number; price: number }[];
};

export type PriceListCandidate = {
  id: string;
  currency: string;
  active: boolean;
  isBase: boolean;
  createdAt: number;
  prices: PriceCandidate[];
};

export type PromotionCandidate = {
  id: string;
  startsOn: number;
  endsOn: number;
  active: boolean;
  priceListId: string | null;
  createdAt: number;
};

export type ResolvePriceInput = {
  qty: number;
  /** Any instant. The promotion window is the UTC day of this instant. */
  date: number;
  currency: string;
  decimalPlaces: number;
  variantId: string | null;
  customerPrices: PriceCandidate[];
  /** Empty when the customer has no group. An inactive group still counts. */
  groupPrices: PriceCandidate[];
  lists: PriceListCandidate[];
  promotions: PromotionCandidate[];
  /**
   * Catalog `listPrice` is the last fallback, and only in the company's
   * base currency. `null` means the field is unset. Zero is a real price.
   */
  catalog: {
    variantPrice: number | null;
    productPrice: number | null;
    baseCurrency: string | null;
  };
};

export type ResolvedPrice = {
  unitPrice: number | null;
  source: PriceSource | null;
  priceListId: string | null;
  promotionId: string | null;
  breakId: string | null;
};

const NO_PRICE: ResolvedPrice = {
  unitPrice: null,
  source: null,
  priceListId: null,
  promotionId: null,
  breakId: null,
};

/**
 * The price a sale uses (PH2-07).
 *
 * One tier wins, in this order: a customer price, then the customer's
 * group price, then a list price. Inside a tier, a variant price beats
 * the product price. A higher tier with only a product price still beats
 * a lower tier's variant price. An empty tier is skipped. Zero is a win,
 * not a miss.
 *
 * The list tier looks at active promotions whose window covers the UTC
 * day and whose list is active and in the requested currency. The one
 * that started latest wins; a tie goes to the one created latest, then
 * the greatest id. If that list has no price for the product, the next
 * promotion is tried. After the promotions, the active base list in
 * that currency is used (the oldest, if more than one is marked base).
 *
 * A quantity break applies only to the row that won, and only the
 * break with the greatest minimum that the quantity still reaches.
 * Breaks on a row that lost do not apply.
 *
 * The catalog list price is last, and only when the requested currency
 * is the company base currency. A variant's list price beats the
 * product's. Nothing matched is a null unit price, not a thrown error.
 *
 * `qty` must be finite and greater than zero. `date` must be finite.
 * `decimalPlaces` must be an integer from 0 to 6. A caller that skips
 * those checks gets no price back.
 */
export function resolvePrice(input: ResolvePriceInput): ResolvedPrice {
  if (resolveQtyError(input.qty) !== null) return NO_PRICE;
  const day = priceDay(input.date);
  if (day === null) return NO_PRICE;
  if (
    !Number.isInteger(input.decimalPlaces) ||
    input.decimalPlaces < 0 ||
    input.decimalPlaces > 6
  ) {
    return NO_PRICE;
  }

  const customer = pickRow(input.customerPrices, input.variantId);
  if (customer !== null) return priced(customer, input, "customer", null, null);

  const group = pickRow(input.groupPrices, input.variantId);
  if (group !== null) return priced(group, input, "group", null, null);

  const listHit = pickList(input, day);
  if (listHit !== null) {
    return priced(listHit.row, input, "list", listHit.listId, listHit.promotionId);
  }

  if (input.catalog.baseCurrency === input.currency) {
    const catalogPrice =
      input.variantId !== null && input.catalog.variantPrice !== null
        ? input.catalog.variantPrice
        : input.catalog.productPrice;
    if (catalogPrice !== null) {
      return {
        unitPrice: roundUnitPrice(catalogPrice, input.decimalPlaces),
        source: "catalog",
        priceListId: null,
        promotionId: null,
        breakId: null,
      };
    }
  }

  return NO_PRICE;
}

function pickRow(rows: PriceCandidate[], variantId: string | null): PriceCandidate | null {
  const exact = variantId === null ? [] : rows.filter((row) => row.variantId === variantId);
  const pool = exact.length > 0 ? exact : rows.filter((row) => row.variantId === null);
  if (pool.length === 0) return null;
  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool[0] ?? null;
}

function pickList(
  input: ResolvePriceInput,
  day: number,
): { row: PriceCandidate; listId: string; promotionId: string | null } | null {
  const lists = new Map(input.lists.map((list) => [list.id, list]));
  const promotions = input.promotions
    .filter((promotion) => promotion.active && promotion.priceListId !== null)
    .filter((promotion) => day >= promotion.startsOn && day <= promotion.endsOn)
    .sort(
      (a, b) =>
        b.startsOn - a.startsOn ||
        b.createdAt - a.createdAt ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
  for (const promotion of promotions) {
    const listId = promotion.priceListId;
    if (listId === null) continue;
    const list = lists.get(listId);
    if (list === undefined || !list.active || list.currency !== input.currency) continue;
    const row = pickRow(list.prices, input.variantId);
    if (row !== null) return { row, listId: list.id, promotionId: promotion.id };
  }

  const bases = input.lists
    .filter((list) => list.active && list.isBase && list.currency === input.currency)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const base = bases[0];
  if (base === undefined) return null;
  const row = pickRow(base.prices, input.variantId);
  if (row === null) return null;
  return { row, listId: base.id, promotionId: null };
}

function priced(
  row: PriceCandidate,
  input: ResolvePriceInput,
  source: PriceSource,
  priceListId: string | null,
  promotionId: string | null,
): ResolvedPrice {
  const hits = row.breaks.filter((item) => input.qty >= item.minQty);
  hits.sort((a, b) => b.minQty - a.minQty || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const best = hits[0];
  return {
    unitPrice: roundUnitPrice(best?.price ?? row.price, input.decimalPlaces),
    source,
    priceListId,
    promotionId,
    breakId: best?.id ?? null,
  };
}

/**
 * Margin percentage: (list − cost) / list × 100, rounded to one decimal
 * (it's a display figure, so the rounding is part of the contract).
 * Returns `null` when it can't be computed — a missing price on either
 * side, or a zero/negative list price (a giveaway has no meaningful rate).
 * A NEGATIVE result is valid and deliberate: selling below cost shows the
 * loss instead of hiding it.
 */
export function marginPercent(
  listPrice: number | undefined,
  costPrice: number | undefined,
): number | null {
  if (listPrice === undefined || costPrice === undefined) return null;
  if (!Number.isFinite(listPrice) || !Number.isFinite(costPrice) || listPrice <= 0) return null;
  return Math.round(((listPrice - costPrice) / listPrice) * 1000) / 10;
}
