// Shared lead logic: one path for every source (website, QR, Gmail, manual).
import { query, get, run } from "./db.ts";
import { followUpSchedule, toE164, bindingQuote, torontoToUtc, OPEN_STAGES, prettyPhone } from "./rules.ts";

export type Bindings = {
  DB: D1Database;
  PHOTOS?: R2Bucket;
  ASSETS?: Fetcher;
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  TELEGRAM_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  NETLIFY_JWS_SECRET?: string;
  EMAIL_INTAKE_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAILS?: string;
  APP_URL?: string;
  QR_BASE?: string;
  DEV?: string;
};
export type Env = { Bindings: Bindings };

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

export async function logEvent(type: string, f: { lead_id?: string | null; job_id?: string | null; campaign_id?: string | null; value_cents?: number; meta?: object; ts?: string } = {}) {
  await run("INSERT INTO events (id, ts, type, lead_id, job_id, campaign_id, value_cents, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    uid(), f.ts ?? nowIso(), type, f.lead_id ?? null, f.job_id ?? null, f.campaign_id ?? null, f.value_cents ?? 0, JSON.stringify(f.meta ?? {}),
  ]);
}

export async function notify(env: Bindings, text: string) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
  } catch {
    // An alert failure must never lose the lead; the Today tab still shows it.
  }
}

export type LeadInput = {
  name: string; phone?: string; email?: string;
  service?: string; size_hint?: string; timing?: string; details?: string;
  source: string; source_detail?: string; campaign_id?: string | null; page?: string; utm?: string;
  address?: { line1?: string; city?: string; postal?: string; area?: string };
  address_id?: string | null;
  sms_express?: boolean; consent_text?: string;
};

const clip = (s: string | undefined, n = 2000) => (s ?? "").trim().slice(0, n);

export async function createLead(env: Bindings, input: LeadInput) {
  const phone = toE164(input.phone);
  const email = clip(input.email, 200).toLowerCase();
  const name = clip(input.name, 120) || (email ? email.split("@")[0] : "Unknown");
  if (!phone && !email) throw new Error("A phone number or an email is required");

  // Same phone (or email) = same customer
  let customer = phone ? await get<{ id: string; email: string; name: string }>("SELECT id, email, name FROM customers WHERE phone = ? ORDER BY created_at LIMIT 1", [phone]) : undefined;
  if (!customer && email) customer = await get("SELECT id, email, name FROM customers WHERE lower(email) = ? ORDER BY created_at LIMIT 1", [email]);
  if (customer) {
    await run("UPDATE customers SET email = CASE WHEN email = '' THEN ? ELSE email END, phone = CASE WHEN phone = '' THEN ? ELSE phone END, updated_at = datetime('now') WHERE id = ?", [email, phone ?? "", customer.id]);
  } else {
    customer = (await get<{ id: string; email: string; name: string }>("INSERT INTO customers (name, email, phone) VALUES (?, ?, ?) RETURNING id, email, name", [name, email, phone ?? ""]))!;
  }

  let addressId = input.address_id ?? null;
  const a = input.address;
  if (!addressId && a && (a.line1 || a.area || a.city)) {
    addressId = uid();
    await run("INSERT INTO addresses (id, line1, city, postal, area, municipality) VALUES (?, ?, ?, ?, ?, ?)", [addressId, clip(a.line1, 200), clip(a.city, 80), clip(a.postal, 10).toUpperCase(), clip(a.area, 80), clip(a.city, 80)]);
    if (a.line1) await run("UPDATE customers SET address = CASE WHEN address = '' THEN ? ELSE address END, city = CASE WHEN city = '' THEN ? ELSE city END WHERE id = ?", [clip(a.line1, 200), clip(a.city, 80), customer.id]);
  }

  // A second form from the same person within 24 h joins the open lead (no second schedule or ping)
  const open = await get<{ id: string; details: string }>(
    `SELECT id, details FROM leads WHERE customer_id = ? AND deleted_at IS NULL AND stage IN ('new','contacted','visit','quoted') AND created_at > ? ORDER BY created_at DESC LIMIT 1`,
    [customer.id, new Date(Date.now() - 86_400_000).toISOString()],
  );
  if (open) {
    await run(
      `UPDATE leads SET details = trim(details || char(10) || ?), service = CASE WHEN service = '' THEN ? ELSE service END, size_hint = CASE WHEN size_hint = '' THEN ? ELSE size_hint END,
       timing = CASE WHEN timing = '' THEN ? ELSE timing END, address_id = COALESCE(address_id, ?) WHERE id = ?`,
      [clip(input.details), clip(input.service, 80), clip(input.size_hint, 80), clip(input.timing, 80), addressId, open.id],
    );
    await logEvent("lead_merged", { lead_id: open.id, meta: { source: input.source } });
    await addConsents(customer.id, input);
    return { lead_id: open.id, customer_id: customer.id, merged: true };
  }

  const leadId = uid();
  const created = Date.now();
  await run(
    `INSERT INTO leads (id, customer_id, address_id, service, size_hint, timing, details, source, source_detail, campaign_id, page, utm, created_at, stage_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadId, customer.id, addressId, clip(input.service, 80), clip(input.size_hint, 80), clip(input.timing, 80), clip(input.details), clip(input.source, 30), clip(input.source_detail, 200), input.campaign_id ?? null, clip(input.page, 200), clip(input.utm, 300), new Date(created).toISOString(), new Date(created).toISOString()],
  );
  for (const t of followUpSchedule(created)) {
    await run("INSERT INTO touches (id, lead_id, step, kind, title, template_key, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [uid(), leadId, t.step, t.kind, t.title, t.template_key, t.due_at]);
  }
  await addConsents(customer.id, input);
  await logEvent("lead_created", { lead_id: leadId, campaign_id: input.campaign_id, meta: { source: input.source } });
  const where = a?.area || a?.city || "";
  await notify(env, `🔥 New lead (${input.source}${input.source_detail ? " · " + input.source_detail : ""})\n${name}${phone ? " · " + prettyPhone(phone) : ""}\n${[input.service, input.size_hint, input.timing, where].filter(Boolean).join(" · ")}\nCall within 60 min → ${env.APP_URL ?? ""}/leads/${leadId}`);
  return { lead_id: leadId, customer_id: customer.id, merged: false };
}

async function addConsents(customerId: string, input: LeadInput) {
  const source = input.source + (input.page ? " " + input.page : "");
  const has = async (channel: string, basis: string) => !!(await get("SELECT 1 FROM consents WHERE customer_id = ? AND channel = ? AND basis = ? AND withdrawn_at IS NULL", [customerId, channel, basis]));
  for (const channel of ["sms", "email"]) {
    // CASL: an inquiry gives implied consent for 6 months; record it fresh each inquiry
    await run("INSERT INTO consents (id, customer_id, channel, basis, text_shown, source) VALUES (?, ?, ?, 'implied-inquiry', '', ?)", [uid(), customerId, channel, source]);
  }
  if (input.sms_express && !(await has("sms", "express"))) {
    await run("INSERT INTO consents (id, customer_id, channel, basis, text_shown, source) VALUES (?, ?, 'sms', 'express', ?, ?)", [uid(), customerId, clip(input.consent_text, 300), source]);
  }
}

type QuoteRow = { id: string; version: number; total_cents: number; subtotal_cents: number; cost_cents: number; accepted_at: string | null; signed_at_home: number; cooling_off_ends: string; waiver_text: string; status: string };
export const leadQuotes = (leadId: string) => query<QuoteRow>("SELECT * FROM quotes WHERE lead_id = ? ORDER BY version", [leadId]);

export async function setStage(leadId: string, to: string, opts: { reason?: string; later_until?: string } = {}) {
  const lead = await get<{ stage: string; campaign_id: string | null }>("SELECT stage, campaign_id FROM leads WHERE id = ?", [leadId]);
  if (!lead) throw new Error("Lead not found");
  if (lead.stage === to) return;
  const q = bindingQuote(await leadQuotes(leadId)) ?? (await leadQuotes(leadId)).filter((x) => x.status === "sent").pop();
  const value = to === "won" ? q?.subtotal_cents ?? 0 : 0;
  await run("UPDATE leads SET stage = ?, stage_changed_at = ?, lost_reason = ?, later_until = ? WHERE id = ?", [to, nowIso(), to === "lost" ? opts.reason ?? "" : "", to === "later" ? opts.later_until ?? "" : "", leadId]);
  await logEvent("stage_changed", { lead_id: leadId, campaign_id: lead.campaign_id, value_cents: value, meta: { from: lead.stage, to, reason: opts.reason ?? "", cost_cents: to === "won" ? q?.cost_cents ?? 0 : undefined } });
  if (!OPEN_STAGES.includes(to)) {
    // Pause the follow-up: won, lost or "later" stop the remaining touches
    await run("UPDATE touches SET skipped_at = ? WHERE lead_id = ? AND done_at IS NULL AND skipped_at IS NULL", [nowIso(), leadId]);
  }
  if (to === "later" && opts.later_until) {
    const [y, m, d] = opts.later_until.split("-").map(Number);
    await run("INSERT INTO touches (id, lead_id, step, kind, title, template_key, due_at) VALUES (?, ?, 99, 'call', 'Re-contact (they said later)', 'recontact', ?)", [uid(), leadId, new Date(torontoToUtc(y, m, d, 10)).toISOString()]);
  }
}

export async function settings() {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM _meta WHERE key LIKE 'crm_%'");
  const s = Object.fromEntries(rows.map((r) => [r.key.slice(4), r.value]));
  return {
    owner_name: s.owner_name ?? "Serhii",
    business: s.business ?? "Solid Landscaping",
    phone: s.phone ?? "437-299-1681",
    review_link: s.review_link ?? "https://solidlandscapeinc.com/review",
    labour_rate_cents: Number(s.labour_rate_cents ?? 0),
    target_margin_pct: Number(s.target_margin_pct ?? 40),
  };
}
