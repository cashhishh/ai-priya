/**
 * Deterministic diagnosis & impact engine.
 *
 * WHY THIS IS CODE, NOT THE LLM: every ₹ figure Priya speaks must be
 * reproducible and defensible. The model is told it may ONLY quote numbers
 * returned by tools, and the tools call into this file. That removes the most
 * dangerous failure mode of a voice agent (confidently made-up numbers) and
 * makes the logic unit-testable.
 *
 * All functions are pure: same input → same output.
 */

import {
  CANCELLATION_REASONS,
  LONG_TAIL,
  METRICS,
  PROMOTIONS,
  SKUS,
  type MonthlyMetrics,
  type Sku,
} from "@/data/seller";
import { formatInr, formatInrShort, formatPct, pctChange, roundTo } from "@/lib/format";
import type {
  ActionType,
  Diagnosis,
  Issue,
  ProductFilter,
  ProgressSnapshot,
  Severity,
} from "@/lib/types";

export interface DiagnosisInput {
  last: MonthlyMetrics;
  current: MonthlyMetrics;
  skus: Sku[];
  longTail: typeof LONG_TAIL;
}

const DEFAULT_INPUT: DiagnosisInput = {
  last: METRICS.last_month,
  current: METRICS.this_month,
  skus: SKUS,
  longTail: LONG_TAIL,
};

/** Above this cancellation rate we flag seller-rating / ranking risk (assumed platform threshold). */
export const CANCELLATION_RISK_THRESHOLD = 0.1;

/** Assumed uplift from joining a category deal (used only for the low-confidence promotion finding). */
export const DEAL_UPLIFT = 0.1;

// ---------------------------------------------------------------------------
// Building blocks (exported for tests)
// ---------------------------------------------------------------------------

/** Revenue lost on one SKU between the two months (never negative). */
export function skuRevenueLoss(sku: Sku): number {
  return Math.max(0, (sku.units_last_month - sku.units_this_month) * sku.price_inr);
}

/** Revenue lost from SKUs that went out of stock THIS month. */
export function inventoryLoss(skus: Sku[]): number {
  return skus.filter((s) => s.newly_out_of_stock).reduce((sum, s) => sum + skuRevenueLoss(s), 0);
}

/**
 * Revenue lost on products that are still in stock. Their demand fell
 * without a stock-out or price change, which points to lower visibility.
 */
export function inStockDecline(input: DiagnosisInput): number {
  const listed = input.skus
    .filter((s) => s.stock_status !== "out_of_stock")
    .reduce((sum, s) => sum + skuRevenueLoss(s), 0);
  const tail = Math.max(0, input.longTail.sales_last_month_inr - input.longTail.sales_this_month_inr);
  return listed + tail;
}

/** Extra cancelled orders caused by the cancellation-rate jump, at this month's volume. */
export function extraCancelledOrders(last: MonthlyMetrics, current: MonthlyMetrics): number {
  return Math.round((current.cancellation_rate - last.cancellation_rate) * current.orders);
}

export function newlyOutOfStock(skus: Sku[]): Sku[] {
  return skus
    .filter((s) => s.newly_out_of_stock)
    .sort((a, b) => skuRevenueLoss(b) - skuRevenueLoss(a));
}

function severityFor(impact: number, riskFlag = false): Severity {
  const base: Severity = impact >= 30_000 ? "critical" : impact >= 10_000 ? "high" : impact >= 5_000 ? "medium" : "low";
  // A rating/ranking risk escalates by one level.
  if (riskFlag && base === "medium") return "high";
  if (riskFlag && base === "low") return "medium";
  return base;
}

// ---------------------------------------------------------------------------
// Main diagnosis
// ---------------------------------------------------------------------------

export function diagnose(input: DiagnosisInput = DEFAULT_INPUT): Diagnosis {
  const { last, current, skus } = input;

  const salesChange = current.sales_inr - last.sales_inr;
  const salesPct = pctChange(last.sales_inr, current.sales_inr);
  const ordersPct = pctChange(last.orders, current.orders);
  const aspPct = pctChange(last.avg_selling_price_inr, current.avg_selling_price_inr);

  // 1. Inventory -------------------------------------------------------------
  const oosSkus = newlyOutOfStock(skus);
  const invLoss = inventoryLoss(skus);
  const top3 = oosSkus.slice(0, 3);
  const catalogueShare = current.out_of_stock_products / (input.skus.length + input.longTail.listings);
  const inventory: Issue = {
    id: "inventory",
    title: "Top sellers went out of stock",
    severity: severityFor(invLoss),
    summary: `${current.out_of_stock_products - last.out_of_stock_products} more products are out of stock than last month, including several best sellers.`,
    evidence: [
      `Out-of-stock products: ${last.out_of_stock_products} → ${current.out_of_stock_products} (${formatPct(catalogueShare)} of ${input.skus.length + input.longTail.listings} listings)`,
      `${oosSkus.length} of the top 20 SKUs went out of stock this month`,
      `Biggest losses: ${top3.map((s) => `${s.name} (${formatInrShort(skuRevenueLoss(s))})`).join(", ")}`,
      `Lost revenue on newly out-of-stock top SKUs: ${formatInr(invLoss)}`,
    ],
    estimated_monthly_impact_inr: invLoss,
    confidence: "data",
  };

  // 2. Cancellations ----------------------------------------------------------
  const extraCancels = extraCancelledOrders(last, current);
  const cancelLoss = extraCancels * current.avg_selling_price_inr;
  const unavailable = CANCELLATION_REASONS.this_month.item_unavailable_seller_cancelled;
  const totalCancels = Object.values(CANCELLATION_REASONS.this_month).reduce((a, b) => a + b, 0);
  const aboveThreshold = current.cancellation_rate > CANCELLATION_RISK_THRESHOLD;
  const cancellations: Issue = {
    id: "cancellations",
    title: "Cancellations jumped, mostly item unavailable",
    severity: severityFor(cancelLoss, aboveThreshold),
    summary: "Orders are being placed for items that turn out to be unavailable, then seller-cancelled. This also hurts seller rating and search ranking.",
    evidence: [
      `Cancellation rate: ${formatPct(last.cancellation_rate)} → ${formatPct(current.cancellation_rate)}`,
      `≈${extraCancels} extra cancelled orders ≈ ${formatInr(cancelLoss)} of lost sales`,
      `${unavailable} of ${totalCancels} cancellations this month were “item unavailable / seller cancelled” (last month: ${CANCELLATION_REASONS.last_month.item_unavailable_seller_cancelled})`,
      aboveThreshold
        ? `Above the ${formatPct(CANCELLATION_RISK_THRESHOLD)} level where seller rating and ranking typically suffer`
        : "Below the rating-risk threshold",
    ],
    estimated_monthly_impact_inr: cancelLoss,
    confidence: "data",
  };

  // 3. Visibility (inference) -------------------------------------------------
  const visLoss = inStockDecline(input);
  const visibility: Issue = {
    id: "visibility",
    title: "Lower search visibility (likely)",
    severity: severityFor(visLoss),
    summary: "Even products that ARE in stock are selling less. Fewer in-stock listings plus more cancellations usually push a store down in search.",
    evidence: [
      `In-stock products and long tail lost ${formatInr(visLoss)} with no price change`,
      `Long tail orders: ${input.longTail.orders_last_month} → ${input.longTail.orders_this_month}`,
      "Ranking data is not available, so this is an inference from the pattern",
    ],
    estimated_monthly_impact_inr: visLoss,
    confidence: "inference",
  };

  // 4. Promotions (assumption-based, low confidence) --------------------------
  const promoLoss = roundTo(current.sales_inr * DEAL_UPLIFT, 500);
  const promotions: Issue = {
    id: "promotions",
    title: "No deals or ads this month",
    severity: "medium",
    summary: "The store ran no deals, coupons or ads this month while competitors likely did. Low confidence: competitor activity is an assumption.",
    evidence: [
      `Deals / ads this month: ${PROMOTIONS.deals_or_ads_this_month ? "yes" : "none"}`,
      `Last deal participation: ${PROMOTIONS.last_deal_participation}`,
      `A deal typically adds ~${formatPct(DEAL_UPLIFT)} sales ≈ ${formatInr(promoLoss)}/month (estimate)`,
    ],
    estimated_monthly_impact_inr: promoLoss,
    confidence: "inference",
  };

  const issues = [inventory, cancellations, visibility, promotions].sort(
    (a, b) => b.estimated_monthly_impact_inr - a.estimated_monthly_impact_inr,
  );

  return {
    headline: {
      sales_change_inr: salesChange,
      sales_change_pct: salesPct,
      orders_change_pct: ordersPct,
      asp_change_pct: aspPct,
      driver: "volume",
      statement: `Sales fell ${formatInr(Math.abs(salesChange))} (${salesPct}%) because orders fell ${Math.abs(ordersPct)}%; the average selling price is unchanged at ${formatInr(current.avg_selling_price_inr)}, so this is a volume problem, not a pricing problem.`,
    },
    ruled_out: [
      {
        cause: "pricing",
        reason: `Average selling price flat at ${formatInr(current.avg_selling_price_inr)} and no price changes this month.`,
      },
    ],
    issues,
    note: "₹ impacts are estimates and overlap (stock-outs also cause cancellations and lower ranking), so they should not be added up.",
  };
}

// ---------------------------------------------------------------------------
// Recovery estimates per action
// ---------------------------------------------------------------------------

export interface RecoveryEstimate {
  action_type: ActionType;
  expected_recovery_inr: number;
  basis: string;
  confidence: "medium" | "low";
}

/**
 * ₹/month we expect each action to recover. Deliberately conservative and
 * rounded to ₹500 so nothing sounds falsely precise.
 */
export function estimateRecovery(actionType: ActionType, input: DiagnosisInput = DEFAULT_INPUT): RecoveryEstimate {
  const invLoss = inventoryLoss(input.skus);
  const cancelLoss = extraCancelledOrders(input.last, input.current) * input.current.avg_selling_price_inr;

  switch (actionType) {
    case "generate_restock_list":
      return {
        action_type: actionType,
        expected_recovery_inr: roundTo(invLoss * 0.75, 500),
        basis: "Restocking the newly out-of-stock top sellers recovers ~75% of their lost sales within a month (ranking takes time to rebuild).",
        confidence: "medium",
      };
    case "pause_unrestockable_listings":
      return {
        action_type: actionType,
        expected_recovery_inr: roundTo(cancelLoss * 0.75, 500),
        basis: "Pausing listings that can't be restocked soon avoids ~75% of the extra 'item unavailable' cancellations and protects seller rating.",
        confidence: "medium",
      };
    case "enable_stock_alerts":
      return {
        action_type: actionType,
        expected_recovery_inr: roundTo(invLoss * 0.1, 500),
        basis: "Low-stock alerts prevent repeat stock-outs; we assume ~10% of this month's inventory loss is avoided going forward.",
        confidence: "low",
      };
    case "enroll_in_deal":
      return {
        action_type: actionType,
        expected_recovery_inr: roundTo(input.current.sales_inr * DEAL_UPLIFT, 500),
        basis: `Category deals typically lift sales ~${formatPct(DEAL_UPLIFT)}; only worth it once top sellers are back in stock.`,
        confidence: "low",
      };
    case "reactivate_listings_on_restock":
      return {
        action_type: actionType,
        expected_recovery_inr: roundTo(inStockDecline(input) * 0.5, 500),
        basis:
          "Paused or out-of-stock listings shrink the store's visible catalogue, which also drags down in-stock products. Reactivating each listing the day stock lands recovers ~half of the visibility loss.",
        confidence: "low",
      };
    case "targeted_sku_deal":
      return {
        action_type: actionType,
        expected_recovery_inr: roundTo(avgTopSellerRevenue(input.skus) * TARGETED_DEAL_UPLIFT, 500),
        basis: `A targeted coupon on ONE competitor-pressured product (once in stock) wins back ~${formatPct(TARGETED_DEAL_UPLIFT)} of a typical top seller's monthly sales, without cutting prices across the catalogue.`,
        confidence: "low",
      };
  }
}

/** Uplift from a coupon on one product facing a cheaper competitor (assumption). */
const TARGETED_DEAL_UPLIFT = 0.15;

/** Average last-month revenue of the 10 best-selling SKUs. */
function avgTopSellerRevenue(skus: Sku[]): number {
  const top = [...skus].sort((a, b) => b.units_last_month * b.price_inr - a.units_last_month * a.price_inr).slice(0, 10);
  return top.reduce((s, x) => s + x.units_last_month * x.price_inr, 0) / Math.max(1, top.length);
}

export function allRecoveryEstimates(input: DiagnosisInput = DEFAULT_INPUT): RecoveryEstimate[] {
  return (
    ["generate_restock_list", "pause_unrestockable_listings", "enable_stock_alerts", "enroll_in_deal", "reactivate_listings_on_restock", "targeted_sku_deal"] as const
  ).map(
    (t) => estimateRecovery(t, input),
  );
}

// ---------------------------------------------------------------------------
// Product views & mock-action payloads
// ---------------------------------------------------------------------------

export interface ProductRow {
  sku: string;
  name: string;
  price_inr: number;
  units_last_month: number;
  units_this_month: number;
  stock_status: Sku["stock_status"];
  days_out_of_stock: number;
  lost_revenue_inr: number;
}

function toRow(s: Sku): ProductRow {
  return {
    sku: s.sku,
    name: s.name,
    price_inr: s.price_inr,
    units_last_month: s.units_last_month,
    units_this_month: s.units_this_month,
    stock_status: s.stock_status,
    days_out_of_stock: s.days_out_of_stock,
    lost_revenue_inr: skuRevenueLoss(s),
  };
}

export function getProducts(filter: ProductFilter, skus: Sku[] = SKUS): ProductRow[] {
  const rows =
    filter === "out_of_stock"
      ? skus.filter((s) => s.stock_status === "out_of_stock")
      : filter === "top_sellers"
        ? [...skus].sort((a, b) => b.units_last_month * b.price_inr - a.units_last_month * a.price_inr).slice(0, 8)
        : skus;
  return rows.map(toRow).sort((a, b) => b.lost_revenue_inr - a.lost_revenue_inr);
}

export interface RestockLine {
  sku: string;
  name: string;
  suggested_qty: number;
  lost_revenue_inr: number;
}

/**
 * Restock list: newly out-of-stock SKUs (biggest loss first) plus low-stock
 * ones. Suggested qty = last month's demand + 25% buffer, rounded up to 5.
 */
export function buildRestockList(skus: Sku[] = SKUS): RestockLine[] {
  const candidates = [
    ...newlyOutOfStock(skus),
    ...skus.filter((s) => s.stock_status === "low_stock"),
  ];
  return candidates.map((s) => ({
    sku: s.sku,
    name: s.name,
    suggested_qty: Math.ceil((s.units_last_month * 1.25) / 5) * 5,
    lost_revenue_inr: skuRevenueLoss(s),
  }));
}

/** Listings to pause: out of stock for a long time (or explicitly named by the seller). */
export function pauseCandidates(skus: Sku[] = SKUS, minDaysOut = 30): Sku[] {
  return skus.filter((s) => s.stock_status === "out_of_stock" && s.days_out_of_stock >= minDaysOut);
}

// ---------------------------------------------------------------------------
// Follow-up mode: simulated progress since the last call
// ---------------------------------------------------------------------------

/**
 * In a real system this would come from fresh seller data. Here it is a
 * transparent simulation driven by which actions were executed last time,
 * so the follow-up conversation has something real to compare.
 */
export function computeProgress(executed: ActionType[]): ProgressSnapshot {
  const has = (t: ActionType) => executed.includes(t);
  const oosNow = has("generate_restock_list") ? 7 : 16;
  const cancelNow = has("pause_unrestockable_listings") ? 0.06 : has("generate_restock_list") ? 0.09 : 0.13;
  let ordersNow = 60;
  if (has("generate_restock_list")) ordersNow += 24;
  if (has("enroll_in_deal")) ordersNow += 6;
  if (has("enable_stock_alerts")) ordersNow += 2;
  return {
    label: "Simulated progress since last call",
    out_of_stock_products: { at_last_call: 18, now: oosNow },
    cancellation_rate_last_7_days: { at_last_call: 0.14, now: cancelNow },
    orders_last_7_days: { at_last_call: 60, now: ordersNow },
    explanation: executed.length
      ? `Simulated from actions executed last call: ${executed.join(", ")}.`
      : "No actions were executed last call, so only small natural movement is simulated.",
  };
}
