import { useState } from "preact/hooks";
import { useApp } from "../context";
import { useGet, act, ago, when, day, money, fill, telHref, smsHref, mailHref, phonePretty, STAGE_LABEL, SOURCES, SERVICES, type Row } from "./lib";
import { TouchActions } from "./today";
import { Photos } from "./photos";
import { Chain, celebrateWin } from "./fx";

const OPEN = ["new", "contacted", "visit", "quoted"];

export function Leads() {
  const { navigate } = useApp();
  const [stage, setStage] = useState("open");
  const [q, setQ] = useState("");
  const { data, error } = useGet<Row>(`/api/crm/leads?stage=${stage === "open" ? "" : stage}&q=${encodeURIComponent(q)}`);
  const counts = data?.counts ?? {};
  const leads: Row[] = (data?.leads ?? []).filter((l: Row) => stage !== "open" || OPEN.includes(l.stage));
  const groups = stage === "open" ? OPEN : [stage];
  return (
    <div class="c-page c-wide">
      <header class="c-head"><h1>Leads</h1><button class="c-btn c-go" onClick={() => navigate("/leads/new")}>+ Lead</button></header>
      <input class="c-search" type="search" placeholder="Search name, phone, street…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <div class="c-chips" role="tablist">
        {["open", "won", "lost", "later"].map((s) => (
          <button role="tab" aria-selected={stage === s} class={`c-chip ${stage === s ? "on" : ""}`} onClick={() => setStage(s)}>
            {s === "open" ? "Pipeline" : STAGE_LABEL[s]} <span>{s === "open" ? OPEN.reduce((a, k) => a + (counts[k] ?? 0), 0) : counts[s] ?? 0}</span>
          </button>
        ))}
      </div>
      {error && <p class="c-err">{error}</p>}
      <div class={stage === "open" ? "c-board" : ""}>
        {groups.map((g) => {
          const rows = leads.filter((l) => l.stage === g);
          return <section class="c-col" key={g}>
            <h2>{STAGE_LABEL[g]} <span class="c-mut">{rows.length}{rows.some((r) => r.quote_cents) ? " · " + money(rows.reduce((a, r) => a + (r.quote_cents ?? 0), 0)) : ""}</span></h2>
            {rows.map((l) => (
              <article class="c-card c-row" key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                <div><strong>{l.name}</strong>
                  <div class="c-mut">{[l.service, l.area || l.city || (l.line1 ? l.line1.split(",")[0] : ""), l.source].filter(Boolean).join(" · ")}</div>
                  {OPEN.includes(l.stage) && <div class="fx-chainrow"><Chain done={l.t_done ?? 0} late={l.t_late ?? 0} />{l.next_due && <span class={`c-small ${Date.parse(l.next_due) < Date.now() ? "c-late" : "c-mut"}`}>{Date.parse(l.next_due) < Date.now() ? "overdue " + ago(l.next_due) : "next " + ago(l.next_due)}</span>}</div>}
                  {l.lost_reason && <div class="c-small c-mut">Lost: {l.lost_reason}</div>}
                </div>
                <div class="c-right">{l.quote_cents ? <b>{money(l.quote_cents)}</b> : null}<span class="c-mut c-small">{ago(l.created_at)}</span></div>
              </article>
            ))}
            {!rows.length && <p class="c-mut c-small">None</p>}
          </section>;
        })}
      </div>
    </div>
  );
}

export function AddLead() {
  const { navigate } = useApp();
  const [f, setF] = useState<Row>({ name: "", phone: "", email: "", service: "", source: "phone", source_detail: "", line1: "", city: "Mississauga", area: "", details: "" });
  const set = (k: string) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const save = async (e: Event) => {
    e.preventDefault();
    const r = await act("POST", "/api/crm/leads", f);
    if (r) navigate(`/leads/${r.lead_id}`);
  };
  return (
    <form class="c-page c-form" onSubmit={save}>
      <header class="c-head"><h1>New lead</h1></header>
      <label>Name<input required value={f.name} onInput={set("name")} autoComplete="off" /></label>
      <label>Phone<input type="tel" inputMode="tel" value={f.phone} onInput={set("phone")} /></label>
      <fieldset><legend>Service</legend><div class="c-chips">{SERVICES.map((s) => <button type="button" class={`c-chip ${f.service === s ? "on" : ""}`} onClick={() => setF({ ...f, service: s })}>{s}</button>)}</div></fieldset>
      <fieldset><legend>Where did they come from?</legend><div class="c-chips">{SOURCES.filter((s) => !["website", "qr", "email"].includes(s)).map((s) => <button type="button" class={`c-chip ${f.source === s ? "on" : ""}`} onClick={() => setF({ ...f, source: s })}>{s}</button>)}</div></fieldset>
      <details><summary>More (optional)</summary>
        <label>Who referred / which ad<input value={f.source_detail} onInput={set("source_detail")} /></label>
        <label>Email<input type="email" value={f.email} onInput={set("email")} /></label>
        <label>Street address<input value={f.line1} onInput={set("line1")} autoComplete="off" /></label>
        <label>City<input value={f.city} onInput={set("city")} /></label>
        <label>Neighbourhood<input value={f.area} onInput={set("area")} placeholder="e.g. Lorne Park" /></label>
        <label>Notes<textarea rows={3} value={f.details} onInput={set("details")} /></label>
      </details>
      <button class="c-btn c-go c-big" type="submit">Save lead</button>
    </form>
  );
}

export function LeadDetail({ id }: { id: string }) {
  const { navigate } = useApp();
  const { data, error, reload } = useGet<Row>(`/api/crm/leads/${id}`);
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState("");
  const [lost, setLost] = useState("");
  const [later, setLater] = useState("");
  const [visitAt, setVisitAt] = useState("");
  const [jobDate, setJobDate] = useState("");
  if (error) return <div class="c-page"><p class="c-err">{error}</p></div>;
  if (!data) return <div class="c-page"><p class="c-mut">Loading…</p></div>;
  const { lead, touches, quotes, events, emails, job, consent, templates, settings, lost_reasons } = data;
  const token = [...quotes].reverse().find((q: Row) => q.accept_token)?.accept_token;
  const pending = touches.filter((t: Row) => !t.done_at && !t.skipped_at);
  const past = touches.filter((t: Row) => t.done_at || t.skipped_at);
  const hi = fill(templates.find((t: Row) => t.id === "hi")?.body ?? "", lead, settings);
  const stage = async (s: string, extra: Row = {}) => {
    if (!(await act("POST", `/api/crm/leads/${id}/stage`, { stage: s, ...extra }))) return;
    if (s === "won") { const q = [...quotes].reverse().find((x: Row) => x.status === "accepted" || x.status === "sent"); celebrateWin(q?.subtotal_cents ?? 0, lead.name); }
    reload();
  };
  const newQuote = async () => { const r = await act("POST", `/api/crm/leads/${id}/quotes`, {}); if (r) navigate(`/quotes/${r.id}`); };
  const won = quotes.find((q: Row) => q.status === "accepted");

  return (
    <div class="c-page">
      <header class="c-head">
        <button class="c-btn c-ghost" onClick={() => history.back()}>← Back</button>
        <span class={`c-stage s-${lead.stage}`}>{STAGE_LABEL[lead.stage]}</span>
      </header>
      <h1 class="c-name">{lead.name}</h1>
      <p class="c-mut">{[lead.service, lead.size_hint, lead.timing].filter(Boolean).join(" · ")}</p>
      <div class="c-actions c-main-actions">
        {lead.phone && <a class="c-btn c-go c-big" href={telHref(lead.phone)}>Call {phonePretty(lead.phone)}</a>}
        {lead.phone && <a class="c-btn c-big" href={smsHref(lead.phone, hi)}>Text</a>}
        {lead.email && <a class="c-btn c-big" href={mailHref(lead.email, `Your ${lead.service || "project"} · Solid Landscaping`, hi)}>Email</a>}
      </div>
      {lead.phone && !consent.sms && <p class="c-warn-box">No active text consent on file (CASL). Call or email instead, or record their OK below.</p>}

      <section class="c-card">
        <h2>Next step</h2>
        <div class="c-actions">
          <button class="c-btn c-go" onClick={newQuote}>{quotes.length ? "New quote version" : "Write quote"}</button>
          {lead.stage === "new" && <button class="c-btn" onClick={() => stage("contacted")}>Talked to them</button>}
          {lead.stage !== "won" && <button class="c-btn" onClick={() => stage("won")}>Won</button>}
          {!OPEN.includes(lead.stage) && <button class="c-btn c-ghost" onClick={() => stage("contacted")}>Re-open</button>}
        </div>
        {OPEN.includes(lead.stage) && <div class="c-mini"><span>Site visit</span>
          <input type="datetime-local" aria-label="Visit date and time" value={visitAt} onInput={(e) => setVisitAt((e.target as HTMLInputElement).value)} />
          <button class="c-btn" disabled={!visitAt} onClick={async () => { if (await act("POST", `/api/crm/leads/${id}/visit`, { at: new Date(visitAt).toISOString() })) { setVisitAt(""); reload(); } }}>Book</button></div>}
        {lead.stage !== "lost" && <div class="c-mini"><span>Lost</span>
          <select aria-label="Lost reason" value={lost} onChange={(e) => setLost((e.target as HTMLSelectElement).value)}><option value="">Why?</option>{lost_reasons.map((r: string) => <option>{r}</option>)}</select>
          <button class="c-btn" disabled={!lost} onClick={() => stage("lost", { reason: lost })}>Mark lost</button></div>}
        {OPEN.includes(lead.stage) && <div class="c-mini"><span>Check back on</span>
          <input type="date" aria-label="Check back on" value={later} onInput={(e) => setLater((e.target as HTMLInputElement).value)} />
          <button class="c-btn" disabled={!later} onClick={() => stage("later", { later_until: later })}>Later</button></div>}
      </section>

      {pending.length > 0 && <section><h2>Follow-up ({pending.length} left)</h2>
        {pending.map((t: Row) => (
          <article class="c-card" key={t.id}>
            <div class="c-row"><strong>{t.title}</strong><span class={`c-timer ${Date.parse(t.due_at) < Date.now() ? "c-late" : ""}`}>{when(t.due_at)}</span></div>
            <TouchActions t={{ ...t, quote_token: token }} lead={lead} templates={templates} settings={settings} onDone={reload} />
          </article>
        ))}
      </section>}

      <section class="c-card">
        <h2>Quotes</h2>
        {!quotes.length && <p class="c-mut">No quote yet.</p>}
        {quotes.map((q: Row) => (
          <div class="c-row c-click" key={q.id} onClick={() => navigate(`/quotes/${q.id}`)}>
            <span>v{q.version} · <span class={`c-pill q-${q.status}`}>{q.status}</span>{q.cooling_off_ends && !q.waiver_text ? <span class="c-small c-mut"> · cooling-off to {q.cooling_off_ends}</span> : null}</span>
            <b>{money(q.total_cents)}</b>
          </div>
        ))}
      </section>

      <section class="c-card">
        <h2>Job</h2>
        {job ? <div class="c-row c-click" onClick={() => navigate(`/jobs/${job.id}`)}><span>{job.identifier} · {job.status}</span><span>{job.scheduled_date}</span></div>
          : <div class="c-actions">
            <input type="date" aria-label="Start date" value={jobDate} onInput={(e) => setJobDate((e.target as HTMLInputElement).value)} />
            <button class="c-btn" disabled={!jobDate} onClick={async () => { const r = await act("POST", `/api/crm/leads/${id}/job`, { scheduled_date: jobDate }); if (r) navigate(`/jobs/${r.job_id}`); }}>Schedule job</button>
            {won?.cooling_off_ends && <span class="c-small c-mut">Earliest start {won.waiver_text ? "any time (waiver on file)" : "the day after " + won.cooling_off_ends}</span>}
          </div>}
      </section>

      <section class="c-card">
        <div class="c-row"><h2>Details</h2><button class="c-btn c-ghost" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Edit"}</button></div>
        {edit ? <EditLead lead={lead} onSaved={() => { setEdit(false); reload(); }} /> : <dl class="c-dl">
          <dt>Phone</dt><dd>{lead.phone ? phonePretty(lead.phone) : "—"}</dd>
          <dt>Email</dt><dd>{lead.email || "—"}</dd>
          <dt>Address</dt><dd>{[lead.line1, lead.city, lead.postal].filter(Boolean).join(", ") || "—"}{lead.area ? ` (${lead.area})` : ""}</dd>
          <dt>Source</dt><dd>{[lead.source, lead.source_detail, lead.campaign_name].filter(Boolean).join(" · ")}{lead.page ? ` · ${lead.page}` : ""}</dd>
          <dt>Arrived</dt><dd>{when(lead.created_at)}</dd>
          {lead.details && <><dt>Their words</dt><dd class="c-pre">{lead.details}</dd></>}
          {lead.notes && <><dt>Notes</dt><dd class="c-pre">{lead.notes}</dd></>}
        </dl>}
      </section>

      <Photos leadId={id} />

      <section class="c-card">
        <h2>Notes & history</h2>
        <div class="c-actions"><textarea rows={2} placeholder="Add a note (what they said, gate code, budget…)" value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          <button class="c-btn" disabled={!note.trim()} onClick={async () => { if (await act("POST", `/api/crm/leads/${id}/note`, { text: note })) { setNote(""); reload(); } }}>Add</button></div>
        <ul class="c-timeline">
          {events.map((e: Row) => { const m = JSON.parse(e.meta || "{}"); return (
            <li key={e.id}><span class="c-mut c-small">{when(e.ts)}</span> {e.type === "note" ? m.text : e.type === "stage_changed" ? `→ ${STAGE_LABEL[m.to] ?? m.to}${m.reason ? ` (${m.reason})` : ""}` : e.type === "touch_done" ? `${m.kind} ${m.outcome || m.text || ""}` : e.type.replace(/_/g, " ")}{e.value_cents ? ` · ${money(e.value_cents)}` : ""}</li>
          ); })}
          {past.filter((t: Row) => t.skipped_at && !t.done_at).length > 0 && <li class="c-mut c-small">{past.filter((t: Row) => t.skipped_at && !t.done_at).length} touches skipped/paused</li>}
        </ul>
      </section>

      {emails.length > 0 && <section class="c-card"><h2>Emails from {lead.email}</h2>
        {emails.map((e: Row) => <div key={e.id} class="c-row"><a href={`https://mail.google.com/mail/u/0/#all/${e.id}`} target="_blank" rel="noopener">{e.subject || "(no subject)"}</a><span class="c-mut c-small">{day(e.received_at)}</span></div>)}
      </section>}

      <section class="c-card">
        <h2>Privacy</h2>
        <p class="c-small c-mut">Texts: {consent.sms ? "OK" : "no consent"} · Email: {consent.email ? "OK" : "no consent"} ({consent.records.length} record{consent.records.length === 1 ? "" : "s"})</p>
        <div class="c-actions">
          {!consent.sms && <button class="c-btn" onClick={async () => { const t = prompt("What did they agree to? e.g. 'Said OK to texts on the phone, Nov 4'"); if (t && await act("POST", `/api/crm/customers/${lead.customer_id}/consent`, { channel: "sms", action: "express", text: t })) reload(); }}>Record text OK</button>}
          {consent.sms && <button class="c-btn" onClick={async () => { if (confirm("They asked to stop texts (STOP)?") && await act("POST", `/api/crm/customers/${lead.customer_id}/consent`, { channel: "sms", action: "withdraw" })) reload(); }}>They said STOP</button>}
          <button class="c-btn c-ghost" onClick={async () => { if (confirm("Hide this lead? (soft delete; numbers keep it)") && await act("DELETE", `/api/crm/leads/${id}`)) navigate("/leads"); }}>Delete lead</button>
          <button class="c-btn c-ghost c-danger" onClick={async () => { if (prompt("Type DELETE to erase this person's details (privacy request). This can't be undone.") === "DELETE" && await act("POST", `/api/crm/customers/${lead.customer_id}/purge`)) navigate("/leads"); }}>Erase personal data</button>
        </div>
      </section>
    </div>
  );
}

function EditLead({ lead, onSaved }: { lead: Row; onSaved: () => void }) {
  const [f, setF] = useState<Row>({ name: lead.name, phone: lead.phone, email: lead.email, service: lead.service, size_hint: lead.size_hint, timing: lead.timing, source: lead.source, source_detail: lead.source_detail, line1: lead.line1 ?? "", city: lead.city ?? "", postal: lead.postal ?? "", area: lead.area ?? "", notes: lead.notes ?? "" });
  const set = (k: string) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  return (
    <form class="c-form" onSubmit={async (e) => { e.preventDefault(); if (await act("PATCH", `/api/crm/leads/${lead.id}`, f)) onSaved(); }}>
      {[["name", "Name"], ["phone", "Phone"], ["email", "Email"], ["size_hint", "Size"], ["timing", "Timing"], ["source_detail", "Source detail"], ["line1", "Street address"], ["city", "City"], ["postal", "Postal code"], ["area", "Neighbourhood"]].map(([k, l]) => (
        <label key={k}>{l}<input value={f[k]} onInput={set(k)} /></label>
      ))}
      <label>Service<select value={f.service} onChange={set("service")}><option value="">—</option>{SERVICES.map((s) => <option>{s}</option>)}</select></label>
      <label>Source<select value={f.source} onChange={set("source")}>{SOURCES.map((s) => <option>{s}</option>)}</select></label>
      <label>Notes<textarea rows={3} value={f.notes} onInput={set("notes")} /></label>
      <button class="c-btn c-go" type="submit">Save</button>
    </form>
  );
}
