// Private CRM API (behind Cloudflare Access). Mounted before the base app so its guards run first.
import { Hono } from "hono";
import { z } from "zod";
import { query, get, run } from "./db.ts";
import { nextIdentifier, nextInvoiceIdentifier } from "./index.ts";
import { createLead, logEvent, setStage, settings, uid, nowIso, leadQuotes, type Env } from "./leads.ts";
import {
  quoteTotals, bindingQuote, checkInvoiceCap, checkStartDate, coolingOffEnds, consentActive, torontoDate, torontoToUtc, addDays,
  randomToken, newQrCode, csv, toE164, findPhone, STAGES, LOST_REASONS, HST_PCT, streetOnly,
} from "./rules.ts";
import { computeMetrics, periodRange, type PeriodKind } from "./metrics.ts";

export const crm = new Hono<Env>();
type Row = Record<string, any>;

export class Bad extends Error {}
export const PHOTO_CAP_BYTES = 9 * 1024 ** 3;
const body = async <T extends z.ZodTypeAny>(c: { req: { json(): Promise<unknown> } }, s: T): Promise<z.infer<T>> => s.parse(await c.req.json().catch(() => ({})));
const str = (n = 200) => z.string().trim().max(n);
const opt = (n = 200) => str(n).optional().default("");
const cents = z.number().int().min(0).max(100_000_000);

const endOfToday = () => {
  const [y, m, d] = addDays(torontoDate(Date.now()), 1).split("-").map(Number);
  return new Date(torontoToUtc(y, m, d)).toISOString();
};

// ── First-run data: Solid's templates and price book ───────────────
const TEMPLATES: [string, string, string, string][] = [
  ["hi", "sms", "First text (no answer)", "Hi {first}, it's {me} from Solid Landscaping. Thanks for reaching out about your {service}. I just tried calling; when's a good time to chat? Or text me photos of the area and I'll send a price range."],
  ["miss", "sms", "Missed call", "Hi {first}, {me} from Solid Landscaping again. Tried you just now about the {service}. Text or call me back at 437-299-1681 whenever suits."],
  ["proof", "sms", "Proof: photos + reviews", "Hi {first}, here are a couple of {service} jobs we've done nearby, and what customers say: {review_link}. Happy to walk you through options."],
  ["video", "sms", "Quote walk-through video", "Hi {first}, I recorded a short video walking through your quote so it's easy to follow: {video_link}. Your quote: {quote_link}"],
  ["questions", "sms", "Any questions?", "Hi {first}, any questions on the quote for {street}? Happy to adjust materials or the layout to fit your budget."],
  ["area", "email", "Same-area photos + reviews", "Hi {first},\n\nHere are a few recent {service} projects near you, plus what homeowners said about working with us: {review_link}\n\nYour quote is here: {quote_link}\n\n{me}\nSolid Landscaping · 437-299-1681"],
  ["timing", "sms", "Timing nudge", "Hi {first}, quick heads-up: our spring schedule is filling up. If you'd like the {service} done before summer, let me know and I'll hold a spot."],
  ["last", "sms", "Closing the file", "Hi {first}, I don't want to keep bugging you, so I'll close your file for now. Just reply yes, no, or a better date and I'll take it from there. Thanks!"],
  ["review", "sms", "Review request", "Hi {first}, thanks again for choosing Solid Landscaping! If you have a minute, an honest Google review helps a small local business a lot: {review_link}"],
  ["referral", "sms", "Referral ask", "Hi {first}, hope you're enjoying the new {service}! If any neighbours or friends ask who did it, we'd be grateful for the referral."],
  ["recontact", "sms", "Re-contact (later)", "Hi {first}, {me} from Solid Landscaping. You asked me to check back about the {service}. Is now a better time?"],
];

// Typical GTA ranges from the website (build/content.py), not quotes. Costs are entered by the owner.
const PRICE_BOOK: [string, string, string, number, number][] = [
  ["Interlocking Driveways", "Interlock driveway, installed", "sq ft", 2500, 4500],
  ["Retaining Walls", "Retaining wall (face area)", "sq ft", 4500, 11000],
  ["Garden Design", "Bed and planting package", "job", 200000, 600000],
  ["Sod Installation", "Sod, installed (removal, grading, topsoil)", "sq ft", 200, 400],
  ["Gardening & Garden Maintenance", "Garden visit", "visit", 8000, 12000],
  ["Lawn Care & Grass", "Lawn cut", "cut", 4500, 6500],
  ["Drainage & Grading", "Grading and drainage fix", "job", 350000, 900000],
  ["Drainage & Grading", "Yard French drain", "lin ft", 5500, 9500],
  ["Fencing", "Wood privacy fence", "lin ft", 5500, 9500],
];

let seeded = false;
crm.use("*", async (_c, next) => {
  if (!seeded) {
    if (!(await get("SELECT 1 FROM templates LIMIT 1"))) for (const t of TEMPLATES) await run("INSERT OR IGNORE INTO templates (id, kind, name, body) VALUES (?, ?, ?, ?)", t);
    if (!(await get("SELECT 1 FROM price_book LIMIT 1"))) for (const [s, i, u, lo, hi] of PRICE_BOOK) await run("INSERT INTO price_book (id, service, item, unit, low_cents, high_cents, default_cents) VALUES (?, ?, ?, ?, ?, ?, ?)", [uid(), s, i, u, lo, hi, Math.round((lo + hi) / 2)]);
    seeded = true;
  }
  await next();
});

// ── Today ──────────────────────────────────────────────────────────
const LEAD_COLS = `l.id, l.stage, l.service, l.size_hint, l.timing, l.source, l.source_detail, l.created_at, l.customer_id, c.name, c.phone, c.email, a.line1, a.area, a.city`;
const LEAD_JOIN = `FROM leads l JOIN customers c ON c.id = l.customer_id LEFT JOIN addresses a ON a.id = l.address_id`;

crm.get("/api/crm/today", async (c) => {
  const fresh = await query(`SELECT ${LEAD_COLS}, (SELECT id FROM touches t WHERE t.lead_id = l.id AND t.step = 0 AND t.done_at IS NULL AND t.skipped_at IS NULL) AS touch_id
    ${LEAD_JOIN} WHERE l.deleted_at IS NULL AND l.stage = 'new' AND NOT EXISTS (SELECT 1 FROM touches t WHERE t.lead_id = l.id AND t.done_at IS NOT NULL) ORDER BY l.created_at`);
  const freshIds = new Set(fresh.map((l: Row) => l.id));
  const due = (await query(`SELECT t.id AS touch_id, t.kind, t.title, t.template_key, t.due_at, ${LEAD_COLS},
      (SELECT accept_token FROM quotes q WHERE q.lead_id = l.id AND q.accept_token IS NOT NULL ORDER BY version DESC LIMIT 1) AS quote_token
    FROM touches t JOIN leads l ON l.id = t.lead_id JOIN customers c ON c.id = l.customer_id LEFT JOIN addresses a ON a.id = l.address_id
    WHERE t.done_at IS NULL AND t.skipped_at IS NULL AND t.due_at < ? AND l.deleted_at IS NULL ORDER BY t.due_at`, [endOfToday()])).filter((t: Row) => !freshIds.has(t.id));
  const emails = await query("SELECT * FROM emails WHERE category = 'lead' AND dismissed = 0 AND lead_id IS NULL ORDER BY received_at DESC LIMIT 20");
  const jobs = await query(`SELECT j.id, j.identifier, j.scheduled_time, j.address, j.status, c.name FROM jobs j JOIN customers c ON c.id = j.customer_id
    WHERE j.scheduled_date = ? AND j.status != 'cancelled' ORDER BY j.scheduled_time`, [torontoDate(Date.now())]);
  const [y, m, d] = torontoDate(Date.now()).split("-").map(Number);
  const doneToday = await get<Row>("SELECT COUNT(*) AS n FROM touches WHERE done_at >= ?", [new Date(torontoToUtc(y, m, d)).toISOString()]);
  return c.json({ fresh, due, emails, jobs, done_today: doneToday?.n ?? 0, templates: await query("SELECT * FROM templates"), settings: await settings() });
});

// ── Leads ──────────────────────────────────────────────────────────
crm.get("/api/crm/leads", async (c) => {
  const stage = c.req.query("stage") ?? "";
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const leads = await query(`SELECT ${LEAD_COLS}, l.stage_changed_at, l.value_estimate_cents, l.lost_reason,
      (SELECT MIN(due_at) FROM touches t WHERE t.lead_id = l.id AND t.done_at IS NULL AND t.skipped_at IS NULL) AS next_due,
      (SELECT subtotal_cents FROM quotes q WHERE q.lead_id = l.id ORDER BY version DESC LIMIT 1) AS quote_cents,
      (SELECT COUNT(*) FROM touches t WHERE t.lead_id = l.id AND t.step < 10 AND t.done_at IS NOT NULL) AS t_done,
      (SELECT COUNT(*) FROM touches t WHERE t.lead_id = l.id AND t.step < 10 AND t.done_at IS NULL AND t.skipped_at IS NULL AND t.due_at < ?) AS t_late
    ${LEAD_JOIN} WHERE l.deleted_at IS NULL AND (? = '' OR l.stage = ?)
      AND (? = '' OR c.name LIKE ? OR a.line1 LIKE ? OR c.email LIKE ? OR (? != '' AND c.phone LIKE ?))
    ORDER BY l.created_at DESC LIMIT 300`, [nowIso(), stage, stage, q, like, like, like, digits, `%${digits}%`]);
  const counts = await query("SELECT stage, COUNT(*) AS n FROM leads WHERE deleted_at IS NULL GROUP BY stage");
  return c.json({ leads, counts: Object.fromEntries(counts.map((r: Row) => [r.stage, r.n])) });
});

const leadInput = z.object({
  name: str(120).min(1, "Name is required"), phone: opt(40), email: opt(200), service: opt(80), size_hint: opt(80), timing: opt(80), details: opt(2000),
  source: z.enum(["phone", "facebook", "referral", "walk-in", "google_gbp", "website", "qr", "email", "yard-sign", "other"]).default("phone"),
  source_detail: opt(200), campaign_id: z.string().uuid().nullable().optional(), line1: opt(200), city: opt(80), postal: opt(10), area: opt(80),
});

crm.post("/api/crm/leads", async (c) => {
  const d = await body(c, leadInput);
  if (!toE164(d.phone) && !d.email) throw new Bad("Add a valid phone number or an email");
  const r = await createLead(c.env, { ...d, address: { line1: d.line1, city: d.city, postal: d.postal, area: d.area } });
  return c.json(r, 201);
});

crm.get("/api/crm/leads/:id", async (c) => {
  const id = c.req.param("id");
  const lead = await get<Row>(`SELECT l.*, c.name, c.phone, c.email, c.notes AS customer_notes, a.line1, a.city, a.postal, a.area, cp.name AS campaign_name
    FROM leads l JOIN customers c ON c.id = l.customer_id LEFT JOIN addresses a ON a.id = l.address_id LEFT JOIN campaigns cp ON cp.id = l.campaign_id WHERE l.id = ?`, [id]);
  if (!lead) return c.json({ error: "Lead not found" }, 404);
  const quotes = await leadQuotes(id);
  const consents = await query<any>("SELECT * FROM consents WHERE customer_id = ? ORDER BY created_at DESC", [lead.customer_id]);
  const now = Date.now();
  return c.json({
    lead,
    touches: await query("SELECT * FROM touches WHERE lead_id = ? ORDER BY due_at", [id]),
    quotes,
    events: await query("SELECT * FROM events WHERE lead_id = ? ORDER BY ts DESC LIMIT 60", [id]),
    emails: lead.email ? await query("SELECT id, subject, snippet, received_at, category FROM emails WHERE from_addr = ? ORDER BY received_at DESC LIMIT 20", [lead.email]) : [],
    other_leads: await query("SELECT id, service, stage, created_at FROM leads WHERE customer_id = ? AND id != ? AND deleted_at IS NULL", [lead.customer_id, id]),
    job: lead.job_id ? await get("SELECT id, identifier, status, scheduled_date FROM jobs WHERE id = ?", [lead.job_id]) : null,
    photos: await query("SELECT id, kind, created_at FROM photos WHERE lead_id = ? OR (job_id IS NOT NULL AND job_id = ?) ORDER BY created_at", [id, lead.job_id ?? ""]),
    consent: { sms: consentActive(consents, "sms", now), email: consentActive(consents, "email", now), records: consents },
    templates: await query("SELECT * FROM templates"),
    settings: await settings(),
    stages: STAGES, lost_reasons: LOST_REASONS,
  });
});

crm.patch("/api/crm/leads/:id", async (c) => {
  const id = c.req.param("id");
  const d = await body(c, leadInput.partial().extend({ notes: str(4000).optional(), value_estimate_cents: cents.optional() }));
  const lead = await get<Row>("SELECT * FROM leads WHERE id = ?", [id]);
  if (!lead) return c.json({ error: "Lead not found" }, 404);
  const cols = ["service", "size_hint", "timing", "details", "source", "source_detail", "campaign_id", "notes", "value_estimate_cents"] as const;
  for (const k of cols) if (d[k] !== undefined) await run(`UPDATE leads SET ${k} = ? WHERE id = ?`, [d[k] ?? null, id]);
  if (d.name !== undefined) await run("UPDATE customers SET name = ? WHERE id = ?", [d.name, lead.customer_id]);
  if (d.email !== undefined) await run("UPDATE customers SET email = ? WHERE id = ?", [d.email.toLowerCase(), lead.customer_id]);
  if (d.phone !== undefined) {
    const p = toE164(d.phone);
    if (d.phone && !p) throw new Bad("That phone number doesn't look right");
    await run("UPDATE customers SET phone = ? WHERE id = ?", [p ?? "", lead.customer_id]);
  }
  if ([d.line1, d.city, d.postal, d.area].some((v) => v !== undefined)) {
    let aid = lead.address_id;
    if (!aid) { aid = uid(); await run("INSERT INTO addresses (id) VALUES (?)", [aid]); await run("UPDATE leads SET address_id = ? WHERE id = ?", [aid, id]); }
    for (const k of ["line1", "city", "postal", "area"] as const) if (d[k] !== undefined) await run(`UPDATE addresses SET ${k} = ? WHERE id = ?`, [k === "postal" ? d[k]!.toUpperCase() : d[k], aid]);
  }
  return c.json({ ok: true });
});

crm.post("/api/crm/leads/:id/stage", async (c) => {
  const d = await body(c, z.object({ stage: z.enum(STAGES as [string, ...string[]]), reason: opt(40), later_until: z.union([z.literal(""), z.string().date()]).default("") }));
  if (d.stage === "lost" && !d.reason) throw new Bad("Pick a lost reason");
  if (d.stage === "later" && !d.later_until) throw new Bad("Pick the date to check back");
  await setStage(c.req.param("id"), d.stage, d);
  return c.json({ ok: true });
});

crm.post("/api/crm/leads/:id/visit", async (c) => {
  const d = await body(c, z.object({ at: z.string().datetime() }));
  const id = c.req.param("id");
  await run("INSERT INTO touches (id, lead_id, step, kind, title, template_key, due_at) VALUES (?, ?, 50, 'visit', 'Site visit', '', ?)", [uid(), id, d.at]);
  const lead = await get<Row>("SELECT stage FROM leads WHERE id = ?", [id]);
  if (lead && ["new", "contacted"].includes(lead.stage)) await setStage(id, "visit");
  return c.json({ ok: true });
});

crm.post("/api/crm/leads/:id/note", async (c) => {
  const d = await body(c, z.object({ text: str(2000).min(1), kind: z.enum(["note", "call", "sms", "email"]).default("note") }));
  const id = c.req.param("id");
  if (d.kind === "note") await logEvent("note", { lead_id: id, meta: { text: d.text } });
  else {
    await run("INSERT INTO touches (id, lead_id, step, kind, title, due_at, done_at, outcome) VALUES (?, ?, 98, ?, ?, ?, ?, 'logged')", [uid(), id, d.kind, d.text, nowIso(), nowIso()]);
    await logEvent("touch_done", { lead_id: id, meta: { kind: d.kind, text: d.text } });
  }
  return c.json({ ok: true });
});

crm.delete("/api/crm/leads/:id", async (c) => {
  const id = c.req.param("id");
  await run("UPDATE leads SET deleted_at = ? WHERE id = ?", [nowIso(), id]);
  await run("UPDATE touches SET skipped_at = ? WHERE lead_id = ? AND done_at IS NULL AND skipped_at IS NULL", [nowIso(), id]);
  return c.json({ ok: true });
});

/** PIPEDA "delete my data": wipes personal details, keeps anonymous numbers. */
crm.post("/api/crm/customers/:id/purge", async (c) => {
  const id = c.req.param("id");
  const cust = await get<Row>("SELECT email FROM customers WHERE id = ?", [id]);
  if (!cust) return c.json({ error: "Not found" }, 404);
  await run("UPDATE customers SET name = '(deleted)', email = '', phone = '', address = '', city = '', zip = '', notes = '' WHERE id = ?", [id]);
  await run("UPDATE addresses SET line1 = '', postal = '' WHERE id IN (SELECT address_id FROM leads WHERE customer_id = ?)", [id]);
  await run("UPDATE leads SET details = '', notes = '', deleted_at = COALESCE(deleted_at, ?) WHERE customer_id = ?", [nowIso(), id]);
  await run("UPDATE touches SET skipped_at = COALESCE(skipped_at, ?) WHERE done_at IS NULL AND lead_id IN (SELECT id FROM leads WHERE customer_id = ?)", [nowIso(), id]);
  await run("UPDATE consents SET withdrawn_at = COALESCE(withdrawn_at, ?), text_shown = '' WHERE customer_id = ?", [nowIso(), id]);
  if (cust.email) await run("DELETE FROM emails WHERE from_addr = ?", [cust.email]);
  await run("DELETE FROM events WHERE type = 'note' AND lead_id IN (SELECT id FROM leads WHERE customer_id = ?)", [id]);
  return c.json({ ok: true });
});

crm.post("/api/crm/customers/:id/consent", async (c) => {
  const d = await body(c, z.object({ channel: z.enum(["sms", "email"]), action: z.enum(["withdraw", "express"]), text: opt(300) }));
  const id = c.req.param("id");
  if (d.action === "withdraw") await run("UPDATE consents SET withdrawn_at = ? WHERE customer_id = ? AND channel = ? AND withdrawn_at IS NULL", [nowIso(), id, d.channel]);
  else await run("INSERT INTO consents (id, customer_id, channel, basis, text_shown, source) VALUES (?, ?, ?, 'express', ?, 'owner (verbal/written)')", [uid(), id, d.channel, d.text]);
  return c.json({ ok: true });
});

// ── Touches ────────────────────────────────────────────────────────
crm.post("/api/crm/touches/:id/done", async (c) => {
  const d = await body(c, z.object({ outcome: z.enum(["", "answered", "no answer", "sent", "done"]).default("done") }));
  const t = await get<Row>("SELECT t.*, l.stage FROM touches t JOIN leads l ON l.id = t.lead_id WHERE t.id = ?", [c.req.param("id")]);
  if (!t) return c.json({ error: "Not found" }, 404);
  if (!t.done_at) {
    await run("UPDATE touches SET done_at = ?, outcome = ? WHERE id = ?", [nowIso(), d.outcome, t.id]);
    await logEvent("touch_done", { lead_id: t.lead_id, meta: { kind: t.kind, step: t.step, outcome: d.outcome } });
  } else if (d.outcome) {
    await run("UPDATE touches SET outcome = ? WHERE id = ?", [d.outcome, t.id]);
  }
  if (d.outcome === "answered" && t.stage === "new") await setStage(t.lead_id, "contacted");
  if (t.kind === "visit" && d.outcome === "done") await logEvent("visit_done", { lead_id: t.lead_id });
  return c.json({ ok: true });
});

crm.post("/api/crm/touches/:id/skip", async (c) => {
  await run("UPDATE touches SET skipped_at = ? WHERE id = ? AND done_at IS NULL", [nowIso(), c.req.param("id")]);
  return c.json({ ok: true });
});

crm.post("/api/crm/touches/:id/move", async (c) => {
  const d = await body(c, z.object({ due_at: z.string().datetime() }));
  await run("UPDATE touches SET due_at = ? WHERE id = ? AND done_at IS NULL", [d.due_at, c.req.param("id")]);
  return c.json({ ok: true });
});

// ── Templates & settings ───────────────────────────────────────────
crm.get("/api/crm/templates", async (c) => c.json({ templates: await query("SELECT * FROM templates ORDER BY name") }));
crm.put("/api/crm/templates/:id", async (c) => {
  const d = await body(c, z.object({ name: str(80).min(1), body: str(1600).min(1) }));
  await run("UPDATE templates SET name = ?, body = ? WHERE id = ?", [d.name, d.body, c.req.param("id")]);
  return c.json({ ok: true });
});

crm.get("/api/crm/settings", async (c) => c.json(await settings()));
crm.put("/api/crm/settings", async (c) => {
  const d = await body(c, z.object({ owner_name: str(40), business: str(80), phone: str(30), review_link: z.string().url().max(300), labour_rate_cents: cents, target_margin_pct: z.number().min(0).max(100) }).partial());
  for (const [k, v] of Object.entries(d)) await run("INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["crm_" + k, String(v)]);
  return c.json({ ok: true });
});

// ── Price book ─────────────────────────────────────────────────────
const priceItem = z.object({ service: str(80).min(1), item: str(120).min(1), unit: str(20), low_cents: cents, high_cents: cents, default_cents: cents, cost_cents: cents });
crm.get("/api/crm/price-book", async (c) => c.json({ items: await query("SELECT * FROM price_book ORDER BY service, item") }));
crm.post("/api/crm/price-book", async (c) => {
  const d = await body(c, priceItem);
  await run("INSERT INTO price_book (id, service, item, unit, low_cents, high_cents, default_cents, cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [uid(), d.service, d.item, d.unit, d.low_cents, d.high_cents, d.default_cents, d.cost_cents]);
  return c.json({ ok: true }, 201);
});
crm.put("/api/crm/price-book/:id", async (c) => {
  const d = await body(c, priceItem);
  await run("UPDATE price_book SET service = ?, item = ?, unit = ?, low_cents = ?, high_cents = ?, default_cents = ?, cost_cents = ? WHERE id = ?", [d.service, d.item, d.unit, d.low_cents, d.high_cents, d.default_cents, d.cost_cents, c.req.param("id")]);
  return c.json({ ok: true });
});
crm.delete("/api/crm/price-book/:id", async (c) => {
  await run("DELETE FROM price_book WHERE id = ?", [c.req.param("id")]);
  return c.json({ ok: true });
});

// ── Quotes (Ontario CPA rules in rules.ts) ─────────────────────────
crm.post("/api/crm/leads/:id/quotes", async (c) => {
  const leadId = c.req.param("id");
  const quotes = await leadQuotes(leadId);
  const last = quotes[quotes.length - 1];
  if (last?.status === "draft") return c.json({ id: last.id });
  const id = uid();
  await run("INSERT INTO quotes (id, lead_id, version, notes, signed_at_home) VALUES (?, ?, ?, ?, ?)", [id, leadId, (last?.version ?? 0) + 1, last ? (last as Row).notes : "", last?.signed_at_home ?? 0]);
  if (last) {
    await run("INSERT INTO quote_lines (id, quote_id, position, item, qty, unit, unit_cents, cost_cents) SELECT lower(hex(randomblob(16))), ?, position, item, qty, unit, unit_cents, cost_cents FROM quote_lines WHERE quote_id = ?", [id, last.id]);
    await run("UPDATE quotes SET subtotal_cents = ?, tax_cents = ?, total_cents = ?, cost_cents = ? WHERE id = ?", [last.subtotal_cents, (last as Row).tax_cents, last.total_cents, last.cost_cents, id]);
  }
  return c.json({ id }, 201);
});

crm.get("/api/crm/quotes/:id", async (c) => {
  const q = await get<Row>("SELECT * FROM quotes WHERE id = ?", [c.req.param("id")]);
  if (!q) return c.json({ error: "Quote not found" }, 404);
  const lead = await get<Row>(`SELECT ${LEAD_COLS}, l.job_id ${LEAD_JOIN} WHERE l.id = ?`, [q.lead_id]);
  return c.json({
    quote: q, lead,
    lines: await query("SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY position", [q.id]),
    versions: await query("SELECT id, version, status, total_cents, accepted_at FROM quotes WHERE lead_id = ? ORDER BY version", [q.lead_id]),
    price_book: await query("SELECT * FROM price_book ORDER BY service, item"),
    settings: await settings(),
  });
});

crm.put("/api/crm/quotes/:id", async (c) => {
  const d = await body(c, z.object({
    notes: str(4000).default(""), signed_at_home: z.boolean().default(false),
    lines: z.array(z.object({ item: str(200).min(1), qty: z.number().min(0).max(1_000_000), unit: str(20).default(""), unit_cents: cents, cost_cents: cents.default(0) })).max(60),
  }));
  const q = await get<Row>("SELECT status FROM quotes WHERE id = ?", [c.req.param("id")]);
  if (!q) return c.json({ error: "Quote not found" }, 404);
  if (q.status !== "draft") throw new Bad("This quote was already sent. Start a new version (change order) to edit it.");
  const t = quoteTotals(d.lines);
  const id = c.req.param("id");
  await run("DELETE FROM quote_lines WHERE quote_id = ?", [id]);
  let i = 0;
  for (const l of d.lines) await run("INSERT INTO quote_lines (id, quote_id, position, item, qty, unit, unit_cents, cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [uid(), id, i++, l.item, l.qty, l.unit, l.unit_cents, l.cost_cents]);
  await run("UPDATE quotes SET notes = ?, signed_at_home = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, cost_cents = ? WHERE id = ?", [d.notes, d.signed_at_home ? 1 : 0, t.subtotal_cents, t.tax_cents, t.total_cents, t.cost_cents, id]);
  return c.json({ ok: true, ...t });
});

crm.post("/api/crm/quotes/:id/send", async (c) => {
  const q = await get<Row>("SELECT * FROM quotes WHERE id = ?", [c.req.param("id")]);
  if (!q) return c.json({ error: "Quote not found" }, 404);
  if (q.status !== "draft" && q.status !== "sent") throw new Bad("Quote already " + q.status);
  if (!q.subtotal_cents) throw new Bad("Add at least one priced line first");
  const token = q.accept_token ?? randomToken(16);
  await run("UPDATE quotes SET status = 'sent', accept_token = ?, token_expires_at = ?, sent_at = COALESCE(sent_at, ?) WHERE id = ?", [token, new Date(Date.now() + 60 * 86_400_000).toISOString(), nowIso(), q.id]);
  await run("UPDATE quotes SET status = 'superseded' WHERE lead_id = ? AND status = 'sent' AND id != ?", [q.lead_id, q.id]);
  if (!q.sent_at) await logEvent("quote_sent", { lead_id: q.lead_id, value_cents: q.subtotal_cents, meta: { version: q.version, total_cents: q.total_cents } });
  const lead = await get<Row>("SELECT stage FROM leads WHERE id = ?", [q.lead_id]);
  if (lead && ["new", "contacted", "visit"].includes(lead.stage)) await setStage(q.lead_id, "quoted");
  return c.json({ ok: true, token });
});

export async function acceptQuote(quoteId: string, name: string, how: string) {
  const q = await get<Row>("SELECT * FROM quotes WHERE id = ?", [quoteId]);
  if (!q || q.status !== "sent") throw new Bad("This quote can't be accepted (it may have been replaced by a newer version).");
  const now = Date.now();
  const ends = q.signed_at_home ? coolingOffEnds(now) : "";
  await run("UPDATE quotes SET status = 'accepted', accepted_at = ?, accepted_name = ?, cooling_off_ends = ? WHERE id = ?", [new Date(now).toISOString(), name, ends, q.id]);
  await logEvent("quote_accepted", { lead_id: q.lead_id, value_cents: q.subtotal_cents, meta: { version: q.version, how, total_cents: q.total_cents } });
  const lead = await get<Row>("SELECT stage FROM leads WHERE id = ?", [q.lead_id]);
  if (lead && lead.stage !== "won") await setStage(q.lead_id, "won");
  return { cooling_off_ends: ends };
}

/** Owner records a paper/at-home signature. */
crm.post("/api/crm/quotes/:id/accept", async (c) => {
  const d = await body(c, z.object({ name: str(120).min(2), signed_at_home: z.boolean() }));
  await run("UPDATE quotes SET signed_at_home = ? WHERE id = ? AND status = 'sent'", [d.signed_at_home ? 1 : 0, c.req.param("id")]);
  return c.json(await acceptQuote(c.req.param("id"), d.name, d.signed_at_home ? "signed at home" : "signed (owner recorded)"));
});

crm.post("/api/crm/quotes/:id/waiver", async (c) => {
  const d = await body(c, z.object({ text: str(1000).min(10, "Write what the customer signed, e.g. their request to start before the cooling-off ends") }));
  await run("UPDATE quotes SET waiver_text = ? WHERE id = ? AND status = 'accepted'", [d.text, c.req.param("id")]);
  await logEvent("cooling_off_waived", { meta: { quote_id: c.req.param("id") } });
  return c.json({ ok: true });
});

// ── Jobs (base tables) + guards ────────────────────────────────────
crm.post("/api/crm/leads/:id/job", async (c) => {
  const d = await body(c, z.object({ scheduled_date: z.string().date(), scheduled_time: opt(10), duration: z.number().int().min(15).max(60 * 24 * 14).default(480) }));
  const lead = await get<Row>(`SELECT l.*, c.address AS caddr, a.line1, a.city FROM leads l JOIN customers c ON c.id = l.customer_id LEFT JOIN addresses a ON a.id = l.address_id WHERE l.id = ?`, [c.req.param("id")]);
  if (!lead) return c.json({ error: "Lead not found" }, 404);
  if (lead.job_id) throw new Bad("This lead already has a job");
  const quotes = await leadQuotes(lead.id);
  const block = checkStartDate(d.scheduled_date, quotes);
  if (block) throw new Bad(block);
  const q = bindingQuote(quotes);
  const lines = q ? await query<Row>("SELECT item, qty, unit FROM quote_lines WHERE quote_id = ? ORDER BY position", [q.id]) : [];
  const st = await get<Row>("SELECT id FROM service_types WHERE name = ?", [lead.service]);
  const job = await get<Row>(
    `INSERT INTO jobs (identifier, customer_id, service_type_id, status, priority, scheduled_date, scheduled_time, duration, price, address, notes)
     VALUES (?, ?, ?, 'scheduled', 'normal', ?, ?, ?, ?, ?, ?) RETURNING id`,
    [await nextIdentifier(), lead.customer_id, st?.id ?? null, d.scheduled_date, d.scheduled_time, d.duration, (q?.subtotal_cents ?? 0) / 100,
      [lead.line1 || lead.caddr, lead.city].filter(Boolean).join(", "), lines.map((l) => `• ${l.item} — ${l.qty} ${l.unit}`).join("\n")],
  );
  await run("UPDATE leads SET job_id = ? WHERE id = ?", [job!.id, lead.id]);
  if (lead.stage !== "won") await setStage(lead.id, "won");
  await logEvent("job_scheduled", { lead_id: lead.id, job_id: job!.id });
  return c.json({ job_id: job!.id }, 201);
});

const leadForJob = (jobId: string) => get<Row>("SELECT * FROM leads WHERE job_id = ? AND deleted_at IS NULL", [jobId]);

// Guard the base job update: cooling-off on reschedule, and log completion.
crm.put("/api/jobs/:id", async (c, next) => {
  const jobId = c.req.param("id");
  const b = (await c.req.json().catch(() => ({}))) as Row;
  const lead = await leadForJob(jobId);
  const before = await get<Row>("SELECT status, price FROM jobs WHERE id = ?", [jobId]);
  if (lead && b.scheduled_date) {
    const block = checkStartDate(String(b.scheduled_date), await leadQuotes(lead.id));
    if (block) return c.json({ error: block }, 409);
  }
  await next();
  if (c.res.ok && b.status === "completed" && before && before.status !== "completed") {
    const q = lead ? bindingQuote(await leadQuotes(lead.id)) : null;
    await logEvent("job_completed", { lead_id: lead?.id, job_id: jobId, value_cents: q?.subtotal_cents ?? Math.round(Number(before.price) * 100) });
    if (lead) {
      const [y, m, dd] = addDays(torontoDate(Date.now()), 14).split("-").map(Number);
      await run("INSERT INTO touches (id, lead_id, step, kind, title, template_key, due_at) VALUES (?, ?, 97, 'sms', 'Referral ask', 'referral', ?)", [uid(), lead.id, new Date(torontoToUtc(y, m, dd, 10)).toISOString()]);
    }
  }
});

// Invoice from the accepted quote (HST 13%), with the 10% cap.
crm.post("/api/jobs/:id/invoice", async (c, next) => {
  const jobId = c.req.param("id");
  const lead = await leadForJob(jobId);
  const quotes = lead ? await leadQuotes(lead.id) : [];
  const q = bindingQuote(quotes);
  if (!q) return next(); // not from a quote: base behaviour
  const lines = await query<Row>("SELECT item, qty, unit_cents FROM quote_lines WHERE quote_id = ? ORDER BY position", [q.id]);
  const t = quoteTotals(lines.map((l) => ({ qty: l.qty, unit_cents: l.unit_cents })));
  const block = checkInvoiceCap(t.total_cents, quotes);
  if (block) return c.json({ error: block }, 409);
  const inv = await get<Row>(
    "INSERT INTO invoices (identifier, customer_id, job_id, status, subtotal, tax_rate, tax_amount, total, notes, due_date) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, '') RETURNING id",
    [await nextInvoiceIdentifier(), lead!.customer_id, jobId, t.subtotal_cents / 100, HST_PCT, t.tax_cents / 100, t.total_cents / 100, `Per accepted estimate v${q.version}. HST #: add yours in Settings.`],
  );
  for (const l of lines) await run("INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?)", [inv!.id, l.item, l.qty, l.unit_cents / 100, Math.round(l.qty * l.unit_cents) / 100]);
  return c.json({ ok: true, invoice_id: inv!.id }, 201);
});

// Manual invoices for a quoted job must also stay within the cap.
crm.post("/api/invoices", async (c, next) => {
  const b = (await c.req.json().catch(() => ({}))) as Row;
  const lead = b.job_id ? await leadForJob(String(b.job_id)) : null;
  if (lead) {
    const subtotal = (b.lines ?? []).reduce((s: number, l: Row) => s + Math.round(Number(l.quantity) * Number(l.unit_price) * 100), 0);
    const total = subtotal + Math.round((subtotal * Number(b.tax_rate ?? 0)) / 100);
    const block = checkInvoiceCap(total, await leadQuotes(lead.id));
    if (block) return c.json({ error: block }, 409);
  }
  return next();
});

crm.put("/api/invoices/:id", async (c, next) => {
  const b = (await c.req.json().catch(() => ({}))) as Row;
  const inv = await get<Row>("SELECT * FROM invoices WHERE id = ?", [c.req.param("id")]);
  await next();
  if (c.res.ok && inv && b.status === "paid" && inv.status !== "paid") {
    const lead = inv.job_id ? await leadForJob(inv.job_id) : null;
    await logEvent("invoice_paid", { lead_id: lead?.id, job_id: inv.job_id, value_cents: Math.round(Number(inv.total) * 100) });
  }
});

crm.get("/api/crm/jobs/:id", async (c) => {
  const jobId = c.req.param("id");
  const lead = await get<Row>(`SELECT ${LEAD_COLS} ${LEAD_JOIN} WHERE l.job_id = ?`, [jobId]);
  const quotes = lead ? await leadQuotes(lead.id) : [];
  const q = bindingQuote(quotes);
  const mats = await get<Row>("SELECT COALESCE(SUM(jm.quantity * jm.unit_cost), 0) AS d FROM job_materials jm WHERE jm.job_id = ?", [jobId]);
  const costs = (await get<Row>("SELECT * FROM job_costs WHERE id = ?", [jobId])) ?? { labour_hours: 0, sub_cents: 0, other_cents: 0 };
  const s = await settings();
  const price = q?.subtotal_cents ?? 0;
  const cost = Math.round(Number(mats?.d ?? 0) * 100) + Math.round(costs.labour_hours * s.labour_rate_cents) + costs.sub_cents + costs.other_cents;
  return c.json({
    lead, quote: q, costs, materials_cents: Math.round(Number(mats?.d ?? 0) * 100),
    actual_margin_pct: price ? Math.round(((price - cost) * 1000) / price) / 10 : null,
    quoted_margin_pct: q && q.subtotal_cents ? Math.round(((q.subtotal_cents - q.cost_cents) * 1000) / q.subtotal_cents) / 10 : null,
    photos: await query("SELECT id, kind, created_at FROM photos WHERE job_id = ? ORDER BY created_at", [jobId]),
    reviews: await query("SELECT type, ts FROM events WHERE job_id = ? AND type IN ('review_requested', 'review_received') ORDER BY ts", [jobId]),
    templates: await query("SELECT * FROM templates WHERE id IN ('review', 'referral')"),
    settings: s,
  });
});

crm.put("/api/crm/jobs/:id/costs", async (c) => {
  const d = await body(c, z.object({ labour_hours: z.number().min(0).max(10000), sub_cents: cents, other_cents: cents }));
  await run("INSERT INTO job_costs (id, labour_hours, sub_cents, other_cents) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET labour_hours = excluded.labour_hours, sub_cents = excluded.sub_cents, other_cents = excluded.other_cents", [c.req.param("id"), d.labour_hours, d.sub_cents, d.other_cents]);
  return c.json({ ok: true });
});

crm.post("/api/crm/jobs/:id/review", async (c) => {
  const d = await body(c, z.object({ kind: z.enum(["requested", "received"]) }));
  const jobId = c.req.param("id");
  const lead = await leadForJob(jobId);
  await logEvent("review_" + d.kind, { lead_id: lead?.id, job_id: jobId });
  return c.json({ ok: true });
});

// ── Photos (R2) ────────────────────────────────────────────────────
crm.post("/api/crm/photos", async (c) => {
  if (!c.env.PHOTOS) throw new Bad("Photo storage (R2) isn't set up yet");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new Bad("No photo attached");
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Bad("Photos must be JPEG, PNG, WebP or HEIC");
  if (file.size > 4 * 1024 * 1024) throw new Bad("Photo is over 4 MB");
  // Stay inside R2's free 10 GB: hard stop at 9 GB, so storage can never be billed.
  const used = await get<Row>("SELECT COALESCE(SUM(bytes), 0) AS b FROM photos");
  if (Number(used?.b ?? 0) + file.size > PHOTO_CAP_BYTES) throw new Bad("Photo storage is full (9 GB free limit). Delete old photos to add new ones.");
  const id = uid();
  const key = `photos/${id}`;
  await c.env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const kind = String(form.get("kind") || "site");
  await run("INSERT INTO photos (id, job_id, lead_id, r2_key, kind, content_type, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, form.get("job_id") || null, form.get("lead_id") || null, key, ["before", "after", "site"].includes(kind) ? kind : "site", file.type, file.size]);
  return c.json({ id }, 201);
});

crm.get("/api/crm/photos/:id", async (c) => {
  const p = await get<Row>("SELECT * FROM photos WHERE id = ?", [c.req.param("id")]);
  const obj = p && c.env.PHOTOS ? await c.env.PHOTOS.get(p.r2_key) : null;
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, { headers: { "content-type": p!.content_type, "cache-control": "private, max-age=86400" } });
});

crm.delete("/api/crm/photos/:id", async (c) => {
  const p = await get<Row>("SELECT * FROM photos WHERE id = ?", [c.req.param("id")]);
  if (p) { await c.env.PHOTOS?.delete(p.r2_key); await run("DELETE FROM photos WHERE id = ?", [p.id]); }
  return c.json({ ok: true });
});

// ── Campaigns & QR ─────────────────────────────────────────────────
const campaignInput = z.object({
  name: str(120).min(1), channel: z.enum(["postcard", "door hanger", "flyer", "lawn sign", "truck", "invoice", "web", "gbp", "fb", "referral", "other"]),
  area: opt(80), offer: opt(300), start_date: z.union([z.literal(""), z.string().date()]).default(""), end_date: z.union([z.literal(""), z.string().date()]).default(""),
  pieces: z.number().int().min(0).max(1_000_000).default(0), cost_cents: cents.default(0),
});

crm.get("/api/crm/campaigns", async (c) => c.json({
  campaigns: await query(`SELECT cp.*, (SELECT COUNT(*) FROM qr_codes q WHERE q.campaign_id = cp.id) AS codes,
    (SELECT COALESCE(SUM(scans), 0) FROM qr_codes q WHERE q.campaign_id = cp.id) AS scans,
    (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = cp.id AND l.deleted_at IS NULL) AS leads,
    (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = cp.id AND l.stage = 'won') AS won
    FROM campaigns cp ORDER BY cp.created_at DESC`),
}));

crm.post("/api/crm/campaigns", async (c) => {
  const d = await body(c, campaignInput);
  const id = uid();
  await run("INSERT INTO campaigns (id, name, channel, area, offer, start_date, end_date, pieces, cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, d.name, d.channel, d.area, d.offer, d.start_date, d.end_date, d.pieces, d.cost_cents]);
  return c.json({ id }, 201);
});

crm.put("/api/crm/campaigns/:id", async (c) => {
  const d = await body(c, campaignInput);
  await run("UPDATE campaigns SET name = ?, channel = ?, area = ?, offer = ?, start_date = ?, end_date = ?, pieces = ?, cost_cents = ? WHERE id = ?", [d.name, d.channel, d.area, d.offer, d.start_date, d.end_date, d.pieces, d.cost_cents, c.req.param("id")]);
  return c.json({ ok: true });
});

/** One code per address (paste "123 Main St, Mississauga, L5H 1A1" lines), or N campaign-only codes for signs/trucks/invoices. */
crm.post("/api/crm/campaigns/:id/codes", async (c) => {
  const d = await body(c, z.object({ addresses: str(200_000).default(""), count: z.number().int().min(0).max(500).default(0), area: opt(80) }));
  const cid = c.req.param("id");
  const camp = await get<Row>("SELECT * FROM campaigns WHERE id = ?", [cid]);
  if (!camp) return c.json({ error: "Campaign not found" }, 404);
  const lines = d.addresses.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3000);
  const make = async (addressId: string | null) => {
    for (let i = 0; i < 5; i++) {
      const code = newQrCode();
      const r = await run("INSERT OR IGNORE INTO qr_codes (id, campaign_id, address_id) VALUES (?, ?, ?)", [code, cid, addressId]);
      if (r.changes) return code;
    }
    throw new Error("Could not make a unique code");
  };
  let made = 0;
  for (const line of lines) {
    const [line1, city = "", postal = ""] = line.split(/\s*[,;\t]\s*/);
    const aid = uid();
    await run("INSERT INTO addresses (id, line1, city, postal, area, municipality) VALUES (?, ?, ?, ?, ?, ?)", [aid, line1.slice(0, 200), city.slice(0, 80), postal.toUpperCase().slice(0, 10), d.area || camp.area, city.slice(0, 80)]);
    await make(aid); made++;
  }
  for (let i = 0; i < d.count; i++) { await make(null); made++; }
  return c.json({ made });
});

const qrBase = (env: Env["Bindings"], origin: string) => (env.QR_BASE || origin + "/q").replace(/\/$/, "");

crm.get("/api/crm/campaigns/:id/codes", async (c) => {
  const base = qrBase(c.env, new URL(c.req.url).origin);
  const codes = await query<Row>(`SELECT q.id AS code, q.scans, q.last_scan_at, a.line1, a.city, a.postal,
      (SELECT l.id FROM leads l WHERE l.address_id = q.address_id AND q.address_id IS NOT NULL LIMIT 1) AS lead_id
    FROM qr_codes q LEFT JOIN addresses a ON a.id = q.address_id WHERE q.campaign_id = ? ORDER BY a.line1, q.created_at`, [c.req.param("id")]);
  const rows: Row[] = codes.map((r) => ({ ...r, url: `${base}/${r.code}`, street: r.line1 ? streetOnly(r.line1) : "" }));
  if (c.req.query("format") === "csv") {
    return new Response(csv(rows.map((r) => ({ code: r.code, url: r.url, address: r.line1 ?? "", city: r.city ?? "", postal: r.postal ?? "", greeting_street: r.street }))), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="qr-codes.csv"` },
    });
  }
  return c.json({ codes: rows, campaign: await get("SELECT * FROM campaigns WHERE id = ?", [c.req.param("id")]) });
});

/** Scanned but never filled the form: 2nd mailing or a door knock. */
crm.get("/api/crm/warm", async (c) => c.json({
  warm: await query(`SELECT q.id AS code, q.scans, q.last_scan_at, a.line1, a.city, cp.name AS campaign FROM qr_codes q
    JOIN addresses a ON a.id = q.address_id JOIN campaigns cp ON cp.id = q.campaign_id
    WHERE q.scans > 0 AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.address_id = q.address_id) ORDER BY q.last_scan_at DESC LIMIT 300`),
}));

// ── Gmail inbox ────────────────────────────────────────────────────
crm.get("/api/crm/emails", async (c) => {
  const cat = c.req.query("category") ?? "lead";
  const emails = await query(`SELECT * FROM emails WHERE (? = 'all' AND category != 'form' OR category = ?) ORDER BY received_at DESC LIMIT 200`, [cat, cat]);
  const counts = await query("SELECT category, COUNT(*) AS n FROM emails WHERE dismissed = 0 AND lead_id IS NULL GROUP BY category");
  return c.json({ emails, counts: Object.fromEntries(counts.map((r: Row) => [r.category, r.n])) });
});

crm.patch("/api/crm/emails/:id", async (c) => {
  const d = await body(c, z.object({ category: z.enum(["lead", "other", "spam"]).optional(), dismissed: z.boolean().optional() }));
  if (d.category) await run("UPDATE emails SET category = ? WHERE id = ?", [d.category, c.req.param("id")]);
  if (d.dismissed !== undefined) await run("UPDATE emails SET dismissed = ? WHERE id = ?", [d.dismissed ? 1 : 0, c.req.param("id")]);
  return c.json({ ok: true });
});

crm.post("/api/crm/emails/:id/convert", async (c) => {
  const e = await get<Row>("SELECT * FROM emails WHERE id = ?", [c.req.param("id")]);
  if (!e) return c.json({ error: "Not found" }, 404);
  if (e.lead_id) return c.json({ lead_id: e.lead_id });
  const d = await body(c, z.object({ name: opt(120), phone: opt(40), service: opt(80) }));
  const r = await createLead(c.env, {
    name: d.name || e.from_name, email: e.from_addr, phone: d.phone || findPhone(e.snippet) || "", service: d.service,
    details: `Email: ${e.subject}\n${e.snippet}`.slice(0, 2000), source: "email", source_detail: e.subject.slice(0, 200),
  });
  await run("UPDATE emails SET lead_id = ?, category = 'lead' WHERE id = ?", [r.lead_id, e.id]);
  return c.json(r, 201);
});

// ── Numbers ────────────────────────────────────────────────────────
crm.get("/api/crm/numbers", async (c) => {
  const kind = (["week", "month", "season", "year"].includes(c.req.query("period") ?? "") ? c.req.query("period") : "month") as PeriodKind;
  const now = Date.now();
  const p = periodRange(kind, now);
  const data = {
    leads: await query<any>("SELECT l.id, l.created_at, l.source, l.campaign_id, COALESCE(NULLIF(a.area, ''), a.city, '') AS area FROM leads l LEFT JOIN addresses a ON a.id = l.address_id WHERE l.deleted_at IS NULL"),
    events: (await query<any>("SELECT ts, type, lead_id, job_id, campaign_id, value_cents, meta FROM events WHERE type IN ('stage_changed','quote_sent','job_completed','invoice_paid','qr_scanned','review_received')")).map((e) => ({ ...e, meta: JSON.parse(e.meta || "{}") })),
    touches: await query<any>("SELECT t.lead_id, t.kind, t.due_at, t.done_at, t.skipped_at FROM touches t JOIN leads l ON l.id = t.lead_id WHERE l.deleted_at IS NULL"),
    campaigns: await query<any>("SELECT id, name, channel, pieces, cost_cents, start_date FROM campaigns"),
    jobCosts: await query<any>(`SELECT e.job_id, e.ts AS completed_at, e.value_cents AS price_cents,
        CAST(ROUND(COALESCE((SELECT SUM(quantity * unit_cost) FROM job_materials jm WHERE jm.job_id = e.job_id), 0) * 100) AS INTEGER) AS materials_cents,
        COALESCE(jc.labour_hours, 0) AS labour_hours, COALESCE(jc.sub_cents, 0) AS sub_cents, COALESCE(jc.other_cents, 0) AS other_cents
      FROM events e LEFT JOIN job_costs jc ON jc.id = e.job_id WHERE e.type = 'job_completed'`),
    openQuotes: await query<any>(`SELECT l.id AS lead_id, (SELECT subtotal_cents FROM quotes q WHERE q.lead_id = l.id AND q.status = 'sent' ORDER BY version DESC LIMIT 1) AS subtotal_cents
      FROM leads l WHERE l.stage = 'quoted' AND l.deleted_at IS NULL`).then((r) => r.filter((x) => x.subtotal_cents)),
    labourRateCents: (await settings()).labour_rate_cents,
  };
  return c.json({ period: kind, label: p.label, now: computeMetrics(data, p.start, p.end, now), prev: computeMetrics(data, p.prevStart, p.prevEnd, now), target_margin_pct: (await settings()).target_margin_pct });
});

// ── Export ─────────────────────────────────────────────────────────
const EXPORTS: Record<string, string> = {
  leads: `SELECT l.created_at, c.name, c.phone, c.email, a.line1 AS address, a.city, a.area, l.service, l.stage, l.lost_reason, l.source, l.source_detail, cp.name AS campaign,
    (SELECT subtotal_cents / 100.0 FROM quotes q WHERE q.lead_id = l.id ORDER BY version DESC LIMIT 1) AS quote_subtotal
    FROM leads l JOIN customers c ON c.id = l.customer_id LEFT JOIN addresses a ON a.id = l.address_id LEFT JOIN campaigns cp ON cp.id = l.campaign_id WHERE l.deleted_at IS NULL ORDER BY l.created_at DESC`,
  customers: "SELECT name, phone, email, address, city, created_at FROM customers WHERE name != '(deleted)' ORDER BY created_at DESC",
  touches: "SELECT t.due_at, t.done_at, t.skipped_at, t.kind, t.title, t.outcome, c.name FROM touches t JOIN leads l ON l.id = t.lead_id JOIN customers c ON c.id = l.customer_id ORDER BY t.due_at DESC",
  events: "SELECT ts, type, lead_id, job_id, campaign_id, value_cents, meta FROM events ORDER BY ts DESC",
};
crm.get("/api/crm/export/:what", async (c) => {
  const sql = EXPORTS[c.req.param("what").replace(/\.csv$/, "")];
  if (!sql) return c.json({ error: "Unknown export" }, 404);
  return new Response(csv(await query(sql)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${c.req.param("what").replace(/\.csv$/, "")}-${torontoDate(Date.now())}.csv"` } });
});

