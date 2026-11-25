// The Numbers tab (PLAN §1, M1–M18). Pure: rows in, numbers out. Tested against a fixture in tests/metrics.test.mjs.
// ponytail: computed in JS over all rows; fine for thousands of leads, move the heavy parts into SQL if it ever gets slow.
import { addDays, torontoDate, torontoToUtc, DAY } from "./rules.ts";

export type Ev = { ts: string; type: string; lead_id?: string | null; job_id?: string | null; campaign_id?: string | null; value_cents: number; meta: Record<string, any> };
export type LeadRow = { id: string; created_at: string; source: string; campaign_id: string | null; area: string };
export type TouchRow = { lead_id: string; kind: string; due_at: string; done_at: string | null; skipped_at: string | null };
export type CampaignRow = { id: string; name: string; channel: string; pieces: number; cost_cents: number; start_date: string };
export type JobCostRow = { job_id: string; completed_at: string; price_cents: number; materials_cents: number; labour_hours: number; sub_cents: number; other_cents: number };
export type Data = { leads: LeadRow[]; events: Ev[]; touches: TouchRow[]; campaigns: CampaignRow[]; jobCosts: JobCostRow[]; openQuotes: { lead_id: string; subtotal_cents: number }[]; labourRateCents: number };

const OUTBOUND = new Set(["call", "sms", "email", "video"]);
const t = (iso: string) => Date.parse(iso);
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null); // % with 1 decimal
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export type PeriodKind = "week" | "month" | "season" | "year";

/** Toronto calendar periods; season = Mar 1 – Nov 30. */
export function periodRange(kind: PeriodKind, now: number) {
  const today = torontoDate(now);
  const [y, m] = today.split("-").map(Number);
  const at = (d: string) => { const [a, b, c] = d.split("-").map(Number); return torontoToUtc(a, b, c); };
  const ymd = (a: number, b: number) => new Date(Date.UTC(a, b - 1, 1)).toISOString().slice(0, 10);
  let s: string, e: string, ps: string, pe: string;
  if (kind === "week") {
    const dow = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
    s = addDays(today, -dow); e = addDays(s, 7); ps = addDays(s, -7); pe = s;
  } else if (kind === "month") {
    s = ymd(y, m); e = ymd(y, m + 1); ps = ymd(y, m - 1); pe = s;
  } else if (kind === "season") {
    const sy = m < 3 ? y - 1 : y;
    s = ymd(sy, 3); e = ymd(sy, 12); ps = ymd(sy - 1, 3); pe = ymd(sy - 1, 12);
  } else {
    s = ymd(y, 1); e = ymd(y + 1, 1); ps = ymd(y - 1, 1); pe = s;
  }
  return { start: at(s), end: at(e), prevStart: at(ps), prevEnd: at(pe), label: `${s} – ${addDays(e, -1)}` };
}

export function computeMetrics(d: Data, start: number, end: number, now: number) {
  const inP = (iso: string | null | undefined) => !!iso && t(iso) >= start && t(iso) < end;
  const leadById = new Map(d.leads.map((l) => [l.id, l]));
  const leadsP = d.leads.filter((l) => inP(l.created_at));
  const evP = d.events.filter((e) => inP(e.ts));
  const stageTo = (to: string[], evs = evP) => new Set(evs.filter((e) => e.type === "stage_changed" && to.includes(e.meta.to)).map((e) => e.lead_id!));

  // M2 speed to lead
  const firstOut = new Map<string, number>();
  for (const x of d.touches) if (x.done_at && OUTBOUND.has(x.kind)) {
    const v = t(x.done_at);
    if (!firstOut.has(x.lead_id) || v < firstOut.get(x.lead_id)!) firstOut.set(x.lead_id, v);
  }
  const speeds = leadsP.filter((l) => firstOut.has(l.id)).map((l) => Math.max(0, Math.round((firstOut.get(l.id)! - t(l.created_at)) / 60000)));

  // M3–M7 funnel
  const contacted = stageTo(["contacted", "visit", "quoted", "won"]);
  const visits = stageTo(["visit"]);
  const quoteEv = new Map<string, Ev>();
  for (const e of evP) if (e.type === "quote_sent") quoteEv.set(e.lead_id!, e); // latest per lead
  const wonEv = evP.filter((e) => e.type === "stage_changed" && e.meta.to === "won");
  const lostEv = evP.filter((e) => e.type === "stage_changed" && e.meta.to === "lost");
  const wonCents = sum(wonEv.map((e) => e.value_cents));
  const quotedCents = sum([...quoteEv.values()].map((e) => e.value_cents));

  // M8 pipeline, weighted by the all-time quoted → won rate
  const everQuoted = new Set(d.events.filter((e) => e.type === "quote_sent").map((e) => e.lead_id));
  const everWon = stageTo(["won"], d.events);
  const winRate = everQuoted.size ? [...everWon].filter((id) => everQuoted.has(id)).length / everQuoted.size : 0;
  const pipeline = sum(d.openQuotes.map((q) => q.subtotal_cents));

  // M10 margin on jobs completed in the period
  const costed = d.jobCosts.filter((j) => inP(j.completed_at) && j.price_cents > 0);
  const jobCost = (j: JobCostRow) => j.materials_cents + Math.round(j.labour_hours * d.labourRateCents) + j.sub_cents + j.other_cents;
  const price = sum(costed.map((j) => j.price_cents));

  // M11–M13 campaigns (all-time per campaign)
  const wonAll = d.events.filter((e) => e.type === "stage_changed" && e.meta.to === "won");
  const campaigns = d.campaigns.map((c) => {
    const leads = d.leads.filter((l) => l.campaign_id === c.id);
    const ids = new Set(leads.map((l) => l.id));
    const won = wonAll.filter((e) => ids.has(e.lead_id!));
    const wonC = sum(won.map((e) => e.value_cents));
    const gp = sum(won.map((e) => e.value_cents - (e.meta.cost_cents ?? 0)));
    const scans = d.events.filter((e) => e.type === "qr_scanned" && e.campaign_id === c.id).length;
    return {
      id: c.id, name: c.name, channel: c.channel, pieces: c.pieces, cost_cents: c.cost_cents, scans, leads: leads.length, won: won.length, won_cents: wonC,
      cac_cents: won.length ? Math.round(c.cost_cents / won.length) : null,
      roi: c.cost_cents ? Math.round(((gp - c.cost_cents) / c.cost_cents) * 10) / 10 : null,
      scans_per_100: c.pieces ? Math.round((scans * 1000) / c.pieces) / 10 : null,
      scan_to_lead: ratio(leads.filter((l) => l.source === "qr").length, scans),
      lead_to_won: ratio(won.length, leads.length),
      cents_per_piece: c.pieces ? Math.round(wonC / c.pieces) : null,
    };
  });
  const spendP = sum(d.campaigns.filter((c) => c.start_date && t(c.start_date + "T12:00:00Z") >= start && t(c.start_date + "T12:00:00Z") < end).map((c) => c.cost_cents));

  // Sources (period)
  const sources: Record<string, { leads: number; won: number; won_cents: number }> = {};
  for (const l of leadsP) (sources[l.source] ??= { leads: 0, won: 0, won_cents: 0 }).leads++;
  for (const e of wonEv) {
    const s = leadById.get(e.lead_id!)?.source ?? "other";
    const row = (sources[s] ??= { leads: 0, won: 0, won_cents: 0 });
    row.won++; row.won_cents += e.value_cents;
  }

  // M14 follow-up compliance: done on or before the due day (Toronto)
  const due = d.touches.filter((x) => !x.skipped_at && inP(x.due_at) && t(x.due_at) <= now);
  const onTime = due.filter((x) => x.done_at && torontoDate(t(x.done_at)) <= torontoDate(t(x.due_at)));

  // M15 cycle times (days)
  const firstQuote = new Map<string, number>();
  for (const e of d.events) if (e.type === "quote_sent" && !firstQuote.has(e.lead_id!)) firstQuote.set(e.lead_id!, t(e.ts));
  const toQuote = [...quoteEv.keys()].filter((id) => leadById.has(id)).map((id) => (firstQuote.get(id)! - t(leadById.get(id)!.created_at)) / DAY);
  const toDecision = [...wonEv, ...lostEv].filter((e) => firstQuote.has(e.lead_id!)).map((e) => (t(e.ts) - firstQuote.get(e.lead_id!)!) / DAY);

  // M16 reviews
  const completed = evP.filter((e) => e.type === "job_completed");
  const reviews = evP.filter((e) => e.type === "review_received");
  const completedAt = new Map(d.events.filter((e) => e.type === "job_completed").map((e) => [e.job_id, t(e.ts)]));
  const reviewDays = reviews.filter((e) => completedAt.has(e.job_id)).map((e) => (t(e.ts) - completedAt.get(e.job_id)!) / DAY);

  // M17 lost reasons, M18 areas
  const lost: Record<string, number> = {};
  for (const e of lostEv) lost[e.meta.reason || "no reason"] = (lost[e.meta.reason || "no reason"] ?? 0) + 1;
  const wonByLead = new Map(wonAll.map((e) => [e.lead_id, e.value_cents]));
  const areas: Record<string, { leads: number; won: number; won_cents: number }> = {};
  for (const l of leadsP) {
    const a = (areas[l.area || "Unknown"] ??= { leads: 0, won: 0, won_cents: 0 });
    a.leads++;
    if (wonByLead.has(l.id)) { a.won++; a.won_cents += wonByLead.get(l.id)!; }
  }
  const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

  return {
    leads: leadsP.length,
    speed_median_min: median(speeds),
    speed_under_60_pct: ratio(speeds.filter((s) => s <= 60).length, leadsP.length),
    contact_rate: ratio(contacted.size, leadsP.length),
    visit_rate: ratio(visits.size, contacted.size),
    quote_rate: ratio(quoteEv.size, visits.size),
    close_rate_count: ratio(wonEv.length, quoteEv.size),
    close_rate_dollars: ratio(wonCents, quotedCents),
    won: wonEv.length,
    avg_job_cents: wonEv.length ? Math.round(wonCents / wonEv.length) : null,
    pipeline_cents: pipeline,
    pipeline_weighted_cents: Math.round(pipeline * winRate),
    revenue_booked_cents: wonCents,
    revenue_completed_cents: sum(completed.map((e) => e.value_cents)),
    revenue_collected_cents: sum(evP.filter((e) => e.type === "invoice_paid").map((e) => e.value_cents)),
    gross_margin_pct: price ? ratio(price - sum(costed.map(jobCost)), price) : null,
    spend_cents: spendP,
    cost_per_job_cents: wonEv.length ? Math.round(spendP / wonEv.length) : null,
    follow_up_compliance: ratio(onTime.length, due.length),
    days_lead_to_quote: round1(median(toQuote)),
    days_quote_to_decision: round1(median(toDecision)),
    reviews: reviews.length,
    review_rate: ratio(reviews.length, completed.length),
    review_median_days: round1(median(reviewDays)),
    funnel: { leads: leadsP.length, contacted: contacted.size, visits: visits.size, quoted: quoteEv.size, won: wonEv.length },
    sources, campaigns, lost, areas,
  };
}
