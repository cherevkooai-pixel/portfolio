import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";
import { useApp } from "../context";
import { useGet, act, money, ago, dollarsToCents, centsToInput, street, type Row } from "./lib";

export function More() {
  const { navigate } = useApp();
  const links: [string, string, string][] = [
    ["/campaigns", "Campaigns & QR", "Postcards, door hangers, signs: codes, print sheets, ROI"],
    ["/warm", "Warm addresses", "Scanned the QR but didn't fill the form"],
    ["/pricebook", "Price book", "Typical GTA ranges + your real costs"],
    ["/templates", "Text & email templates", "The 9-touch follow-up wording"],
    ["/settings", "Settings", "Labour rate, target margin, review link"],
    ["/schedule", "Calendar", "Week view of jobs"],
    ["/jobs", "All jobs", ""], ["/customers", "Customers", ""], ["/invoices", "Invoices", ""], ["/materials", "Materials", ""], ["/technicians", "Crew", ""], ["/services", "Service types", ""],
  ];
  return (
    <div class="c-page">
      <header class="c-head"><h1>More</h1></header>
      <nav class="c-list">{links.map(([to, l, d]) => <button class="c-card c-row c-click" onClick={() => navigate(to)}><span><b>{l}</b>{d && <span class="c-mut c-small c-blockline">{d}</span>}</span><span aria-hidden="true">›</span></button>)}</nav>
      <section class="c-card"><h2>Export (CSV)</h2>
        <div class="c-actions">{["leads", "customers", "touches", "events"].map((w) => <a class="c-btn" href={`/api/crm/export/${w}.csv`}>{w}</a>)}</div>
      </section>
    </div>
  );
}

// ── Campaigns & QR ─────────────────────────────────────────────────
const CHANNELS = ["postcard", "door hanger", "flyer", "lawn sign", "truck", "invoice", "web", "gbp", "fb", "referral", "other"];
const blank = { name: "", channel: "postcard", area: "", offer: "", start_date: "", end_date: "", pieces: 0, cost: "0" };

function CampaignForm({ init, onSave }: { init: Row; onSave: (d: Row) => void }) {
  const [f, setF] = useState<Row>(init);
  const set = (k: string) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  return (
    <form class="c-form" onSubmit={(e) => { e.preventDefault(); onSave({ name: f.name, channel: f.channel, area: f.area, offer: f.offer, start_date: f.start_date, end_date: f.end_date, pieces: parseInt(f.pieces) || 0, cost_cents: dollarsToCents(String(f.cost)) }); }}>
      <label>Name<input required value={f.name} onInput={set("name")} placeholder="Lorne Park postcards, spring" /></label>
      <label>Type<select value={f.channel} onChange={set("channel")}>{CHANNELS.map((c) => <option>{c}</option>)}</select></label>
      <label>Area<input value={f.area} onInput={set("area")} placeholder="Lorne Park" /></label>
      <label>Offer shown on the QR page<input value={f.offer} onInput={set("offer")} placeholder="We're working on your street this spring…" /></label>
      <div class="c-grid3"><label>Start<input type="date" value={f.start_date} onInput={set("start_date")} /></label><label>Pieces<input inputMode="numeric" value={f.pieces} onInput={set("pieces")} /></label><label>Total cost $<input inputMode="decimal" value={f.cost} onInput={set("cost")} /></label></div>
      <button class="c-btn c-go" type="submit">Save campaign</button>
    </form>
  );
}

export function Campaigns() {
  const { navigate } = useApp();
  const { data, reload } = useGet<Row>("/api/crm/campaigns");
  const [adding, setAdding] = useState(false);
  return (
    <div class="c-page">
      <header class="c-head"><h1>Campaigns & QR</h1><button class="c-btn c-go" onClick={() => setAdding(!adding)}>{adding ? "Close" : "+ Campaign"}</button></header>
      {adding && <section class="c-card"><CampaignForm init={blank} onSave={async (d) => { const r = await act("POST", "/api/crm/campaigns", d); if (r) { setAdding(false); navigate(`/campaigns/${r.id}`); } }} /></section>}
      {data?.campaigns.map((c: Row) => (
        <article class="c-card c-click" onClick={() => navigate(`/campaigns/${c.id}`)}>
          <div class="c-row"><b>{c.name}</b><span class="c-pill">{c.channel}</span></div>
          <p class="c-small c-mut">{c.area} · {c.pieces} pcs · {money(c.cost_cents)} · {c.codes} codes · {c.scans} scans · {c.leads} leads · {c.won} won</p>
        </article>
      ))}
      {data && !data.campaigns.length && !adding && <p class="c-empty">No campaigns yet. Make one, paste the addresses, print the codes.</p>}
    </div>
  );
}

export function CampaignDetail({ id }: { id: string }) {
  const { navigate } = useApp();
  const { data, reload } = useGet<Row>(`/api/crm/campaigns/${id}/codes`);
  const [addr, setAddr] = useState("");
  const [count, setCount] = useState("0");
  const [edit, setEdit] = useState(false);
  if (!data) return <div class="c-page"><p class="c-mut">Loading…</p></div>;
  const { campaign, codes } = data;
  const scanned = codes.filter((c: Row) => c.scans > 0).length;
  return (
    <div class="c-page">
      <header class="c-head"><button class="c-btn c-ghost" onClick={() => navigate("/campaigns")}>← Campaigns</button><button class="c-btn c-ghost" onClick={() => setEdit(!edit)}>{edit ? "Close" : "Edit"}</button></header>
      <h1>{campaign.name}</h1>
      <p class="c-mut">{campaign.channel} · {campaign.area} · {campaign.pieces} pcs · {money(campaign.cost_cents)} · {codes.length} codes · {scanned} scanned</p>
      {edit && <section class="c-card"><CampaignForm init={{ ...campaign, cost: centsToInput(campaign.cost_cents) }} onSave={async (d) => { if (await act("PUT", `/api/crm/campaigns/${id}`, d)) { setEdit(false); reload(); } }} /></section>}
      <section class="c-card">
        <h2>Make codes</h2>
        <label class="c-block">One address per line (street, city, postal). Each gets its own code; the page greets them by street name only.
          <textarea rows={5} value={addr} placeholder={"1234 Lorne Park Rd, Mississauga, L5H 2Z9\n77 Indian Rd, Mississauga, L5H 1R5"} onInput={(e) => setAddr((e.target as HTMLTextAreaElement).value)} /></label>
        <label>…or this many campaign-only codes (signs, truck, invoices)<input inputMode="numeric" value={count} onInput={(e) => setCount((e.target as HTMLInputElement).value)} /></label>
        <button class="c-btn c-go" disabled={!addr.trim() && !(parseInt(count) > 0)} onClick={async () => { const r = await act("POST", `/api/crm/campaigns/${id}/codes`, { addresses: addr, count: parseInt(count) || 0 }); if (r) { setAddr(""); setCount("0"); reload(); } }}>Generate</button>
      </section>
      {codes.length > 0 && <div class="c-actions">
        <button class="c-btn c-go" onClick={() => navigate(`/campaigns/${id}/print`)}>Print sheet (PDF)</button>
        <a class="c-btn" href={`/api/crm/campaigns/${id}/codes?format=csv`}>CSV for mail merge</a>
      </div>}
      <section class="c-card">
        {codes.map((c: Row) => (
          <div class="c-row" key={c.code}>
            <span><code>{c.code}</code> {c.line1 ?? <span class="c-mut">campaign-only</span>}</span>
            <span class="c-small">{c.lead_id ? <a href={`/leads/${c.lead_id}`} onClick={(e) => { e.preventDefault(); navigate(`/leads/${c.lead_id}`); }}>lead ✓</a> : c.scans ? <span class="c-warn">{c.scans} scan{c.scans > 1 ? "s" : ""}</span> : <span class="c-mut">—</span>}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

export function PrintSheet({ id }: { id: string }) {
  const { data } = useGet<Row>(`/api/crm/campaigns/${id}/codes`);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    Promise.all(data.codes.map(async (c: Row) => [c.code, await QRCode.toString(c.url, { type: "svg", margin: 1, errorCorrectionLevel: "M" })])).then((e) => setSvgs(Object.fromEntries(e)));
  }, [data]);
  if (!data) return <p class="c-mut">Loading…</p>;
  return (
    <div class="c-print">
      <div class="c-actions c-noprint"><button class="c-btn" onClick={() => history.back()}>← Back</button><button class="c-btn c-go" onClick={() => print()}>Print / Save as PDF</button><span class="c-small c-mut">Tip: 3 × 4 labels per page; scan one before printing them all.</span></div>
      <div class="c-labels">
        {data.codes.map((c: Row) => (
          <div class="c-label" key={c.code}>
            <div class="c-qr" dangerouslySetInnerHTML={{ __html: svgs[c.code] ?? "" }} />
            <div><b>{c.line1 ? `Hi neighbour on ${street(c.line1)}!` : "Free yard estimate"}</b><span>Scan for your price range</span><code>{c.url.replace(/^https?:\/\//, "")}</code>{c.line1 && <small>{c.line1}</small>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Warm() {
  const { data } = useGet<Row>("/api/crm/warm");
  return (
    <div class="c-page">
      <header class="c-head"><h1>Warm addresses</h1></header>
      <p class="c-mut">Scanned the code but didn't ask for a price. Good for a 2nd mailing or a friendly door knock.</p>
      {data?.warm.map((w: Row) => <div class="c-card c-row"><span><b>{w.line1}</b><span class="c-mut c-small c-blockline">{w.campaign} · {w.scans} scan{w.scans > 1 ? "s" : ""}</span></span><span class="c-mut c-small">{ago(w.last_scan_at)}</span></div>)}
      {data && !data.warm.length && <p class="c-empty">None yet.</p>}
    </div>
  );
}

// ── Price book ─────────────────────────────────────────────────────
export function PriceBook() {
  const { data, reload } = useGet<Row>("/api/crm/price-book");
  const [f, setF] = useState<Row | null>(null);
  const save = async () => {
    const d = { service: f!.service, item: f!.item, unit: f!.unit, low_cents: dollarsToCents(f!.low), high_cents: dollarsToCents(f!.high), default_cents: dollarsToCents(f!.def), cost_cents: dollarsToCents(f!.cost) };
    if (await act(f!.id ? "PUT" : "POST", f!.id ? `/api/crm/price-book/${f!.id}` : "/api/crm/price-book", d)) { setF(null); reload(); }
  };
  const open = (p?: Row) => setF(p ? { ...p, low: centsToInput(p.low_cents), high: centsToInput(p.high_cents), def: centsToInput(p.default_cents), cost: centsToInput(p.cost_cents) } : { service: "", item: "", unit: "sq ft", low: "0", high: "0", def: "0", cost: "0" });
  return (
    <div class="c-page">
      <header class="c-head"><h1>Price book</h1><button class="c-btn c-go" onClick={() => open()}>+ Item</button></header>
      <p class="c-small c-mut">Ranges are typical GTA market ranges (from the website). Add your real cost per unit so quotes show the margin.</p>
      {f && <section class="c-card c-form">
        {[["service", "Service"], ["item", "Item"], ["unit", "Unit"], ["low", "Typical low $"], ["high", "Typical high $"], ["def", "Your usual price $"], ["cost", "Your cost $ (materials + labour per unit)"]].map(([k, l]) => <label key={k}>{l}<input value={f[k]} onInput={(e) => setF({ ...f, [k]: (e.target as HTMLInputElement).value })} /></label>)}
        <div class="c-actions"><button class="c-btn c-go" onClick={save}>Save</button><button class="c-btn" onClick={() => setF(null)}>Cancel</button>
          {f.id && <button class="c-btn c-ghost c-danger" onClick={async () => { if (confirm("Delete item?") && await act("DELETE", `/api/crm/price-book/${f.id}`)) { setF(null); reload(); } }}>Delete</button>}</div>
      </section>}
      {data?.items.map((p: Row) => (
        <div class="c-card c-row c-click" onClick={() => open(p)}>
          <span><b>{p.item}</b><span class="c-mut c-small c-blockline">{p.service} · typical {money(p.low_cents)}–{money(p.high_cents)}/{p.unit}</span></span>
          <span class="c-right"><b>{money(p.default_cents, true)}</b><span class={`c-small ${p.cost_cents ? "c-mut" : "c-warn"}`}>{p.cost_cents ? `cost ${money(p.cost_cents, true)}` : "cost not set"}</span></span>
        </div>
      ))}
    </div>
  );
}

// ── Templates ──────────────────────────────────────────────────────
export function Templates() {
  const { data, reload } = useGet<Row>("/api/crm/templates");
  return (
    <div class="c-page">
      <header class="c-head"><h1>Templates</h1></header>
      <p class="c-small c-mut">Placeholders: {"{first} {me} {service} {street} {quote_link} {review_link} {video_link}"}. Review texts must ask everyone the same way: no rewards, no "only if happy".</p>
      {data?.templates.map((t: Row) => <TemplateCard key={t.id} t={t} onSaved={reload} />)}
    </div>
  );
}
function TemplateCard({ t, onSaved }: { t: Row; onSaved: () => void }) {
  const [body, setBody] = useState(t.body);
  return (
    <section class="c-card">
      <div class="c-row"><b>{t.name}</b><span class="c-pill">{t.kind}</span></div>
      <textarea rows={4} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
      <div class="c-row"><span class="c-small c-mut">{body.length} chars{t.kind === "sms" && body.length > 300 ? " (long for a text)" : ""}</span>
        <button class="c-btn" disabled={body === t.body} onClick={async () => { if (await act("PUT", `/api/crm/templates/${t.id}`, { name: t.name, body })) onSaved(); }}>Save</button></div>
    </section>
  );
}

// ── Settings ───────────────────────────────────────────────────────
export function Settings() {
  const { data, reload } = useGet<Row>("/api/crm/settings");
  const [f, setF] = useState<Row | null>(null);
  useEffect(() => { if (data) setF({ ...data, rate: centsToInput(data.labour_rate_cents) }); }, [data]);
  if (!f) return <div class="c-page"><p class="c-mut">Loading…</p></div>;
  const set = (k: string) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  return (
    <form class="c-page c-form" onSubmit={async (e) => { e.preventDefault(); if (await act("PUT", "/api/crm/settings", { owner_name: f.owner_name, business: f.business, phone: f.phone, review_link: f.review_link, labour_rate_cents: dollarsToCents(f.rate), target_margin_pct: parseFloat(f.target_margin_pct) || 0 })) reload(); }}>
      <header class="c-head"><h1>Settings</h1></header>
      <label>Your first name (used in texts)<input value={f.owner_name} onInput={set("owner_name")} /></label>
      <label>Business name<input value={f.business} onInput={set("business")} /></label>
      <label>Business phone<input value={f.phone} onInput={set("phone")} /></label>
      <label>Google review link<input type="url" value={f.review_link} onInput={set("review_link")} /></label>
      <label>Labour cost per hour $ (what an hour of crew time costs you)<input inputMode="decimal" value={f.rate} onInput={set("rate")} /></label>
      <label>Target gross margin %<input inputMode="decimal" value={f.target_margin_pct} onInput={set("target_margin_pct")} /></label>
      <button class="c-btn c-go" type="submit">Save</button>
    </form>
  );
}
