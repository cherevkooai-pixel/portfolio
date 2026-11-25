import { useState } from "preact/hooks";
import { useGet, money, pct, type Row } from "./lib";
import { useCountUp } from "./fx";

type Fmt = "n" | "$" | "%" | "min" | "d";
const show = (v: number | null | undefined, f: Fmt) => v == null ? "—" : f === "$" ? money(v) : f === "%" ? pct(v) : f === "min" ? `${v} min` : f === "d" ? `${v} d` : String(v);

function Big({ label, now, prev, f, lowerIsBetter = false, sub }: { label: string; now: number | null; prev: number | null; f: Fmt; lowerIsBetter?: boolean; sub?: string }) {
  let delta = null as null | { up: boolean; good: boolean; txt: string };
  if (now != null && prev === 0 && now > 0) delta = { up: true, good: !lowerIsBetter, txt: "new" };
  else if (now != null && prev != null && prev !== 0 && now !== prev) {
    const d = Math.round(((now - prev) / Math.abs(prev)) * 100);
    delta = { up: now > prev, good: lowerIsBetter ? now < prev : now > prev, txt: `${Math.abs(d)}%` };
  }
  const v = useCountUp(now);
  return (
    <div class="c-big">
      <span class="c-big-l">{label}</span>
      <b class="c-big-n">{show(f === "%" || f === "d" ? now : v, f)}</b>
      <span class={`c-delta ${delta ? (delta.good ? "c-ok" : "c-late") : "c-mut"}`}>{delta ? `${delta.up ? "↑" : "↓"} ${delta.txt}` : prev == null || now == null ? "" : "same as last"}{sub ? <span class="c-mut"> · {sub}</span> : null}</span>
    </div>
  );
}

export function Numbers() {
  const [period, setPeriod] = useState("month");
  const { data, error } = useGet<Row>(`/api/crm/numbers?period=${period}`);
  if (error) return <div class="c-page"><p class="c-err">{error}</p></div>;
  const n = data?.now, p = data?.prev;
  return (
    <div class="c-page c-wide">
      <header class="c-head"><h1>Numbers</h1><span class="c-mut c-small">{data?.label} vs previous</span></header>
      <div class="c-chips">{["week", "month", "season", "year"].map((k) => <button class={`c-chip ${period === k ? "on" : ""}`} onClick={() => setPeriod(k)}>{k === "season" ? "Season (Mar–Nov)" : "This " + k}</button>)}</div>
      {!n ? <p class="c-mut">Loading…</p> : <>
        <div class="c-bigs">
          <Big label="Leads" now={n.leads} prev={p.leads} f="n" />
          <Big label="Speed to lead" now={n.speed_median_min} prev={p.speed_median_min} f="min" lowerIsBetter sub={n.speed_under_60_pct == null ? undefined : `${n.speed_under_60_pct}% < 60 min`} />
          <Big label="Close rate" now={n.close_rate_count} prev={p.close_rate_count} f="%" sub={n.close_rate_dollars == null ? undefined : `${n.close_rate_dollars}% of $`} />
          <Big label="Revenue booked" now={n.revenue_booked_cents} prev={p.revenue_booked_cents} f="$" />
          <Big label="Pipeline" now={n.pipeline_cents} prev={null} f="$" sub={`weighted ${money(n.pipeline_weighted_cents)}`} />
          <Big label="Cost per job" now={n.cost_per_job_cents} prev={p.cost_per_job_cents} f="$" lowerIsBetter sub={`spend ${money(n.spend_cents)}`} />
        </div>

        <section class="c-card fx-funnel" key={period}><h2>Funnel</h2>
          {(["leads", "contacted", "visits", "quoted", "won"] as const).map((k) => (
            <div class="c-bar" key={k}><span>{k}</span><div><i style={{ width: `${n.funnel.leads ? Math.max(2, (n.funnel[k] / Math.max(n.funnel.leads, n.funnel[k])) * 100) : 0}%` }} /></div><b>{n.funnel[k]}</b></div>
          ))}
          <p class="c-small c-mut">Contact {pct(n.contact_rate)} · Visit {pct(n.visit_rate)} · Quote {pct(n.quote_rate)} · Close {pct(n.close_rate_count)}</p>
        </section>

        <div class="c-bigs c-bigs-sm">
          <Big label="Average job" now={n.avg_job_cents} prev={p.avg_job_cents} f="$" />
          <Big label="Gross margin" now={n.gross_margin_pct} prev={p.gross_margin_pct} f="%" sub={`target ${data.target_margin_pct}%`} />
          <Big label="Follow-up on time" now={n.follow_up_compliance} prev={p.follow_up_compliance} f="%" />
          <Big label="Completed" now={n.revenue_completed_cents} prev={p.revenue_completed_cents} f="$" />
          <Big label="Collected" now={n.revenue_collected_cents} prev={p.revenue_collected_cents} f="$" />
          <Big label="Reviews" now={n.reviews} prev={p.reviews} f="n" sub={n.review_rate == null ? undefined : `${n.review_rate}% of jobs`} />
          <Big label="Lead → quote" now={n.days_lead_to_quote} prev={p.days_lead_to_quote} f="d" lowerIsBetter />
          <Big label="Quote → decision" now={n.days_quote_to_decision} prev={p.days_quote_to_decision} f="d" lowerIsBetter />
        </div>

        <section class="c-card"><h2>Sources</h2>
          {Object.entries(n.sources).sort((a: any, b: any) => b[1].leads - a[1].leads).map(([s, v]: [string, any]) => (
            <div class="c-row" key={s}><span>{s}</span><span class="c-mut">{v.leads} leads · {v.won} won · <b>{money(v.won_cents)}</b></span></div>
          ))}
          {!Object.keys(n.sources).length && <p class="c-mut">No leads in this period.</p>}
        </section>

        <section class="c-card"><h2>Campaigns (all time)</h2>
          {n.campaigns.map((c: Row) => (
            <div class="c-camp" key={c.id}>
              <div class="c-row"><b>{c.name}</b><span class={c.roi != null && c.roi >= 3 ? "c-ok" : c.roi != null && c.roi < 1 ? "c-late" : ""}>ROI {c.roi == null ? "—" : `${c.roi}×`}</span></div>
              <p class="c-small c-mut">{money(c.cost_cents)} · {c.pieces} pcs · {c.scans} scans ({c.scans_per_100 ?? "—"}/100) · scan→lead {pct(c.scan_to_lead)} · {c.leads} leads · {c.won} won ({pct(c.lead_to_won)}) · {money(c.won_cents)} · CAC {money(c.cac_cents)} · {money(c.cents_per_piece)}/piece</p>
            </div>
          ))}
          {!n.campaigns.length && <p class="c-mut">No campaigns yet (More → Campaigns & QR).</p>}
        </section>

        <div class="c-two">
          <section class="c-card"><h2>Lost reasons</h2>
            {Object.entries(n.lost).map(([r, k]: [string, any]) => <div class="c-row" key={r}><span>{r}</span><b>{k}</b></div>)}
            {!Object.keys(n.lost).length && <p class="c-mut">None lost.</p>}
          </section>
          <section class="c-card"><h2>By area</h2>
            {Object.entries(n.areas).sort((a: any, b: any) => b[1].leads - a[1].leads).map(([a, v]: [string, any]) => <div class="c-row" key={a}><span>{a}</span><span class="c-mut">{v.leads} · {v.won} won · {money(v.won_cents)}</span></div>)}
            {!Object.keys(n.areas).length && <p class="c-mut">—</p>}
          </section>
        </div>
      </>}
    </div>
  );
}
