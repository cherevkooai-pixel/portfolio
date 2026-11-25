import test from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, periodRange } from "../src/server/metrics.ts";

// Fixture: November 2026. 4 leads, 1 won, 1 lost, 1 quoted & open, 1 never contacted.
const ev = (ts, type, lead_id, extra = {}) => ({ ts, type, lead_id, job_id: null, campaign_id: null, value_cents: 0, meta: {}, ...extra });
const data = {
  labourRateCents: 4000,
  campaigns: [{ id: "c1", name: "Lorne Park postcards", channel: "postcard", pieces: 500, cost_cents: 50000, start_date: "2026-11-02" }],
  leads: [
    { id: "L1", created_at: "2026-11-02T14:00:00Z", source: "qr", campaign_id: "c1", area: "Lorne Park" },
    { id: "L2", created_at: "2026-11-03T14:00:00Z", source: "website", campaign_id: null, area: "Port Credit" },
    { id: "L3", created_at: "2026-11-04T14:00:00Z", source: "website", campaign_id: null, area: "Port Credit" },
    { id: "L4", created_at: "2026-11-05T14:00:00Z", source: "qr", campaign_id: "c1", area: "Lorne Park" },
    { id: "OLD", created_at: "2026-10-01T14:00:00Z", source: "referral", campaign_id: null, area: "Clarkson" },
  ],
  touches: [
    { lead_id: "L1", kind: "call", due_at: "2026-11-02T15:00:00Z", done_at: "2026-11-02T14:10:00Z", skipped_at: null },
    { lead_id: "L2", kind: "call", due_at: "2026-11-03T15:00:00Z", done_at: "2026-11-03T15:30:00Z", skipped_at: null },
    { lead_id: "L3", kind: "sms", due_at: "2026-11-04T15:00:00Z", done_at: "2026-11-04T16:00:00Z", skipped_at: null },
    { lead_id: "L3", kind: "call", due_at: "2026-11-05T15:00:00Z", done_at: "2026-11-07T15:00:00Z", skipped_at: null },
    { lead_id: "L4", kind: "call", due_at: "2026-11-05T15:00:00Z", done_at: null, skipped_at: null },
    { lead_id: "L4", kind: "sms", due_at: "2026-11-06T15:00:00Z", done_at: null, skipped_at: "2026-11-06T00:00:00Z" },
    { lead_id: "L4", kind: "call", due_at: "2026-11-30T15:00:00Z", done_at: null, skipped_at: null }, // not yet due
  ],
  events: [
    ev("2026-11-02T13:00:00Z", "qr_scanned", null, { campaign_id: "c1" }),
    ev("2026-11-02T13:30:00Z", "qr_scanned", null, { campaign_id: "c1" }),
    ev("2026-11-05T13:00:00Z", "qr_scanned", null, { campaign_id: "c1" }),
    ev("2026-11-02T14:20:00Z", "stage_changed", "L1", { meta: { to: "contacted" } }),
    ev("2026-11-03T16:00:00Z", "stage_changed", "L1", { meta: { to: "visit" } }),
    ev("2026-11-04T16:00:00Z", "quote_sent", "L1", { value_cents: 2_000_000 }),
    ev("2026-11-06T16:00:00Z", "stage_changed", "L1", { value_cents: 2_000_000, meta: { to: "won", cost_cents: 1_100_000 } }),
    ev("2026-11-03T16:00:00Z", "stage_changed", "L2", { meta: { to: "contacted" } }),
    ev("2026-11-04T16:00:00Z", "stage_changed", "L2", { meta: { to: "visit" } }),
    ev("2026-11-05T16:00:00Z", "quote_sent", "L2", { value_cents: 1_000_000 }),
    ev("2026-11-09T16:00:00Z", "stage_changed", "L2", { meta: { to: "lost", reason: "price" } }),
    ev("2026-11-04T17:00:00Z", "stage_changed", "L3", { meta: { to: "contacted" } }),
    ev("2026-11-05T17:00:00Z", "stage_changed", "L3", { meta: { to: "visit" } }),
    ev("2026-11-06T17:00:00Z", "quote_sent", "L3", { value_cents: 1_500_000 }),
    ev("2026-11-20T15:00:00Z", "job_completed", "L1", { job_id: "J1", value_cents: 2_000_000 }),
    ev("2026-11-23T15:00:00Z", "review_received", "L1", { job_id: "J1" }),
    ev("2026-11-24T15:00:00Z", "invoice_paid", "L1", { job_id: "J1", value_cents: 2_260_000 }),
  ],
  jobCosts: [{ job_id: "J1", completed_at: "2026-11-20T15:00:00Z", price_cents: 2_000_000, materials_cents: 600_000, labour_hours: 100, sub_cents: 100_000, other_cents: 0 }],
  openQuotes: [{ lead_id: "L3", subtotal_cents: 1_500_000 }],
};

test("metrics M1–M18 match the fixture exactly", () => {
  const start = Date.parse("2026-11-01T04:00:00Z"), end = Date.parse("2026-12-01T05:00:00Z"), now = Date.parse("2026-11-28T12:00:00Z");
  const m = computeMetrics(data, start, end, now);
  assert.equal(m.leads, 4);                                  // M1 (OLD is October)
  assert.equal(m.speed_median_min, 90);                      // M2: 10, 90, 120 min → median 90
  assert.equal(m.speed_under_60_pct, 25);                    //     1 of 4 leads under 60 min
  assert.equal(m.contact_rate, 75);                          // M3: 3 of 4
  assert.equal(m.visit_rate, 100);                           // M4
  assert.equal(m.quote_rate, 100);                           // M5
  assert.equal(m.close_rate_count, 33.3);                    // M6: 1 of 3 quotes
  assert.equal(m.close_rate_dollars, 44.4);                  //     $20k of $45k
  assert.equal(m.avg_job_cents, 2_000_000);                  // M7
  assert.equal(m.pipeline_cents, 1_500_000);                 // M8
  assert.equal(m.pipeline_weighted_cents, 500_000);          //     × 1/3 historical win rate
  assert.equal(m.revenue_booked_cents, 2_000_000);           // M9
  assert.equal(m.revenue_completed_cents, 2_000_000);
  assert.equal(m.revenue_collected_cents, 2_260_000);
  assert.equal(m.gross_margin_pct, 45);                      // M10: (20000 − 6000 − 4000 − 1000) / 20000
  assert.equal(m.cost_per_job_cents, 50_000);                // M11 (top row): $500 spend / 1 won
  const c = m.campaigns[0];
  assert.equal(c.cac_cents, 50_000);
  assert.equal(c.roi, 17);                                   // M12: (9000 − 500) / 500
  assert.equal(c.scans_per_100, 0.6);                        // M13: 3 scans / 500 pieces
  assert.equal(c.scan_to_lead, 66.7);                        //      2 QR leads / 3 scans
  assert.equal(c.lead_to_won, 50);
  assert.equal(c.cents_per_piece, 4000);
  assert.equal(m.follow_up_compliance, 60);                  // M14: 3 on time of 5 due (skipped and future excluded)
  assert.equal(m.days_lead_to_quote, 2.1);                   // M15: 2.08, 2.08, 2.13 days → median 2.08
  assert.equal(m.days_quote_to_decision, 3);                 //      won after 2 days, lost after 4 → median 3
  assert.equal(m.review_rate, 100);                          // M16
  assert.equal(m.review_median_days, 3);
  assert.deepEqual(m.lost, { price: 1 });                    // M17
  assert.deepEqual(m.areas["Lorne Park"], { leads: 2, won: 1, won_cents: 2_000_000 }); // M18
  assert.deepEqual(m.sources.qr, { leads: 2, won: 1, won_cents: 2_000_000 });
});

test("periods are Toronto calendar ranges with the previous period", () => {
  const now = Date.parse("2026-11-04T18:00:00Z"); // Wed
  const w = periodRange("week", now);
  assert.equal(new Date(w.start).toISOString(), "2026-11-02T05:00:00.000Z"); // Mon 00:00 EST
  assert.equal(w.end - w.start, 7 * 86_400_000);
  const s = periodRange("season", Date.parse("2027-01-10T12:00:00Z"));
  assert.equal(s.label, "2026-03-01 – 2026-11-30");
  const m = periodRange("month", now);
  assert.equal(new Date(m.prevStart).toISOString(), "2026-10-01T04:00:00.000Z");
});
