import { useState } from "preact/hooks";
import { buzz, burst, lastTap, useNow, Sprout } from "./fx";
import { useApp } from "../context";
import { useGet, act, ago, when, fill, telHref, smsHref, mailHref, phonePretty, type Row } from "./lib";

/** Call · Text · Done for one touch. Tapping Call/Text logs the touch at once (one tap); "Answered?" then records the outcome. */
export function TouchActions({ t, lead, templates, settings, onDone }: { t: Row; lead: Row; templates: Row[]; settings: Row; onDone: () => void }) {
  const [ask, setAsk] = useState(false);
  const tpl = (key: string) => templates.find((x) => x.id === key)?.body ?? "";
  const text = fill(tpl(t.template_key || (t.kind === "call" ? "miss" : "hi")), lead, settings, { quote_token: t.quote_token ?? lead.quote_token });
  const done = async (outcome: string) => { buzz(); if (await act("POST", `/api/crm/touches/${t.touch_id ?? t.id}/done`, { outcome })) onDone(); };
  const id = t.touch_id ?? t.id;
  if (ask) return (
    <div class="c-actions"><span class="c-ask">Answered?</span>
      <button class="c-btn" onClick={() => done("answered")}>Yes</button>
      <button class="c-btn" onClick={() => done("no answer")}>No</button>
      {lead.phone && <a class="c-btn" href={smsHref(lead.phone, text)} onClick={() => done("no answer")}>No → text</a>}
    </div>
  );
  return (
    <div class="c-actions">
      {lead.phone && (t.kind === "call" || t.kind === "visit") && <a class="c-btn c-go" href={telHref(lead.phone)} onClick={() => { void act("POST", `/api/crm/touches/${id}/done`, { outcome: "" }); setAsk(true); }}>Call</a>}
      {lead.phone && t.kind !== "email" && <a class={`c-btn ${t.kind === "sms" || t.kind === "video" ? "c-go" : ""}`} href={smsHref(lead.phone, text)} onClick={() => done("sent")}>Text</a>}
      {lead.email && (t.kind === "email" || !lead.phone) && <a class="c-btn c-go" href={mailHref(lead.email, `Your ${lead.service || "project"} · Solid Landscaping`, text)} onClick={() => done("sent")}>Email</a>}
      <button class="c-btn" aria-label="Mark done" onClick={() => done("done")}>Done</button>
      <button class="c-btn c-ghost" aria-label="Skip this touch" onClick={async () => { if (await act("POST", `/api/crm/touches/${id}/skip`)) onDone(); }}>Skip</button>
    </div>
  );
}

const hello = (now: number) => {
  const h = +new Date(now).toLocaleString("en-CA", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" });
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** 60-minute speed-to-lead window as a draining line + live words. */
function LeadClock({ created, now }: { created: string; now: number }) {
  const mins = Math.floor((now - Date.parse(created)) / 60000);
  const left = 60 - mins;
  const tone = left <= 0 ? "late" : left <= 20 ? "warn" : "ok";
  return (
    <div class={`fx-clock ${tone}`}>
      <span class="fx-clock-t">{left > 0 ? `${left} min left to call` : `${-left < 60 ? -left + " min" : Math.round(-left / 60) + " h"} late`}</span>
      <span class="fx-clock-bar"><i style={{ transform: `scaleX(${Math.max(0, left) / 60})` }} /></span>
    </div>
  );
}

export function Today() {
  const { navigate } = useApp();
  const { data, error, reload } = useGet<Row>("/api/crm/today");
  const now = useNow(20_000);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [cleared, setCleared] = useState(false);
  if (error) return <div class="c-page"><p class="c-err">{error}</p></div>;
  if (!data) return <div class="c-page"><p class="c-mut">Loading…</p></div>;
  const { fresh, due, emails, jobs, templates, settings, done_today } = data;
  const open = fresh.length + due.length;
  const total = open + done_today;
  // Sweep the card away, then refresh; clearing the last one is the day's milestone.
  const finish = (key: string) => () => {
    const x = lastTap.x, y = lastTap.y;
    setLeaving((s) => new Set(s).add(key));
    setTimeout(async () => {
      await reload();
      setLeaving((s) => { const n = new Set(s); n.delete(key); return n; });
      if (open - 1 === 0) { setCleared(true); burst(x, y, 18); buzz([14, 50, 22]); }
    }, 360);
  };
  const empty = !fresh.length && !due.length && !emails.length && !jobs.length;
  return (
    <div class="c-page">
      <header class="c-head fx-hello">
        <div><h1>{hello(now)}, <b>{settings.owner_name}</b></h1>
          <p class="c-mut">{new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric" })}</p></div>
        <button class="c-btn c-go" onClick={() => navigate("/leads/new")}>+ Lead</button>
      </header>
      {total > 0 && <div class="fx-day" aria-label={`${done_today} of ${total} done today`}>
        <span class="fx-day-bar"><i style={{ transform: `scaleX(${done_today / total})` }} /></span>
        <span class="fx-day-t"><b>{done_today}</b> of {total} done today</span>
      </div>}
      <div class="c-kpis">
        <div class={`c-kpi ${fresh.length ? "c-red" : ""}`}><b>{fresh.length}</b><span>to call now</span></div>
        <div class={`c-kpi ${due.some((t: Row) => Date.parse(t.due_at) < now) ? "c-red" : ""}`}><b>{due.length}</b><span>follow-ups</span></div>
        <div class="c-kpi"><b>{jobs.length}</b><span>jobs</span></div>
      </div>
      {(empty || (cleared && !open)) && <div class="fx-empty"><Sprout /><p><b>{cleared ? "All done for today." : "All caught up."}</b><br /><span class="c-mut">New leads land here the second they arrive.</span></p></div>}

      {fresh.length > 0 && <section><h2>New leads, not contacted</h2>
        {fresh.map((l: Row) => (
          <article class={`c-card fx-card ${leaving.has(l.id) ? "fx-out" : ""}`} key={l.id}>
            <div class="c-row" onClick={() => navigate(`/leads/${l.id}`)}>
              <div><strong>{l.name}</strong><div class="c-mut">{[l.service, l.size_hint, l.area || l.city, l.source].filter(Boolean).join(" · ")}</div></div>
            </div>
            <LeadClock created={l.created_at} now={now} />
            {l.touch_id && <TouchActions t={{ id: l.touch_id, kind: "call", template_key: "hi" }} lead={l} templates={templates} settings={settings} onDone={finish(l.id)} />}
          </article>
        ))}
      </section>}

      {due.length > 0 && <section><h2>Follow-ups due</h2>
        {due.map((t: Row) => (
          <article class={`c-card fx-card ${leaving.has(t.touch_id) ? "fx-out" : ""}`} key={t.touch_id}>
            <div class="c-row" onClick={() => navigate(`/leads/${t.id}`)}>
              <div><strong>{t.title}</strong><div class="c-mut">{t.name}{t.phone ? " · " + phonePretty(t.phone) : ""}{t.service ? " · " + t.service : ""}</div></div>
              <span class={`c-timer ${Date.parse(t.due_at) < now ? "c-late" : ""}`}>{Date.parse(t.due_at) < now ? ago(t.due_at) + " late" : when(t.due_at).split(", ").pop()}</span>
            </div>
            <TouchActions t={t} lead={t} templates={templates} settings={settings} onDone={finish(t.touch_id)} />
          </article>
        ))}
      </section>}

      {emails.length > 0 && <section><h2>Possible lead emails</h2>
        {emails.map((e: Row) => <EmailCard key={e.id} e={e} onDone={reload} />)}
      </section>}

      {jobs.length > 0 && <section><h2>Jobs today</h2>
        {jobs.map((j: Row) => (
          <article class="c-card c-row" key={j.id} onClick={() => navigate(`/jobs/${j.id}`)}>
            <div><strong>{j.scheduled_time || "Today"} · {j.name}</strong><div class="c-mut">{j.address}</div></div>
            <span class="c-pill">{j.identifier}</span>
          </article>
        ))}
      </section>}
    </div>
  );
}

export function EmailCard({ e, onDone }: { e: Row; onDone: () => void }) {
  const { navigate } = useApp();
  return (
    <article class="c-card">
      <div class="c-row"><div><strong>{e.from_name || e.from_addr}</strong><div class="c-mut">{e.subject}</div></div><span class="c-timer">{ago(e.received_at)}</span></div>
      <p class="c-snip">{e.snippet.slice(0, 220)}</p>
      {e.reasons && <p class="c-mut c-small">Why: {e.reasons}</p>}
      <div class="c-actions">
        {e.lead_id ? <button class="c-btn" onClick={() => navigate(`/leads/${e.lead_id}`)}>Open lead</button>
          : <button class="c-btn c-go" onClick={async () => { const r = await act("POST", `/api/crm/emails/${e.id}/convert`, {}); if (r) navigate(`/leads/${r.lead_id}`); }}>Make lead</button>}
        {e.category !== "other" && !e.lead_id && <button class="c-btn" onClick={async () => { if (await act("PATCH", `/api/crm/emails/${e.id}`, { category: "other" })) onDone(); }}>Not a lead</button>}
        {e.category !== "spam" && !e.lead_id && <button class="c-btn c-ghost" onClick={async () => { if (await act("PATCH", `/api/crm/emails/${e.id}`, { category: "spam" })) onDone(); }}>Spam</button>}
        <a class="c-btn c-ghost" href={`https://mail.google.com/mail/u/0/#all/${e.id}`} target="_blank" rel="noopener">Gmail ↗</a>
      </div>
    </article>
  );
}
