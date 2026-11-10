/**
 * Mock seller data.
 *
 * GIVEN (from the assignment, must not change): the `METRICS` table.
 * ASSUMED (clearly labelled, shown in the UI): everything else — the seller
 * profile, SKU list, cancellation reasons and promotion history.
 *
 * Consistency guarantees (verified by unit tests in diagnose.test.ts):
 *  - the 20 listed SKUs + the "long tail" aggregate add up EXACTLY to the
 *    given orders and sales for both months;
 *  - out-of-stock counts across SKUs + long tail add up to 5 → 18.
 *
 * One order = one unit (simplifying assumption).
 */

export interface MonthlyMetrics {
  sales_inr: number;
  orders: number;
  cancellation_rate: number; // fraction, e.g. 0.08
  avg_selling_price_inr: number;
  out_of_stock_products: number;
}

/** GIVEN by the assignment — do not edit. */
export const METRICS: { last_month: MonthlyMetrics; this_month: MonthlyMetrics } = {
  last_month: {
    sales_inr: 200_000,
    orders: 400,
    cancellation_rate: 0.08,
    avg_selling_price_inr: 500,
    out_of_stock_products: 5,
  },
  this_month: {
    sales_inr: 135_000,
    orders: 270,
    cancellation_rate: 0.14,
    avg_selling_price_inr: 500,
    out_of_stock_products: 18,
  },
};

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface Sku {
  sku: string;
  name: string;
  price_inr: number;
  units_last_month: number;
  units_this_month: number;
  stock_status: StockStatus;
  /** Units left in the warehouse (0 when out of stock). */
  units_in_stock: number;
  /** Days the SKU has been out of stock (0 if in stock). */
  days_out_of_stock: number;
  /** true if the SKU went out of stock THIS month (it was selling last month). */
  newly_out_of_stock: boolean;
}

// ---------------------------------------------------------------------------
// ASSUMPTIONS
// ---------------------------------------------------------------------------

export const SELLER_PROFILE = {
  seller_name: "Ramesh Kumar",
  store_name: "Ramesh Home Essentials",
  category: "Home & Kitchen",
  city: "Jaipur",
  years_on_platform: 3,
  active_listings: 60,
  preferred_language: "Hinglish",
} as const;

/**
 * Top 20 SKUs by last-month sales. The remaining 40 listings are aggregated
 * in LONG_TAIL below. Ten of the 13 newly out-of-stock SKUs are here, and
 * several of them were last month's top sellers.
 */
export const SKUS: Sku[] = [
  // --- Newly out of stock this month (were top sellers) ---
  { sku: "RHE-101", name: "Stainless Steel Pressure Cooker 3L", price_inr: 799, units_last_month: 30, units_this_month: 13, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 16, newly_out_of_stock: true },
  { sku: "RHE-102", name: "Jaipuri Cotton Double Bedsheet Set", price_inr: 649, units_last_month: 28, units_this_month: 14, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 14, newly_out_of_stock: true },
  { sku: "RHE-103", name: "Non-stick Tawa 28cm", price_inr: 449, units_last_month: 26, units_this_month: 13, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 15, newly_out_of_stock: true },
  { sku: "RHE-104", name: "Glass Storage Jars (Set of 6)", price_inr: 549, units_last_month: 22, units_this_month: 12, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 13, newly_out_of_stock: true },
  { sku: "RHE-105", name: "Kitchen Knife Set with Stand", price_inr: 499, units_last_month: 18, units_this_month: 10, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 12, newly_out_of_stock: true },
  { sku: "RHE-106", name: "Block-print Cushion Covers (Set of 5)", price_inr: 399, units_last_month: 16, units_this_month: 9, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 12, newly_out_of_stock: true },
  { sku: "RHE-107", name: "Copper Water Bottle 1L", price_inr: 599, units_last_month: 12, units_this_month: 7, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 11, newly_out_of_stock: true },
  { sku: "RHE-108", name: "Bamboo Chopping Board", price_inr: 349, units_last_month: 10, units_this_month: 6, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 10, newly_out_of_stock: true },
  { sku: "RHE-109", name: "3-Tier Steel Lunch Box", price_inr: 449, units_last_month: 8, units_this_month: 5, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 9, newly_out_of_stock: true },
  { sku: "RHE-110", name: "Cotton Hand Towels (Set of 4)", price_inr: 299, units_last_month: 6, units_this_month: 4, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 8, newly_out_of_stock: true },
  // --- In stock (some low) ---
  { sku: "RHE-111", name: "Steel Water Bottle 1L (Pack of 2)", price_inr: 399, units_last_month: 24, units_this_month: 22, stock_status: "low_stock", units_in_stock: 6, days_out_of_stock: 0, newly_out_of_stock: false },
  { sku: "RHE-112", name: "Microfibre Cleaning Cloths (Pack of 6)", price_inr: 299, units_last_month: 22, units_this_month: 19, stock_status: "in_stock", units_in_stock: 48, days_out_of_stock: 0, newly_out_of_stock: false },
  { sku: "RHE-113", name: "Ceramic Coffee Mugs (Set of 4)", price_inr: 549, units_last_month: 18, units_this_month: 15, stock_status: "in_stock", units_in_stock: 30, days_out_of_stock: 0, newly_out_of_stock: false },
  { sku: "RHE-114", name: "Steel Masala Box (Spice Dabba)", price_inr: 449, units_last_month: 16, units_this_month: 13, stock_status: "in_stock", units_in_stock: 25, days_out_of_stock: 0, newly_out_of_stock: false },
  { sku: "RHE-115", name: "Cotton Table Runner", price_inr: 349, units_last_month: 14, units_this_month: 11, stock_status: "in_stock", units_in_stock: 22, days_out_of_stock: 0, newly_out_of_stock: false },
  { sku: "RHE-116", name: "Cast Iron Kadai 2L", price_inr: 799, units_last_month: 12, units_this_month: 10, stock_status: "low_stock", units_in_stock: 4, days_out_of_stock: 0, newly_out_of_stock: false },
  { sku: "RHE-117", name: "Silicone Spatula Set", price_inr: 299, units_last_month: 12, units_this_month: 10, stock_status: "in_stock", units_in_stock: 35, days_out_of_stock: 0, newly_out_of_stock: false },
  { sku: "RHE-118", name: "Melamine Dinner Plates (Set of 6)", price_inr: 649, units_last_month: 10, units_this_month: 8, stock_status: "in_stock", units_in_stock: 18, days_out_of_stock: 0, newly_out_of_stock: false },
  // --- Out of stock since last month (seasonal / discontinued by supplier) ---
  { sku: "RHE-119", name: "Brass Diya Pair (Festive)", price_inr: 399, units_last_month: 4, units_this_month: 0, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 41, newly_out_of_stock: false },
  { sku: "RHE-120", name: "Jute Storage Basket", price_inr: 349, units_last_month: 3, units_this_month: 0, stock_status: "out_of_stock", units_in_stock: 0, days_out_of_stock: 36, newly_out_of_stock: false },
];

/** The other 40 active listings, aggregated. Numbers are the exact remainder. */
export const LONG_TAIL = {
  listings: 40,
  orders_last_month: 89,
  orders_this_month: 69,
  sales_last_month_inr: 42_261,
  sales_this_month_inr: 36_251,
  out_of_stock_last_month: 3,
  out_of_stock_this_month: 6, // 3 old + 3 newly out of stock
} as const;

/** Cancellation reasons (assumed). Last month 32 cancellations, this month 38. */
export const CANCELLATION_REASONS = {
  last_month: { item_unavailable_seller_cancelled: 9, customer_changed_mind: 15, delivery_delay: 8 },
  this_month: { item_unavailable_seller_cancelled: 26, customer_changed_mind: 7, delivery_delay: 5 },
} as const;

/** Promotion history (assumed). */
export const PROMOTIONS = {
  price_changes_this_month: false,
  deals_or_ads_this_month: false,
  last_deal_participation: "Diwali sale, 2 months ago",
  category_deal_activity: "Competitors in Home & Kitchen likely ran weekend deals this month (assumption, not in data)",
} as const;

/** Human-readable list of every assumption, rendered in the Assumptions drawer. */
export const ASSUMPTIONS: { label: string; detail: string }[] = [
  { label: "Seller", detail: "Ramesh Kumar, “Ramesh Home Essentials”, Home & Kitchen, Jaipur, 3 years on Snapdeal." },
  { label: "Catalogue", detail: "60 active listings: top 20 SKUs listed individually, the other 40 aggregated as a long tail." },
  { label: "Orders", detail: "One order = one unit. SKU + long-tail totals reconcile exactly with the given 400 → 270 orders and ₹2,00,000 → ₹1,35,000." },
  { label: "Stock-outs", detail: "13 SKUs went out of stock this month (10 in the top 20, several of them last month’s best sellers); 5 were already out of stock." },
  { label: "Cancellations", detail: "Most cancellations this month (26 of 38) are “item unavailable / seller cancelled” after the order was placed." },
  { label: "Pricing", detail: "No price changes this month; average selling price flat at ₹500." },
  { label: "Promotions", detail: "No deals or ads this month. Competitor deal activity is an assumption, so that finding is low-confidence." },
  { label: "Impact maths", detail: "₹ impacts are estimates from the SKU data; they overlap (stock-outs drive cancellations) and are not additive." },
  { label: "Follow-up progress", detail: "In Follow-up mode, ‘progress since last call’ is simulated from which actions were executed last time." },
];
