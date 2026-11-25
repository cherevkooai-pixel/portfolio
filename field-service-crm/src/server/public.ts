// The only public routes: website webhook, Gmail intake, QR pages, the customer's quote page.
import { Hono, type Context } from "hono";
import { query, get, run } from "./db.ts";
import { createLead, logEvent, notify, settings, type Env } from "./leads.ts";
import { verifyNetlifyJws, classifyEmail, parseFrom, normalizeQrCode, streetOnly, deviceType, firstName, toE164, torontoDate } from "./rules.ts";
import { acceptQuote, Bad, PHOTO_CAP_BYTES } from "./crm.ts";
import { uid } from "./leads.ts";

export const pub = new Hono<Env>();
type Row = Record<string, any>;

export const PUBLIC_PATHS = [/^\/api\/form$/, /^\/api\/intake(\/email)?$/, /^\/q\/[^/]+$/, /^\/api\/quote\/[^/]+(\/accept)?$/];

const h = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const SITE = "https://solidlandscapeinc.com";
const SMS_CONSENT = "OK to text me about my project. Reply STOP anytime.";

async function limited(c: Context<Env>, bucket: string) {
  if (!c.env.LIMITER) return false;
  const ip = c.req.header("cf-connecting-ip") ?? "local"; // used for the limit only, never stored
  return !(await c.env.LIMITER.limit({ key: `${bucket}:${ip}` })).success;
}

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// ── Website forms (Netlify outgoing webhook, signed JWS) ───────────
pub.post("/api/intake", async (c) => {
  const raw = await c.req.text();
  if (raw.length > 200_000) return c.json({ error: "Too large" }, 413);
  if (!(await verifyNetlifyJws(c.req.header("x-webhook-signature"), raw, c.env.NETLIFY_JWS_SECRET ?? ""))) return c.json({ error: "Bad signature" }, 401);
  const p = JSON.parse(raw) as Row;
  const d: Row = p.data ?? {};
  if (d.company) return c.json({ ok: true, ignored: "honeypot" });
  const photo = typeof d.photo === "object" && d.photo?.url ? `Photo: ${d.photo.url}` : "";
  const r = await createLead(c.env, {
    name: String(d.name ?? ""), phone: String(d.phone ?? ""), email: String(d.email ?? ""),
    service: String(d.service ?? ""), size_hint: String(d.sqft || d.surface || d.estimate || ""), timing: String(d.timing ?? ""),
    details: [d.details, d.message, d.description, d.look && `Look: ${d.look}`, photo].filter(Boolean).join("\n"),
    source: "website", source_detail: [p.form_name, d.src].filter(Boolean).join(" · "), page: String(d.page ?? ""), utm: String(d.src ?? ""),
    address: { area: String(d.area ?? ""), city: ["Mississauga", "Etobicoke", "Toronto", "Oakville"].includes(d.area) ? d.area : "" },
    sms_express: d.sms_consent === "yes", consent_text: SMS_CONSENT,
  });
  return c.json({ ok: true, ...r });
});

// ── Website forms (posted straight from solidlandscapeinc.com; replaces Netlify Forms) ──
const SITE_ORIGIN = /^https:\/\/((www\.)?solidlandscapeinc\.com)$/;
pub.post("/api/form", async (c) => {
  const origin = c.req.header("origin") ?? "";
  // Back to the Thank-you page on the site the visitor came from (the page's CSP only allows its own origin).
  const back = (path: string) => c.redirect((SITE_ORIGIN.test(origin) ? origin : SITE) + path, 303);
  // No origin gate: browsers may send "Origin: null" or none for a cross-site form post (privacy settings), and real
  // visitors were getting 403. Spam is handled by the honeypot and the per-visitor rate limit.
  if (await limited(c, "form")) return html(c, page("Slow down", `<h1>Too many tries.</h1><p>Please wait a minute, or call <a href="tel:+14372991681">437-299-1681</a>.</p>`), 429);
  if (Number(c.req.header("content-length") ?? 0) > 12 * 1024 * 1024) return html(c, page("Too large", "<h1>That photo is too large.</h1><p>Please go back and pick a smaller one (under 10 MB).</p>"), 413);
  const f = await c.req.parseBody();
  if (f.company) return back("/thanks/"); // honeypot: bots fill it, people never see it
  const str = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
  if (!toE164(str("phone")) && !str("email").includes("@")) {
    return html(c, page("Almost there", `<h1>Please add your <b>phone number</b>.</h1><p class="mut">We need a way to reach you with your price.</p><p><a href="javascript:history.back()">← Go back</a> or call <a href="tel:+14372991681">437-299-1681</a>.</p>`), 400);
  }
  const area = str("area");
  const r = await createLead(c.env, {
    name: str("name"), phone: str("phone"), email: str("email"),
    service: str("service"), size_hint: str("sqft") || str("surface") || str("estimate"), timing: str("timing"),
    details: [str("details"), str("message"), str("description"), str("look") && `Look: ${str("look")}`].filter(Boolean).join("\n"),
    source: "website", source_detail: [str("form-name"), str("src")].filter(Boolean).join(" · "), page: str("page"), utm: str("src"),
    address: { area, city: ["Mississauga", "Etobicoke", "Toronto", "Oakville"].includes(area) ? area : "" },
    sms_express: str("sms_consent") === "yes", consent_text: SMS_CONSENT,
  });
  const photo = f.photo;
  if (photo instanceof File && photo.size > 0 && c.env.PHOTOS && /^image\/(jpeg|png|webp|heic|heif)$/.test(photo.type) && photo.size <= 10 * 1024 * 1024) {
    const used = await get<Row>("SELECT COALESCE(SUM(bytes), 0) AS b FROM photos");
    if (Number(used?.b ?? 0) + photo.size <= PHOTO_CAP_BYTES) {
      const id = uid();
      await c.env.PHOTOS.put(`photos/${id}`, photo.stream(), { httpMetadata: { contentType: photo.type } });
      await run("INSERT INTO photos (id, lead_id, r2_key, kind, content_type, bytes) VALUES (?, ?, ?, 'site', ?, ?)", [id, r.lead_id, `photos/${id}`, photo.type, photo.size]);
    }
  }
  return back("/thanks/");
});

// ── Gmail (Apps Script in the owner's Gmail posts new mail here) ───
pub.post("/api/intake/email", async (c) => {
  const auth = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!c.env.EMAIL_INTAKE_KEY || !safeEqual(auth, c.env.EMAIL_INTAKE_KEY)) return c.json({ error: "Unauthorized" }, 401);
  const b = (await c.req.json().catch(() => ({}))) as Row;
  const msgs: Row[] = Array.isArray(b.messages) ? b.messages.slice(0, 100) : [];
  let added = 0;
  const leads: string[] = [];
  for (const m of msgs) {
    if (typeof m.id !== "string" || !m.id) continue;
    const from = String(m.from ?? "").slice(0, 300), subject = String(m.subject ?? "").slice(0, 300), text = String(m.body ?? "").slice(0, 5000);
    const cl = classifyEmail({ from, subject, body: text, spam: !!m.spam, category: m.category });
    const f = parseFrom(from);
    const date = Date.parse(m.date) ? new Date(m.date).toISOString() : new Date().toISOString();
    const r = await run(
      "INSERT OR IGNORE INTO emails (id, thread_id, from_name, from_addr, subject, snippet, received_at, category, score, reasons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [m.id.slice(0, 64), String(m.threadId ?? "").slice(0, 64), f.name.slice(0, 120), f.addr.slice(0, 200), subject, text.replace(/\s+/g, " ").trim().slice(0, 1500), date, cl.category, cl.score, cl.reasons.join("; ")],
    );
    if (r.changes) {
      added++;
      if (cl.category === "lead") leads.push(`${f.name}: ${subject}`);
    }
  }
  if (leads.length) await notify(c.env, `📧 Possible lead email${leads.length > 1 ? "s" : ""}:\n${leads.slice(0, 5).join("\n")}\n→ ${c.env.APP_URL ?? ""}/inbox`);
  return c.json({ ok: true, added });
});

// ── QR landing page ────────────────────────────────────────────────
const SERVICES = ["Interlocking Driveways", "Retaining Walls", "Garden Design", "Sod Installation", "Gardening & Garden Maintenance", "Lawn Care & Grass", "Drainage & Grading", "Fencing", "Something else"];
const TIMING = ["As soon as possible", "Spring 2027", "Summer 2027", "Just pricing for now"];

const page = (title: string, inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${h(title)}</title><link rel="icon" href="${SITE}/assets/favicon-48.png">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;600;800&display=swap" rel="stylesheet">
<style>
:root{--g:#1f7a3a;--g2:#2fa556;--ink:#111;--mut:#5b5b5b;--line:#e6e6e6}
*{box-sizing:border-box}body{margin:0;font-family:'Hanken Grotesk',system-ui,sans-serif;color:var(--ink);background:#fff;line-height:1.45}
main{max-width:560px;margin:0 auto;padding:20px 16px 48px}header{display:flex;align-items:center;gap:10px;font-weight:800}header img{width:36px;height:36px}
h1{font-weight:300;font-size:30px;line-height:1.15;margin:22px 0 8px}h1 b{font-weight:800}p.mut{color:var(--mut);margin:0 0 18px}
.ph{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}.ph img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px}
blockquote{margin:10px 0;padding:10px 14px;border-left:3px solid var(--g);background:#f6f8f6;border-radius:6px}blockquote footer{color:var(--mut);font-size:14px;margin-top:4px}
fieldset{border:0;padding:0;margin:18px 0 6px}legend{font-weight:600;margin-bottom:8px}.ch{display:flex;flex-wrap:wrap;gap:8px}
.ch label{position:relative}.ch input{position:absolute;opacity:0}.ch span{display:inline-block;padding:10px 14px;border:1px solid var(--line);border-radius:999px;min-height:44px;line-height:22px}
.ch input:checked+span{border-color:var(--g);background:#eaf5ee;font-weight:600}.ch input:focus-visible+span{outline:2px solid var(--g)}
label.f{display:block;font-weight:600;margin:14px 0 4px}input[type=text],input[type=tel]{width:100%;font:inherit;padding:12px;border:1px solid #cfcfcf;border-radius:10px;min-height:48px}
.consent{display:flex;gap:10px;align-items:flex-start;margin:14px 0;font-size:15px}.consent input{width:22px;height:22px;margin-top:1px}
button{width:100%;font:inherit;font-weight:800;color:#fff;border:0;border-radius:12px;min-height:54px;background:linear-gradient(135deg,var(--g2),var(--g));margin-top:10px;font-size:18px}
.small{font-size:13px;color:var(--mut)}table{width:100%;border-collapse:collapse;margin:14px 0}td{padding:8px 4px;border-bottom:1px solid var(--line);vertical-align:top}td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
tr.t td{font-weight:800;border-bottom:0}.box{border:1px solid var(--line);border-radius:12px;padding:14px;margin:16px 0}.hp{position:absolute;left:-9999px}
a{color:var(--g)}@media print{button,form{display:none}}
</style></head><body><main><header><img src="${SITE}/assets/logo-mark.png" alt="">Solid Landscaping</header>${inner}</main></body></html>`;

const html = (c: Context<Env>, body: string, status = 200) => c.html(body, status as 200, { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" });

async function qrLookup(raw: string) {
  const code = normalizeQrCode(raw);
  if (!code) return null;
  return get<Row>(`SELECT q.id AS code, q.campaign_id, q.address_id, q.last_scan_at, cp.offer, cp.name AS campaign_name, a.line1, a.area
    FROM qr_codes q JOIN campaigns cp ON cp.id = q.campaign_id LEFT JOIN addresses a ON a.id = q.address_id WHERE q.id = ?`, [code]);
}

export function qrPage(q: Row, error = "") {
  const street = q.line1 ? streetOnly(q.line1) : "";
  const chips = (name: string, opts: string[]) => `<div class="ch">${opts.map((o) => `<label><input type="radio" name="${name}" value="${h(o)}"><span>${h(o)}</span></label>`).join("")}</div>`;
  return page("Your free yard estimate · Solid Landscaping", `
<h1>Hi neighbour${street ? ` on <b>${h(street)}</b>` : ""}!</h1>
<p class="mut">${h(q.offer || "We're working nearby. Tell us about your yard and we'll text you a typical price range, free and with no obligation.")}</p>
<div class="ph"><img src="${SITE}/assets/img/herringbone-interlock-driveway-800.webp" alt="Herringbone interlocking driveway by Solid Landscaping"><img src="${SITE}/assets/img/block-retaining-wall-pool-800.webp" alt="Block retaining wall by Solid Landscaping"></div>
<blockquote>Absolutely amazing job by the team. I love the result.<footer>Danylo H., Google review</footer></blockquote>
<blockquote>The guys are professionals, you can tell when people know what they're doing.<footer>Yurii A., Google review</footer></blockquote>
${error ? `<p role="alert" style="color:#a12">${h(error)}</p>` : ""}
<form method="post" action="/q/${h(q.code)}">
<fieldset><legend>What are you thinking about?</legend>${chips("service", SERVICES)}</fieldset>
<fieldset><legend>How big?</legend>${chips("size", ["Small", "Medium", "Large", "Not sure"])}</fieldset>
<fieldset><legend>When?</legend>${chips("timing", TIMING)}</fieldset>
<label class="f" for="n">First name</label><input id="n" type="text" name="name" autocomplete="given-name" required maxlength="60">
<label class="f" for="p">Mobile phone</label><input id="p" type="tel" name="phone" autocomplete="tel" inputmode="tel" required maxlength="20">
<input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
<label class="consent"><input type="checkbox" name="sms_consent" value="yes"><span>${SMS_CONSENT}</span></label>
<button type="submit">Get my price range →</button>
<p class="small">Prices are typical GTA ranges, not a quote. We use your details only to reply about your project. <a href="${SITE}/privacy/">Privacy</a></p>
</form>`);
}

pub.get("/q/:code", async (c) => {
  const q = await qrLookup(c.req.param("code"));
  if (!q) return html(c, page("Solid Landscaping", `<h1>This code isn't active.</h1><p class="mut">Visit <a href="${SITE}">solidlandscapeinc.com</a> or call <a href="tel:+14372991681">437-299-1681</a>.</p>`), 404);
  // One scan per code per hour; device type only, no IP.
  if (!q.last_scan_at || Date.now() - Date.parse(q.last_scan_at) > 3600_000) {
    await run("UPDATE qr_codes SET scans = scans + 1, last_scan_at = ? WHERE id = ?", [new Date().toISOString(), q.code]);
    await logEvent("qr_scanned", { campaign_id: q.campaign_id, meta: { code: q.code, device: deviceType(c.req.header("user-agent") ?? "") } });
  }
  return html(c, qrPage(q));
});

pub.post("/q/:code", async (c) => {
  const q = await qrLookup(c.req.param("code"));
  if (!q) return c.redirect(SITE, 303);
  if (await limited(c, "qr")) return html(c, page("Slow down", "<h1>Too many tries.</h1><p>Please wait a minute and try again.</p>"), 429);
  const f = await c.req.parseBody();
  if (f.company) return html(c, page("Thanks", "<h1>Thanks!</h1>"));
  const name = String(f.name ?? "").trim().slice(0, 60);
  const phone = String(f.phone ?? "");
  if (!name || !toE164(phone)) return html(c, qrPage(q, "Please add your first name and a 10-digit phone number."), 400);
  const r = await createLead(c.env, {
    name, phone, service: String(f.service ?? ""), size_hint: String(f.size ?? ""), timing: String(f.timing ?? ""),
    source: "qr", source_detail: q.campaign_name, campaign_id: q.campaign_id, address_id: q.address_id, page: `/q/${q.code}`,
    address: q.address_id ? undefined : { area: q.area ?? "" },
    sms_express: f.sms_consent === "yes", consent_text: SMS_CONSENT,
  });
  await logEvent("qr_lead", { lead_id: r.lead_id, campaign_id: q.campaign_id, meta: { code: q.code } });
  return html(c, page("Thanks · Solid Landscaping", `<h1>Thanks, <b>${h(firstName(name))}</b>!</h1><p class="mut">We got your details and will be in touch shortly. Can't wait? Call or text <a href="tel:+14372991681">437-299-1681</a>.</p>
<p><a href="${SITE}/our-work/">See our recent work →</a></p>`));
});

// ── Customer's quote page + online acceptance ──────────────────────
async function quoteByToken(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const q = await get<Row>(`SELECT q.*, c.name, a.line1 FROM quotes q JOIN leads l ON l.id = q.lead_id JOIN customers c ON c.id = l.customer_id LEFT JOIN addresses a ON a.id = l.address_id WHERE q.accept_token = ?`, [token]);
  if (!q || (q.token_expires_at && Date.parse(q.token_expires_at) < Date.now() && q.status !== "accepted")) return null;
  return q;
}

const money = (cents: number) => "$" + (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function quotePage(q: Row, msg = "") {
  const s = await settings();
  const lines = await query<Row>("SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY position", [q.id]);
  const street = q.line1 ? streetOnly(q.line1) : "";
  const status = q.status === "accepted"
    ? `<div class="box"><b>Accepted</b> by ${h(q.accepted_name)} on ${h(torontoDate(Date.parse(q.accepted_at)))}.${q.cooling_off_ends ? ` Because this agreement was signed at your home, you may cancel it until the end of ${h(q.cooling_off_ends)} (10-day cooling-off period).` : ""}</div>`
    : q.status === "superseded" ? `<div class="box">This version was replaced by a newer quote. Please use the latest link we sent, or call ${h(s.phone)}.</div>`
    : `<form method="post" action="/api/quote/${h(q.accept_token)}/accept" class="box">
<label class="f" for="an">Type your full name to accept</label><input id="an" type="text" name="name" required minlength="2" maxlength="120" autocomplete="name">
<label class="consent"><input type="checkbox" name="agree" value="yes" required><span>I accept this written estimate and its terms.</span></label>
<button type="submit">Accept quote</button></form>`;
  return page(`Quote v${q.version} · Solid Landscaping`, `
<h1>Your quote, <b>${h(firstName(q.name))}</b></h1>
<p class="mut">${h(s.business)} · ${h(s.phone)} · solidlandscapeinc.com<br>Version ${q.version} · ${h(torontoDate(Date.parse(q.sent_at ?? q.created_at)))}${street ? ` · ${h(street)}` : ""}</p>
${msg ? `<p role="alert"><b>${h(msg)}</b></p>` : ""}
<table>${lines.map((l) => `<tr><td>${h(l.item)}<div class="small">${h(l.qty)} ${h(l.unit)} × ${money(l.unit_cents)}</div></td><td class="n">${money(Math.round(l.qty * l.unit_cents))}</td></tr>`).join("")}
<tr><td>Subtotal</td><td class="n">${money(q.subtotal_cents)}</td></tr><tr><td>HST 13%</td><td class="n">${money(q.tax_cents)}</td></tr>
<tr class="t"><td>Total</td><td class="n">${money(q.total_cents)}</td></tr></table>
${q.notes ? `<p>${h(q.notes).replace(/\n/g, "<br>")}</p>` : ""}
<p class="small">This is a written estimate. The final price will not be more than 10% above this estimate unless you approve a change in writing (a new quote version).${q.signed_at_home ? " If you sign this at your home, you have a 10-day cooling-off period to cancel, and work will not start before it ends unless you ask us in writing." : ""}</p>
${status}
<p class="small">Questions? Call or text ${h(s.phone)}. You can print or save this page as a PDF.</p>`);
}

pub.get("/api/quote/:token", async (c) => {
  const q = await quoteByToken(c.req.param("token"));
  if (!q) return html(c, page("Quote", `<h1>This link has expired.</h1><p>Call or text 437-299-1681 and we'll send a fresh one.</p>`), 404);
  const meta = JSON.stringify({ version: q.version });
  if (!(await get("SELECT 1 FROM events WHERE type = 'quote_viewed' AND lead_id = ? AND meta = ?", [q.lead_id, meta]))) await logEvent("quote_viewed", { lead_id: q.lead_id, meta: { version: q.version } });
  return html(c, await quotePage(q));
});

pub.post("/api/quote/:token/accept", async (c) => {
  if (await limited(c, "quote")) return html(c, page("Slow down", "<h1>Too many tries.</h1>"), 429);
  const q = await quoteByToken(c.req.param("token"));
  if (!q) return html(c, page("Quote", "<h1>This link has expired.</h1>"), 404);
  const f = await c.req.parseBody();
  const name = String(f.name ?? "").trim().slice(0, 120);
  if (name.length < 2 || f.agree !== "yes") return html(c, await quotePage(q, "Type your name and tick the box to accept."), 400);
  try {
    await acceptQuote(q.id, name, "online");
  } catch (e) {
    if (e instanceof Bad) return html(c, await quotePage(q, e.message), 409);
    throw e;
  }
  await notify(c.env, `✅ Quote accepted online: ${name}, ${money(q.total_cents)} (v${q.version})\n→ ${c.env.APP_URL ?? ""}/leads/${q.lead_id}`);
  return html(c, await quotePage((await quoteByToken(c.req.param("token")))!, "Thank you! Your quote is accepted. We'll call you to book the start date."));
});

