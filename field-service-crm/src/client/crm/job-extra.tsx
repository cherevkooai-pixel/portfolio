import { useEffect, useState } from "preact/hooks";
import { useApp } from "../context";
import { useGet, act, money, pct, fill, smsHref, dollarsToCents, centsToInput, type Row } from "./lib";
import { Photos } from "./photos";

/** CRM panel inside the base job page: lead link, job costing, review request, photos. */
export function JobExtra({ jobId }: { jobId: string }) {
  const { navigate } = useApp();
  const { data, reload } = useGet<Row>(`/api/crm/jobs/${jobId}`);
  const [c, setC] = useState({ labour_hours: "0", sub: "0", other: "0" });
  useEffect(() => { if (data) setC({ labour_hours: String(data.costs.labour_hours ?? 0), sub: centsToInput(data.costs.sub_cents ?? 0), other: centsToInput(data.costs.other_cents ?? 0) }); }, [data]);
  if (!data) return null;
  const { lead, quote, settings, templates, reviews } = data;
  const review = templates.find((t: Row) => t.id === "review")?.body ?? "";
  const requested = reviews.some((r: Row) => r.type === "review_requested");
  const received = reviews.some((r: Row) => r.type === "review_received");
  return (
    <div class="c-jobextra">
      {lead && <section class="c-card c-row c-click" onClick={() => navigate(`/leads/${lead.id}`)}>
        <span>Lead: <b>{lead.name}</b> · {lead.source}</span>{quote && <b>{money(quote.subtotal_cents)} + HST</b>}
      </section>}
      <section class="c-card">
        <h2>Job costing</h2>
        <div class="c-form c-grid3">
          <label>Labour hours<input inputMode="decimal" value={c.labour_hours} onInput={(e) => setC({ ...c, labour_hours: (e.target as HTMLInputElement).value })} /></label>
          <label>Subcontractor $<input inputMode="decimal" value={c.sub} onInput={(e) => setC({ ...c, sub: (e.target as HTMLInputElement).value })} /></label>
          <label>Other (dump, rentals) $<input inputMode="decimal" value={c.other} onInput={(e) => setC({ ...c, other: (e.target as HTMLInputElement).value })} /></label>
        </div>
        <p class="c-small c-mut">Materials from this job's material list: {money(data.materials_cents)} · Labour rate {settings.labour_rate_cents ? money(settings.labour_rate_cents) + "/h" : "not set (More → Settings)"}</p>
        <div class="c-row"><span>Quoted margin {pct(data.quoted_margin_pct)} → <b class={data.actual_margin_pct != null && data.actual_margin_pct < settings.target_margin_pct ? "c-late" : "c-ok"}>actual {pct(data.actual_margin_pct)}</b></span>
          <button class="c-btn" onClick={async () => { if (await act("PUT", `/api/crm/jobs/${jobId}/costs`, { labour_hours: parseFloat(c.labour_hours) || 0, sub_cents: dollarsToCents(c.sub), other_cents: dollarsToCents(c.other) })) reload(); }}>Save costs</button></div>
      </section>
      {lead && <section class="c-card">
        <h2>Google review</h2>
        <p class="c-small c-mut">Ask every customer the same way: no reward, no “only if happy”, no wording suggestions (Google rules).</p>
        <div class="c-actions">
          {lead.phone && <a class={`c-btn ${requested ? "" : "c-go"}`} href={smsHref(lead.phone, fill(review, lead, settings))} onClick={() => act("POST", `/api/crm/jobs/${jobId}/review`, { kind: "requested" }).then(reload)}>{requested ? "Ask again" : "Ask for a review"}</a>}
          <button class="c-btn" disabled={received} onClick={async () => { if (await act("POST", `/api/crm/jobs/${jobId}/review`, { kind: "received" })) reload(); }}>{received ? "Review received ✓" : "They left a review"}</button>
        </div>
      </section>}
      <Photos jobId={jobId} />
    </div>
  );
}
