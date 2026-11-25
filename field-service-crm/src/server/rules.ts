// Pure business rules (no DB, no I/O). Every money, legal and scoring rule lives here and is tested in tests/rules.test.mjs.

export const TZ = "America/Toronto";
export const HST_PCT = 13;
export const DAY = 86_400_000;

// ── Time (UTC stored, Toronto shown) ───────────────────────────────
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function torontoParts(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

/** Toronto wall-clock time → UTC ms (handles DST). */
export function torontoToUtc(y: number, m: number, d: number, h = 0, min = 0): number {
  const want = Date.UTC(y, m - 1, d, h, min);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = torontoParts(guess);
    guess += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return guess;
}

export function torontoDate(ms: number): string {
  const p = torontoParts(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ── Money (integer cents) ──────────────────────────────────────────
export type Line = { qty: number; unit_cents: number; cost_cents?: number };

export const lineCents = (qty: number, unitCents: number) => Math.round(qty * unitCents);

export function quoteTotals(lines: Line[]) {
  const subtotal_cents = lines.reduce((s, l) => s + lineCents(l.qty, l.unit_cents), 0);
  const tax_cents = Math.round((subtotal_cents * HST_PCT) / 100);
  const cost_cents = lines.reduce((s, l) => s + lineCents(l.qty, l.cost_cents ?? 0), 0);
  const margin_pct = subtotal_cents ? Math.round(((subtotal_cents - cost_cents) * 1000) / subtotal_cents) / 10 : 0;
  return { subtotal_cents, tax_cents, total_cents: subtotal_cents + tax_cents, cost_cents, margin_pct };
}

// ── Ontario Consumer Protection Act ────────────────────────────────
type QuoteLike = { version: number; total_cents: number; accepted_at: string | null; signed_at_home?: number | boolean; cooling_off_ends?: string; waiver_text?: string };

/** The binding estimate is the newest accepted version; a later accepted version is the customer-approved change order. */
export function bindingQuote<T extends QuoteLike>(quotes: T[]): T | null {
  return quotes.filter((q) => q.accepted_at).sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Final price may exceed the estimate by at most 10%. */
export const invoiceCapCents = (estimateCents: number) => Math.floor((estimateCents * 110) / 100);

export function checkInvoiceCap(invoiceTotalCents: number, quotes: QuoteLike[]): string | null {
  const q = bindingQuote(quotes);
  if (!q) return null; // no written estimate on file (job not from a quote)
  const cap = invoiceCapCents(q.total_cents);
  if (invoiceTotalCents <= cap) return null;
  return `Invoice $${(invoiceTotalCents / 100).toFixed(2)} is more than 10% over the accepted estimate ($${(q.total_cents / 100).toFixed(2)}, cap $${(cap / 100).toFixed(2)}). Send a change-order quote and get it accepted first.`;
}

/** 10-day cooling-off for agreements signed at the customer's home: last day the customer can cancel (Toronto date). */
export const coolingOffEnds = (acceptedAtMs: number) => addDays(torontoDate(acceptedAtMs), 10);

export function checkStartDate(startDate: string, quotes: QuoteLike[]): string | null {
  const q = bindingQuote(quotes);
  if (!q || !q.signed_at_home || q.waiver_text?.trim()) return null;
  const ends = q.cooling_off_ends || coolingOffEnds(Date.parse(q.accepted_at!));
  if (startDate > ends) return null;
  return `Signed at the customer's home: the 10-day cooling-off runs to ${ends}. Start on ${addDays(ends, 1)} or later, or record the customer's written waiver.`;
}

// ── Follow-up engine: 9 touches over 14 days ───────────────────────
export const FOLLOW_UP = [
  { day: 0, kind: "call", title: "First call (within 60 min)", template: "hi" },
  { day: 0, kind: "sms", title: "Text proof: 2 photos + reviews", template: "proof" },
  { day: 1, kind: "call", title: "Call", template: "miss" },
  { day: 2, kind: "video", title: "Send quote walk-through video", template: "video" },
  { day: 3, kind: "sms", title: "Any questions on the quote?", template: "questions" },
  { day: 5, kind: "call", title: "Call", template: "miss" },
  { day: 7, kind: "email", title: "Email same-area photos + reviews", template: "area" },
  { day: 10, kind: "sms", title: "Timing / spring schedule nudge", template: "timing" },
  { day: 14, kind: "call", title: "Last call, then the closing-file text", template: "last" },
] as const;

export const OPEN_HOURS = { from: 8, to: 20 }; // Toronto; no texts before 8 am or after 8 pm

/** Moves a time into today's/tomorrow's 8:00–20:00 Toronto window. */
export function intoWindow(ms: number): number {
  const p = torontoParts(ms);
  if (p.h < OPEN_HOURS.from) return torontoToUtc(p.y, p.m, p.d, OPEN_HOURS.from);
  if (p.h >= OPEN_HOURS.to) {
    const next = addDays(torontoDate(ms), 1).split("-").map(Number);
    return torontoToUtc(next[0], next[1], next[2], OPEN_HOURS.from);
  }
  return ms;
}

export function followUpSchedule(createdMs: number) {
  return FOLLOW_UP.map((t, step) => {
    let due: number;
    if (t.day === 0) due = intoWindow(createdMs + (step === 0 ? 60 : 120) * 60_000);
    else {
      const [y, m, d] = addDays(torontoDate(createdMs), t.day).split("-").map(Number);
      due = torontoToUtc(y, m, d, 10);
    }
    return { step, kind: t.kind, title: t.title, template_key: t.template, due_at: new Date(due).toISOString() };
  });
}

export const OPEN_STAGES = ["new", "contacted", "visit", "quoted"];
export const STAGES = ["new", "contacted", "visit", "quoted", "won", "lost", "later"];
export const LOST_REASONS = ["price", "timing", "chose another", "no response", "not a fit"];

// ── CASL consent ───────────────────────────────────────────────────
type Consent = { channel: string; basis: string; created_at: string; withdrawn_at?: string | null };

function addMonths(ms: number, n: number) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime();
}

/** express = until withdrawn; implied-inquiry = 6 months; implied-purchase = 2 years. */
export function consentActive(consents: Consent[], channel: string, nowMs: number): boolean {
  return consents.some((c) => {
    if (c.channel !== channel || c.withdrawn_at) return false;
    const at = Date.parse(c.created_at);
    if (c.basis === "express") return true;
    if (c.basis === "implied-inquiry") return nowMs < addMonths(at, 6);
    if (c.basis === "implied-purchase") return nowMs < addMonths(at, 24);
    return false;
  });
}

// ── Contacts ───────────────────────────────────────────────────────
export function toE164(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10 && /^[2-9]/.test(d)) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return null;
}

export function prettyPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : e164;
}

export function firstName(name: string) {
  return (name.trim().split(/\s+/)[0] || "there").replace(/^./, (c) => c.toUpperCase());
}

export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

// ── QR codes ───────────────────────────────────────────────────────
export const QR_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

export function newQrCode(random: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  return [...random(new Uint8Array(6))].map((b) => QR_ALPHABET[b & 31]).join("");
}

/** Accepts what a person might type (o→0, i/l→1, lower case, dashes). */
export function normalizeQrCode(s: string): string | null {
  const c = s.toUpperCase().replace(/[-\s]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{6}$/.test(c) ? c : null;
}

/** "Unit 5, 1234 Lorne Park Rd, Mississauga" → "Lorne Park Rd". Public pages show only this. */
export function streetOnly(line1: string): string {
  const tokens = line1.split(",").find((part) => /[a-z]{2,}/i.test(part.replace(/^\s*(unit|apt|suite)\b/i, "")))?.trim().split(/\s+/) ?? [];
  while (tokens.length && (/\d/.test(tokens[0]) || /^(unit|apt|suite|#)$/i.test(tokens[0]))) tokens.shift();
  return tokens.join(" ");
}

export function deviceType(ua: string) {
  return /mobile|iphone|android/i.test(ua) ? "mobile" : /ipad|tablet/i.test(ua) ? "tablet" : "desktop";
}

// ── Email triage (Gmail → spam / lead / other) ─────────────────────
const SPAM = /\b(seo|backlinks?|guest post|rank(ing)? (your|on|higher)|first page of google|web ?design (services|agency)|website redesign|lead generation|increase (your )?traffic|crypto|bitcoin|loan offer|business proposal|dear sir|virtual assistant|outsourc\w*|app development|google maps ranking|5[- ]star reviews|buy reviews)\b/i;
const SERVICE = /\b(driveway|interlock\w*|paver?s?|patio|retaining wall|wall|walkway|steps|landscap\w*|sod|lawn|grass|garden|grading|drainage|fenc\w*|backyard|front yard|stone|concrete|asphalt|yard)\b/gi;
const INTENT = /\b(quote|estimate|price|pricing|cost|how much|available|availability|book|site visit|come (by|over|take a look)|interested|project|redo|replace|install\w*)\b/i;
const PHONE = /(\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const FREE_MAIL = /@(gmail|hotmail|outlook|live|yahoo|icloud|me|rogers|bell|sympatico|cogeco|aol|msn|protonmail)\./i;
const BULK = /(no-?reply|noreply|notifications?|newsletter|mailer-daemon|marketing|news|info@|support@|billing@|receipts?@)/i;

export type EmailIn = { from: string; subject: string; body: string; spam?: boolean; category?: string };

export function classifyEmail(e: EmailIn): { category: "lead" | "spam" | "other" | "form"; score: number; reasons: string[] } {
  const text = `${e.subject}\n${e.body}`;
  if (e.spam) return { category: "spam", score: 0, reasons: ["Gmail spam"] };
  if (/@netlify\.com|formresponses/i.test(e.from)) return { category: "form", score: 0, reasons: ["Website form copy (already in Leads)"] };
  if (SPAM.test(text)) return { category: "spam", score: 0, reasons: ["Sales pitch: " + text.match(SPAM)![0]] };
  const reasons: string[] = [];
  let score = 0;
  const services = new Set((text.match(SERVICE) ?? []).map((s) => s.toLowerCase()));
  if (services.size) { score += Math.min(services.size, 3) * 2; reasons.push("mentions " + [...services].slice(0, 3).join(", ")); }
  if (INTENT.test(text)) { score += 2; reasons.push("asks: " + text.match(INTENT)![0].toLowerCase()); }
  if (PHONE.test(e.body)) { score += 2; reasons.push("has a phone number"); }
  if (FREE_MAIL.test(e.from)) { score += 1; reasons.push("personal email"); }
  if (BULK.test(e.from) || /unsubscribe/i.test(e.body)) { score -= 5; reasons.push("bulk sender"); }
  if (e.category && e.category !== "primary") { score -= 3; reasons.push("Gmail " + e.category); }
  return { category: score >= 5 ? "lead" : "other", score, reasons };
}

export function parseFrom(from: string) {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  const addr = (m ? m[2] : from).trim().toLowerCase();
  return { name: (m?.[1] || addr.split("@")[0]).trim(), addr };
}

export const findPhone = (s: string) => toE164(s.match(PHONE)?.[0]);

// ── Signatures ─────────────────────────────────────────────────────
const enc = new TextEncoder();
const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Netlify outgoing webhook: X-Webhook-Signature is a JWS (HS256) with { iss: "netlify", sha256: hex(body) }. */
export async function verifyNetlifyJws(token: string | null | undefined, body: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    if (header.alg !== "HS256") return false;
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, b64urlToBytes(s), enc.encode(`${h}.${p}`)))) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    return payload.iss === "netlify" && payload.sha256 === hex(await crypto.subtle.digest("SHA-256", enc.encode(body)));
  } catch {
    return false;
  }
}

/** Cloudflare Access JWT (RS256) against the team's JWKS. Returns the email or null. */
export async function verifyAccessJwt(token: string | null | undefined, jwks: { keys: JsonWebKey[] & { kid?: string }[] }, aud: string, nowSec = Date.now() / 1000): Promise<string | null> {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    if (header.alg !== "RS256") return null;
    const jwk = (jwks.keys as (JsonWebKey & { kid?: string })[]).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), enc.encode(`${h}.${p}`)))) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud) || !(payload.exp > nowSec) || (payload.nbf && payload.nbf > nowSec + 60)) return null;
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=@\t\r]|^[+-](?![\d\s])/.test(s)) s = "'" + s; // no formula injection in Excel/Sheets
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}
