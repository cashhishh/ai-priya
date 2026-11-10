"use client";
import { METRICS, SELLER_PROFILE } from "@/data/seller";
import type { CallState } from "@/lib/call-state";
import { formatInr, formatInrShort, formatPct, pctChange } from "@/lib/format";
import { prettyDate } from "@/lib/tools/summary";
import type { ActionItem, Issue, Severity } from "@/lib/types";
import {
  AlertIcon,
  Badge,
  CalendarIcon,
  Card,
  CheckIcon,
  EmptyHint,
  LightbulbIcon,
  StoreIcon,
  TargetIcon,
  TrendIcon,
  cx,
} from "./ui";

export function Seller360({ state }: { state: CallState }) {
  return (
    <div className="space-y-4">
      <MetricsCard state={state} />
      <IssuesCard state={state} />
      <InsightsCard state={state} />
      <ActionPlanCard state={state} />
      <RecoveryCard actions={state.actions} flashKey={state.updatedAt.actions} />
      <FollowUpCard state={state} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function MetricsCard({ state }: { state: CallState }) {
  const l = METRICS.last_month;
  const c = METRICS.this_month;
  const rows: { label: string; last: string; now: string; delta: number; goodWhenUp: boolean; deltaLabel: string }[] = [
    { label: "Sales", last: formatInrShort(l.sales_inr), now: formatInrShort(c.sales_inr), delta: pctChange(l.sales_inr, c.sales_inr), goodWhenUp: true, deltaLabel: `${pctChange(l.sales_inr, c.sales_inr)}%` },
    { label: "Orders", last: String(l.orders), now: String(c.orders), delta: pctChange(l.orders, c.orders), goodWhenUp: true, deltaLabel: `${pctChange(l.orders, c.orders)}%` },
    { label: "Cancellations", last: formatPct(l.cancellation_rate), now: formatPct(c.cancellation_rate), delta: c.cancellation_rate - l.cancellation_rate, goodWhenUp: false, deltaLabel: `+${Math.round((c.cancellation_rate - l.cancellation_rate) * 100)} pts` },
    { label: "Avg price", last: formatInr(l.avg_selling_price_inr), now: formatInr(c.avg_selling_price_inr), delta: 0, goodWhenUp: true, deltaLabel: "flat" },
    { label: "Out of stock", last: String(l.out_of_stock_products), now: String(c.out_of_stock_products), delta: c.out_of_stock_products - l.out_of_stock_products, goodWhenUp: false, deltaLabel: `+${c.out_of_stock_products - l.out_of_stock_products}` },
  ];
  const p = state.progress;
  return (
    <Card
      title="Seller 360"
      icon={<StoreIcon size={15} />}
      flashKey={state.updatedAt.metrics}
      right={<span className="text-[11px] text-slate-400">last month → this month</span>}
    >
      <div className="px-4 pt-3">
        <p className="text-sm font-semibold text-slate-800">{SELLER_PROFILE.store_name}</p>
        <p className="text-[11px] text-slate-500">
          {SELLER_PROFILE.seller_name} · {SELLER_PROFILE.category} · {SELLER_PROFILE.city} · {SELLER_PROFILE.years_on_platform} yrs · {SELLER_PROFILE.active_listings} listings
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
        {rows.map((r) => {
          const bad = r.delta !== 0 && (r.delta > 0) !== r.goodWhenUp;
          return (
            <div key={r.label} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[11px] font-medium text-slate-500">{r.label}</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">{r.now}</p>
              <p className="text-[11px] text-slate-400 tabular-nums">
                was {r.last}{" "}
                <span className={cx("font-semibold", r.delta === 0 ? "text-slate-500" : bad ? "text-red-600" : "text-emerald-600")}>
                  {r.delta === 0 ? "● " : bad ? "▼ " : "▲ "}
                  {r.deltaLabel}
                </span>
              </p>
            </div>
          );
        })}
      </div>
      {p && (
        <div className="mx-4 mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 animate-fade-up">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
            <TrendIcon size={13} /> Since last call <Badge tone="slate">simulated</Badge>
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
            <span>Out of stock <b className="text-slate-900">{p.out_of_stock_products.at_last_call} → {p.out_of_stock_products.now}</b></span>
            <span>Cancel (7d) <b className="text-slate-900">{formatPct(p.cancellation_rate_last_7_days.at_last_call)} → {formatPct(p.cancellation_rate_last_7_days.now)}</b></span>
            <span>Orders (7d) <b className="text-slate-900">{p.orders_last_7_days.at_last_call} → {p.orders_last_7_days.now}</b></span>
          </div>
        </div>
      )}
    </Card>
  );
}

const SEVERITY_TONE: Record<Severity, "red" | "amber" | "slate" | "accent"> = {
  critical: "red",
  high: "accent",
  medium: "amber",
  low: "slate",
};

function IssuesCard({ state }: { state: CallState }) {
  const d = state.diagnosis;
  return (
    <Card title="Issues detected" icon={<AlertIcon size={15} />} flashKey={state.updatedAt.issues} right={d && <span className="text-[11px] text-slate-400">ranked by ₹ impact</span>}>
      {!d ? (
        <EmptyHint>Priya runs the diagnosis engine during the call. Issues will appear here, ranked by monthly ₹ impact.</EmptyHint>
      ) : (
        <div className="space-y-2.5 p-4">
          <div className="rounded-xl bg-slate-900 px-3.5 py-3 text-white">
            <p className="text-xs leading-relaxed text-slate-200">{d.headline.statement}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.ruled_out.map((r) => (
                <span key={r.cause} className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-400/30">
                  ✓ {r.cause} ruled out
                </span>
              ))}
            </div>
          </div>
          {d.issues.map((i, idx) => (
            <IssueRow key={i.id} issue={i} rank={idx + 1} />
          ))}
          <p className="text-[10px] leading-relaxed text-slate-400">{d.note}</p>
        </div>
      )}
    </Card>
  );
}

function IssueRow({ issue, rank }: { issue: Issue; rank: number }) {
  return (
    <details className="group animate-fade-up rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 open:bg-slate-50/60" open={rank === 1}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-800">
            <span className="mr-1 text-slate-400">{rank}.</span>
            {issue.title}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
            <Badge tone={issue.confidence === "data" ? "blue" : "violet"}>{issue.confidence === "data" ? "from data" : "inference"}</Badge>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-red-600 tabular-nums">−{formatInrShort(issue.estimated_monthly_impact_inr)}</p>
          <p className="text-[10px] text-slate-400">/month (est.)</p>
        </div>
      </summary>
      <p className="mt-2 text-xs text-slate-600">{issue.summary}</p>
      <ul className="mt-1.5 space-y-0.5">
        {issue.evidence.map((e) => (
          <li key={e} className="text-[11px] leading-relaxed text-slate-500">• {e}</li>
        ))}
      </ul>
    </details>
  );
}

function InsightsCard({ state }: { state: CallState }) {
  return (
    <Card title="Seller insights" icon={<LightbulbIcon size={15} />} flashKey={state.updatedAt.insights}>
      {state.insights.length === 0 ? (
        <EmptyHint>Things only the seller knows (supplier delays, priorities) get recorded here.</EmptyHint>
      ) : (
        <ul className="space-y-2 p-4">
          {state.insights.map((i) => (
            <li key={i.id} className="flex animate-fade-up items-start gap-2 text-xs text-slate-700">
              <Badge tone="amber" className="mt-px">{i.topic}</Badge>
              <span className="leading-relaxed">{i.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActionPlanCard({ state }: { state: CallState }) {
  return (
    <Card title="Action plan" icon={<TargetIcon size={15} />} flashKey={state.updatedAt.actions}>
      {state.actions.length === 0 ? (
        <EmptyHint>2–3 prioritised actions with ₹ recovery estimates will appear here. Priya can execute some during the call.</EmptyHint>
      ) : (
        <ol className="space-y-2.5 p-4">
          {state.actions.map((a, i) => (
            <ActionRow key={a.id} action={a} index={i + 1} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function ActionRow({ action: a, index }: { action: ActionItem; index: number }) {
  const executed = a.status === "executed";
  return (
    <li className={cx("animate-fade-up rounded-xl border px-3 py-2.5 transition-colors", executed ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200/80 bg-white")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-800">
          <span className="mr-1 text-slate-400">{index}.</span>
          {a.title}
        </p>
        <p className="shrink-0 text-sm font-semibold text-emerald-600 tabular-nums">+{formatInrShort(a.expected_recovery_inr)}</p>
      </div>
      {a.why && <p className="mt-1 text-xs text-slate-600">{a.why}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {executed ? (
          <Badge tone="green">
            <CheckIcon size={11} /> executed
          </Badge>
        ) : (
          <Badge tone="amber">proposed</Badge>
        )}
        <Badge>{a.owner === "kam" ? "owner: Priya (KAM)" : "owner: seller"}</Badge>
        <Badge>due {prettyDate(a.due_date)}</Badge>
      </div>
      {executed && a.execution_result && (
        <details className="mt-2 text-[11px] text-emerald-800">
          <summary className="cursor-pointer font-medium">{a.execution_result}</summary>
          {a.execution_lines && (
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto scroll-thin pl-1 text-slate-600">
              {a.execution_lines.map((l) => (
                <li key={l} className="font-mono text-[10.5px]">{l}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  );
}

function RecoveryCard({ actions, flashKey }: { actions: ActionItem[]; flashKey?: number }) {
  const current = METRICS.this_month.sales_inr;
  const target = METRICS.last_month.sales_inr;
  const recovery = actions.reduce((s, a) => s + a.expected_recovery_inr, 0);
  // Never project above last month's level; estimates overlap.
  const projected = Math.min(target, current + recovery);
  const pct = (v: number) => `${(v / target) * 100}%`;
  return (
    <Card title="Revenue recovery" icon={<TrendIcon size={15} />} flashKey={flashKey}>
      <div className="p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] text-slate-500">Now</p>
            <p className="text-lg font-semibold text-slate-900 tabular-nums">{formatInrShort(current)}</p>
          </div>
          <div className="text-center">
            <p className="text-[11px] text-slate-500">Projected after actions</p>
            <p className={cx("text-lg font-semibold tabular-nums", recovery ? "text-emerald-600" : "text-slate-300")}>{formatInrShort(projected)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-500">Last month</p>
            <p className="text-lg font-semibold text-slate-400 tabular-nums">{formatInrShort(target)}</p>
          </div>
        </div>
        <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-300 transition-all duration-700 ease-out" style={{ width: pct(projected) }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-slate-700" style={{ width: pct(current) }} />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {recovery
            ? `+${formatInr(recovery)}/month estimated from ${actions.length} action${actions.length > 1 ? "s" : ""}. Estimates, not guarantees; capped at last month's level.`
            : "Recovery appears as Priya proposes actions."}
        </p>
      </div>
    </Card>
  );
}

function FollowUpCard({ state }: { state: CallState }) {
  const f = state.followUp;
  const e = state.escalation;
  return (
    <Card title="Follow-up" icon={<CalendarIcon size={15} />} flashKey={state.updatedAt.followup}>
      <div className="space-y-2 p-4">
        {e && (
          <div className="animate-fade-up rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p className="font-semibold">Escalated to a human KAM · {e.ticket_id}</p>
            <p className="mt-0.5">{e.reason}</p>
          </div>
        )}
        {f ? (
          <div className="flex animate-fade-up items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-50 text-center text-accent">
              <span className="text-[10px] font-semibold uppercase leading-none">{new Date(f.date).toLocaleDateString("en-IN", { month: "short" })}</span>
              <span className="text-lg font-bold leading-none">{new Date(f.date).getDate() || "–"}</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{prettyDate(f.date)}</p>
              <p className="text-xs text-slate-600">{f.purpose}</p>
            </div>
          </div>
        ) : (
          !e && <p className="text-xs text-slate-400">Priya books a follow-up before ending the call.</p>
        )}
      </div>
    </Card>
  );
}
