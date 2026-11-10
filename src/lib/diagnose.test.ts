import { describe, expect, it } from "vitest";
import { LONG_TAIL, METRICS, SKUS } from "@/data/seller";
import {
  buildRestockList,
  computeProgress,
  diagnose,
  estimateRecovery,
  extraCancelledOrders,
  getProducts,
  inventoryLoss,
  pauseCandidates,
} from "@/lib/diagnose";

describe("mock data consistency", () => {
  it("SKUs + long tail reconcile exactly with the given orders and sales", () => {
    const ordersLast = SKUS.reduce((s, x) => s + x.units_last_month, 0) + LONG_TAIL.orders_last_month;
    const ordersNow = SKUS.reduce((s, x) => s + x.units_this_month, 0) + LONG_TAIL.orders_this_month;
    const salesLast = SKUS.reduce((s, x) => s + x.units_last_month * x.price_inr, 0) + LONG_TAIL.sales_last_month_inr;
    const salesNow = SKUS.reduce((s, x) => s + x.units_this_month * x.price_inr, 0) + LONG_TAIL.sales_this_month_inr;
    expect(ordersLast).toBe(METRICS.last_month.orders);
    expect(ordersNow).toBe(METRICS.this_month.orders);
    expect(salesLast).toBe(METRICS.last_month.sales_inr);
    expect(salesNow).toBe(METRICS.this_month.sales_inr);
  });

  it("out-of-stock counts reconcile (5 → 18) with 13 newly out of stock", () => {
    const oosNow = SKUS.filter((s) => s.stock_status === "out_of_stock").length + LONG_TAIL.out_of_stock_this_month;
    const oosLast = SKUS.filter((s) => s.stock_status === "out_of_stock" && !s.newly_out_of_stock).length + LONG_TAIL.out_of_stock_last_month;
    expect(oosNow).toBe(18);
    expect(oosLast).toBe(5);
    expect(SKUS.length + LONG_TAIL.listings).toBe(60);
  });

  it("given metrics are exactly the assignment table", () => {
    expect(METRICS.last_month).toEqual({ sales_inr: 200000, orders: 400, cancellation_rate: 0.08, avg_selling_price_inr: 500, out_of_stock_products: 5 });
    expect(METRICS.this_month).toEqual({ sales_inr: 135000, orders: 270, cancellation_rate: 0.14, avg_selling_price_inr: 500, out_of_stock_products: 18 });
  });
});

describe("diagnose()", () => {
  const d = diagnose();

  it("identifies a volume-driven decline and rules out pricing", () => {
    expect(d.headline.orders_change_pct).toBe(-32.5);
    expect(d.headline.sales_change_pct).toBe(-32.5);
    expect(d.headline.asp_change_pct).toBe(0);
    expect(d.headline.driver).toBe("volume");
    expect(d.ruled_out.map((r) => r.cause)).toContain("pricing");
    expect(d.headline.statement).toMatch(/not a pricing problem/);
  });

  it("returns 4 issues sorted by ₹ impact, inventory first", () => {
    expect(d.issues).toHaveLength(4);
    const impacts = d.issues.map((i) => i.estimated_monthly_impact_inr);
    expect([...impacts].sort((a, b) => b - a)).toEqual(impacts);
    expect(d.issues[0].id).toBe("inventory");
    expect(d.issues[0].severity).toBe("critical");
  });

  it("computes inventory loss from the SKU list", () => {
    expect(inventoryLoss(SKUS)).toBe(47117);
    expect(d.issues.find((i) => i.id === "inventory")?.estimated_monthly_impact_inr).toBe(47117);
  });

  it("computes ~16 extra cancellations ≈ ₹8,000 and flags rating risk", () => {
    expect(extraCancelledOrders(METRICS.last_month, METRICS.this_month)).toBe(16);
    const c = d.issues.find((i) => i.id === "cancellations");
    expect(c?.estimated_monthly_impact_inr).toBe(8000);
    expect(c?.severity).toBe("high");
    expect(c?.confidence).toBe("data");
  });

  it("marks visibility and promotions as inference", () => {
    expect(d.issues.find((i) => i.id === "visibility")?.confidence).toBe("inference");
    expect(d.issues.find((i) => i.id === "promotions")?.confidence).toBe("inference");
  });

  it("all of the ₹65,000 decline is explained by SKU-level movements", () => {
    const visibility = d.issues.find((i) => i.id === "visibility")!.estimated_monthly_impact_inr;
    const oldOos = SKUS.filter((s) => s.stock_status === "out_of_stock" && !s.newly_out_of_stock).reduce(
      (s, x) => s + (x.units_last_month - x.units_this_month) * x.price_inr,
      0,
    );
    expect(inventoryLoss(SKUS) + visibility + oldOos).toBe(65000);
  });

  it("is deterministic", () => {
    expect(diagnose()).toEqual(d);
  });
});

describe("estimateRecovery()", () => {
  it("returns rounded, positive estimates for every action", () => {
    expect(estimateRecovery("generate_restock_list").expected_recovery_inr).toBe(35500);
    expect(estimateRecovery("pause_unrestockable_listings").expected_recovery_inr).toBe(6000);
    expect(estimateRecovery("enable_stock_alerts").expected_recovery_inr).toBe(4500);
    expect(estimateRecovery("enroll_in_deal").expected_recovery_inr).toBe(13500);
  });

  it("never projects beyond last month's sales when all actions are combined", () => {
    const total = (["generate_restock_list", "pause_unrestockable_listings", "enable_stock_alerts", "enroll_in_deal"] as const)
      .map((t) => estimateRecovery(t).expected_recovery_inr)
      .reduce((a, b) => a + b, 0);
    expect(METRICS.this_month.sales_inr + total).toBeLessThanOrEqual(METRICS.last_month.sales_inr);
  });
});

describe("product helpers", () => {
  it("restock list starts with the biggest loss and adds a 25% buffer", () => {
    const list = buildRestockList();
    expect(list[0].sku).toBe("RHE-101");
    expect(list[0].suggested_qty).toBe(40); // 30 × 1.25 = 37.5 → 40
    expect(list.every((l) => l.suggested_qty % 5 === 0)).toBe(true);
  });

  it("out_of_stock filter returns only out-of-stock SKUs", () => {
    expect(getProducts("out_of_stock").every((p) => p.stock_status === "out_of_stock")).toBe(true);
    expect(getProducts("out_of_stock")).toHaveLength(12);
  });

  it("pause candidates are the long-standing stock-outs", () => {
    expect(pauseCandidates().map((s) => s.sku)).toEqual(["RHE-119", "RHE-120"]);
  });

  it("progress improves when restock + pause were executed", () => {
    const p = computeProgress(["generate_restock_list", "pause_unrestockable_listings"]);
    expect(p.out_of_stock_products.now).toBeLessThan(p.out_of_stock_products.at_last_call);
    expect(p.cancellation_rate_last_7_days.now).toBeLessThan(0.1);
  });
});
