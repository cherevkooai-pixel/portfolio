import { useEffect, useState } from "preact/hooks";
import { useApp } from "../context";
import { useGet, act, money, dollarsToCents, centsToInput, fill, smsHref, mailHref, publicOrigin, type Row } from "./lib";
import { quoteTotals } from "../../server/rules.ts";
import { celebrateWin } from "./fx";

type L = { item: string; qty: number; unit: string; unit_cents: number; cost_cents: number };

export function QuoteEditor({ id }: { id: string }) {
  const { navigate } = useApp();
  const { data, error, reload } = useGet<Row>(`/api/crm/quotes/${id}`);
  const [lines, setLines] = useState<L[]>([]);
  const [notes, setNotes] = useState("");
  const [home, setHome] = useState(false);
  const [svc, setSvc] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!data) return;
    setLines(data.lines.map((l: Row) => ({ item: l.item, qty: l.qty, unit: l.unit, unit_cents: l.unit_cents, cost_cents: l.cost_cents })));
    setNotes(data.quote.notes); setHome(!!data.quote.signed_at_home); setSvc(data.lead?.service ?? ""); setDirty(false);
  }, [data]);
  if (error) return <div class="c-page"><p class="c-err">{error}</p></div>;
  if (!data) return <div class="c-page"><p class="c-mut">Loading…</p></div>;
  const { quote, lead, versions, price_book, settings } = data;
  const draft = quote.status === "draft";
  const t = quoteTotals(lines);
  const target = settings.target_margin_pct;
  const upd = (i: number, k: keyof L, v: string) => { const n = [...lines]; (n[i] as any)[k] = k === "item" || k === "unit" ? v : k === "qty" ? parseFloat(v) || 0 : dollarsToCents(v); setLines(n); setDirty(true); };
  const save = () => act("PUT", `/api/crm/quotes/${id}`, { notes, signed_at_home: home, lines: lines.filter((l) => l.item.trim()) });
  const link = quote.accept_token ? `${publicOrigin()}/api/quote/${quote.accept_token}` : "";
  const msg = fill("Hi {first}, here's your written quote from Solid Landscaping: {quote_link}. Happy to walk you through it. {me}", lead, settings, { quote_token: quote.accept_token });
  const services = [...new Set(price_book.map((p: Row) => p.service))] as string[];

  return (
    <div class="c-page">
      <header class="c-head"><button class="c-btn c-ghost" onClick={() => navigate(`/leads/${quote.lead_id}`)}>← {lead?.name}</button><span class={`c-pill q-${quote.status}`}>v{quote.version} · {quote.status}</span></header>
      <h1>Quote <span class="c-mut">{lead?.service}</span></h1>
      {versions.length > 1 && <div class="c-chips">{versions.map((v: Row) => <button class={`c-chip ${v.id === id ? "on" : ""}`} onClick={() => navigate(`/quotes/${v.id}`)}>v{v.version} {money(v.total_cents)}</button>)}</div>}

      <section class="c-card">
        {lines.map((l, i) => (
          <div class="c-line" key={i}>
            <input class="c-l-item" aria-label="Item" disabled={!draft} value={l.item} onInput={(e) => upd(i, "item", (e.target as HTMLInputElement).value)} />
            <label>Qty<input inputMode="decimal" disabled={!draft} value={String(l.qty)} onChange={(e) => upd(i, "qty", (e.target as HTMLInputElement).value)} /></label>
            <label>Unit<input disabled={!draft} value={l.unit} onInput={(e) => upd(i, "unit", (e.target as HTMLInputElement).value)} /></label>
            <label>Price/unit $<input inputMode="decimal" disabled={!draft} value={centsToInput(l.unit_cents)} onChange={(e) => upd(i, "unit_cents", (e.target as HTMLInputElement).value)} /></label>
            <label class="c-internal">Cost/unit $<input inputMode="decimal" disabled={!draft} value={centsToInput(l.cost_cents)} onChange={(e) => upd(i, "cost_cents", (e.target as HTMLInputElement).value)} /></label>
            <b class="c-l-total">{money(Math.round(l.qty * l.unit_cents), true)}</b>
            {draft && <button class="c-x" aria-label="Remove line" onClick={() => { setLines(lines.filter((_, j) => j !== i)); setDirty(true); }}>×</button>}
          </div>
        ))}
        {draft && <div class="c-addline">
          <select aria-label="Service" value={svc} onChange={(e) => setSvc((e.target as HTMLSelectElement).value)}>{services.map((s) => <option>{s}</option>)}</select>
          <div class="c-chips">
            {price_book.filter((p: Row) => p.service === svc).map((p: Row) => (
              <button class="c-chip" title={`Typical GTA range ${money(p.low_cents)}–${money(p.high_cents)} per ${p.unit}`} onClick={() => { setLines([...lines, { item: p.item, qty: 1, unit: p.unit, unit_cents: p.default_cents, cost_cents: p.cost_cents }]); setDirty(true); }}>
                + {p.item} <span class="c-mut">{money(p.low_cents)}–{money(p.high_cents)}/{p.unit}</span>
              </button>
            ))}
            <button class="c-chip" onClick={() => { setLines([...lines, { item: "", qty: 1, unit: "", unit_cents: 0, cost_cents: 0 }]); setDirty(true); }}>+ Custom line</button>
          </div>
        </div>}
        <dl class="c-totals">
          <dt>Subtotal</dt><dd>{money(t.subtotal_cents, true)}</dd>
          <dt>HST 13%</dt><dd>{money(t.tax_cents, true)}</dd>
          <dt><b>Total</b></dt><dd><b>{money(t.total_cents, true)}</b></dd>
          <dt class="c-internal">Margin (only you see this)</dt><dd class={t.margin_pct < target ? "c-late" : "c-ok"}>{t.cost_cents ? `${t.margin_pct}% · target ${target}%` : "add costs to see it"}</dd>
        </dl>
        <label class="c-block">Notes for the customer<textarea rows={3} disabled={!draft} value={notes} onInput={(e) => { setNotes((e.target as HTMLTextAreaElement).value); setDirty(true); }} /></label>
        <label class="c-check"><input type="checkbox" disabled={!draft} checked={home} onChange={(e) => { setHome((e.target as HTMLInputElement).checked); setDirty(true); }} /> Will be signed at the customer's home (10-day cooling-off applies)</label>
      </section>

      {draft && <div class="c-actions c-sticky">
        <button class="c-btn" disabled={!dirty} onClick={async () => { if (await save()) reload(); }}>Save draft</button>
        <button class="c-btn c-go c-big" disabled={!lines.length} onClick={async () => { if ((!dirty || await save()) && await act("POST", `/api/crm/quotes/${id}/send`, {})) reload(); }}>Send to customer</button>
      </div>}

      {quote.status === "sent" && <section class="c-card">
        <h2>Sent. Share the link</h2>
        <p class="c-small c-break"><a href={link} target="_blank" rel="noopener">{link}</a></p>
        <div class="c-actions">
          {lead?.phone && <a class="c-btn c-go" href={smsHref(lead.phone, msg)}>Text it</a>}
          {lead?.email && <a class="c-btn" href={mailHref(lead.email, "Your quote from Solid Landscaping", msg)}>Email it</a>}
          <button class="c-btn" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
        </div>
        <AcceptOnPaper id={id} home={!!quote.signed_at_home} onDone={() => { celebrateWin(quote.subtotal_cents, lead?.name ?? ""); reload(); }} />
      </section>}

      {quote.status === "accepted" && <section class="c-card">
        <h2>Accepted ✓</h2>
        <p>By {quote.accepted_name} on {new Date(quote.accepted_at).toLocaleString("en-CA", { timeZone: "America/Toronto" })}.</p>
        {quote.cooling_off_ends && (quote.waiver_text
          ? <p class="c-small">Cooling-off waived: “{quote.waiver_text}”</p>
          : <Waiver id={id} ends={quote.cooling_off_ends} onDone={reload} />)}
        {lead?.job_id ? <button class="c-btn" onClick={() => navigate(`/jobs/${lead.job_id}`)}>Open job</button> : <button class="c-btn c-go" onClick={() => navigate(`/leads/${quote.lead_id}`)}>Schedule the job</button>}
      </section>}

      {!draft && <button class="c-btn" onClick={async () => { const r = await act("POST", `/api/crm/leads/${quote.lead_id}/quotes`, {}); if (r) navigate(`/quotes/${r.id}`); }}>
        {quote.status === "accepted" ? "Change order (new version for the customer to accept)" : "Edit as a new version"}
      </button>}
    </div>
  );
}

function AcceptOnPaper({ id, home, onDone }: { id: string; home: boolean; onDone: () => void }) {
  const [name, setName] = useState("");
  const [atHome, setAtHome] = useState(home);
  return (
    <details class="c-block"><summary>They signed on paper / in person</summary>
      <div class="c-form">
        <label>Customer's name as signed<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label class="c-check"><input type="checkbox" checked={atHome} onChange={(e) => setAtHome((e.target as HTMLInputElement).checked)} /> Signed at their home</label>
        <button class="c-btn c-go" disabled={name.trim().length < 2} onClick={async () => { if (await act("POST", `/api/crm/quotes/${id}/accept`, { name, signed_at_home: atHome })) onDone(); }}>Record acceptance</button>
      </div>
    </details>
  );
}

function Waiver({ id, ends, onDone }: { id: string; ends: string; onDone: () => void }) {
  const [text, setText] = useState("");
  return (
    <div class="c-warn-box">
      <p>Signed at home: the customer can cancel until the end of <b>{ends}</b>. Work can't start before then.</p>
      <details><summary>The customer asked in writing to start sooner</summary>
        <textarea rows={2} placeholder="What they signed, and when" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <button class="c-btn" disabled={text.trim().length < 10} onClick={async () => { if (await act("POST", `/api/crm/quotes/${id}/waiver`, { text })) onDone(); }}>Save waiver</button>
      </details>
    </div>
  );
}
