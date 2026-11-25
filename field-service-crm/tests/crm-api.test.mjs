// End to end against a real local Worker + D1: website webhook, Gmail intake, QR flow, quote → job → invoice with the Ontario rules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "solid-crm-test-"));
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };
let server, base, logs = "";
const SECRET = "dev-netlify-secret", EMAIL_KEY = "dev-email-key";

async function call(method, path, body, status = 200, headers = {}) {
  const r = await fetch(base + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await r.text();
  assert.equal(r.status, status, `${method} ${path}: ${text.slice(0, 400)}`);
  return r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
}
const b64url = (b) => Buffer.from(b).toString("base64url");
async function netlifySign(body, secret = SECRET) {
  const sha = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))).toString("hex");
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64url(JSON.stringify({ iss: "netlify", sha256: sha }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${h}.${p}.${b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${p}`)))}`;
}

before(async () => {
  mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
  execFileSync(process.execPath, ["scripts/setup-db.mjs", directory], { env, encoding: "utf8" });
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [wrangler, "dev", "--local", "--port", String(port), "--persist-to", directory, "--inspector-port", "0", "--test-scheduled"], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => { logs += d; });
  server.stderr.on("data", (d) => { logs += d; });
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(base + "/api/stats")).ok) return; } catch {}
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Worker did not start: " + logs);
});
after(async () => {
  if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
  rmSync(directory, { recursive: true, force: true });
});

test("website webhook → lead with 9 touches, consent, dedupe", async () => {
  const body = JSON.stringify({ form_name: "quick-quote", data: { name: "Jane Doe", phone: "(416) 555-0199", service: "Interlocking Driveways", sqft: "500-800", timing: "Spring 2027", area: "Mississauga", page: "/interlocking-driveways/", src: "gbp", sms_consent: "yes" } });
  await call("POST", "/api/intake", body, 401, { "x-webhook-signature": await netlifySign(body, "wrong") });
  const r = await call("POST", "/api/intake", body, 200, { "x-webhook-signature": await netlifySign(body) });
  assert.equal(r.merged, false);
  const d = await call("GET", `/api/crm/leads/${r.lead_id}`);
  assert.equal(d.lead.phone, "+14165550199");
  assert.equal(d.lead.source, "website");
  assert.equal(d.touches.length, 9);
  assert.equal(d.consent.sms, true);
  assert.ok(d.consent.records.some((c) => c.basis === "express" && c.text_shown.includes("Reply STOP")));
  // same phone again (the long form) within 24 h joins the same lead
  const body2 = JSON.stringify({ form_name: "quote", data: { name: "Jane", phone: "416-555-0199", details: "Also the walkway" } });
  const r2 = await call("POST", "/api/intake", body2, 200, { "x-webhook-signature": await netlifySign(body2) });
  assert.equal(r2.lead_id, r.lead_id);
  assert.equal(r2.merged, true);
  const today = await call("GET", "/api/crm/today");
  assert.equal(today.fresh.filter((l) => l.id === r.lead_id).length, 1);
});

test("Gmail intake: key required, triage, convert to lead", async () => {
  const messages = [
    { id: "m1", threadId: "t1", from: "Bob Smith <bob.smith@gmail.com>", subject: "Retaining wall estimate", body: "Hi, could you give me a price for a retaining wall in my backyard? 905-555-0123", date: "2026-11-04T15:00:00Z", category: "primary" },
    { id: "m2", from: "SEO Pro <x@seo.io>", subject: "Rank on the first page of Google", body: "backlinks", date: "2026-11-04T15:00:00Z" },
    { id: "m3", from: "Promo <no-reply@store.com>", subject: "Sale", body: "unsubscribe", category: "promotions", date: "2026-11-04T15:00:00Z" },
  ];
  await call("POST", "/api/intake/email", { messages }, 401, { authorization: "Bearer nope" });
  assert.equal((await call("POST", "/api/intake/email", { messages }, 200, { authorization: `Bearer ${EMAIL_KEY}` })).added, 3);
  assert.equal((await call("POST", "/api/intake/email", { messages }, 200, { authorization: `Bearer ${EMAIL_KEY}` })).added, 0); // idempotent
  const inbox = await call("GET", "/api/crm/emails?category=all");
  assert.deepEqual(Object.fromEntries(inbox.emails.map((e) => [e.id, e.category])), { m1: "lead", m2: "spam", m3: "other" });
  const conv = await call("POST", "/api/crm/emails/m1/convert", {}, 201);
  const d = await call("GET", `/api/crm/leads/${conv.lead_id}`);
  assert.equal(d.lead.phone, "+19055550123");
  assert.equal(d.lead.source, "email");
});

test("QR: street-only page, deduped scan, form → lead with the full address; warm list", async () => {
  const { id } = await call("POST", "/api/crm/campaigns", { name: "Lorne Park postcards", channel: "postcard", area: "Lorne Park", pieces: 2, cost_cents: 200, start_date: "2026-11-01" }, 201);
  assert.equal((await call("POST", `/api/crm/campaigns/${id}/codes`, { addresses: "1234 Lorne Park Rd, Mississauga, L5H 2Z9\n77 Indian Rd, Mississauga, L5H 1R5" })).made, 2);
  const { codes } = await call("GET", `/api/crm/campaigns/${id}/codes`);
  const c1 = codes.find((c) => c.line1.startsWith("1234")), c2 = codes.find((c) => c.line1.startsWith("77"));
  const pageHtml = await call("GET", `/q/${c1.code.toLowerCase()}`);
  assert.match(pageHtml, /Lorne Park Rd/);
  assert.doesNotMatch(pageHtml, /1234|L5H|2Z9/); // never the full address
  await call("GET", `/q/${c1.code}`);
  await call("GET", `/q/${c2.code}`);
  const after = (await call("GET", `/api/crm/campaigns/${id}/codes`)).codes;
  assert.equal(after.find((c) => c.code === c1.code).scans, 1); // second scan within the hour not counted
  const thanks = await call("POST", `/q/${c1.code}`, "name=Tom&phone=6475550111&service=Retaining+Walls&timing=Spring+2027&sms_consent=yes", 200, { "Content-Type": "application/x-www-form-urlencoded" });
  assert.match(thanks, /Thanks, <b>Tom/);
  const { leads } = await call("GET", "/api/crm/leads?q=Tom");
  assert.equal(leads[0].line1, "1234 Lorne Park Rd");
  assert.equal(leads[0].source, "qr");
  const warm = (await call("GET", "/api/crm/warm")).warm;
  assert.deepEqual(warm.map((w) => w.code), [c2.code]);
  const csvText = await call("GET", `/api/crm/campaigns/${id}/codes?format=csv`);
  assert.match(csvText, /^code,url,address,city,postal,greeting_street\n/);
});

test("quote → accept online → job (cooling-off) → invoice (10% cap) → numbers", async () => {
  const { lead_id } = await call("POST", "/api/crm/leads", { name: "Ann Lee", phone: "416-555-0142", service: "Interlocking Driveways", source: "referral", line1: "9 Oak Ave", city: "Mississauga" }, 201);
  const { id: qid } = await call("POST", `/api/crm/leads/${lead_id}/quotes`, {}, 201);
  const put = await call("PUT", `/api/crm/quotes/${qid}`, { notes: "Herringbone, soldier border", signed_at_home: true, lines: [{ item: "Interlock driveway", qty: 600, unit: "sq ft", unit_cents: 3200, cost_cents: 1800 }] });
  assert.equal(put.subtotal_cents, 1_920_000);
  assert.equal(put.tax_cents, 249_600);
  assert.equal(put.margin_pct, 43.8);
  const { token } = await call("POST", `/api/crm/quotes/${qid}/send`, {});
  await call("PUT", `/api/crm/quotes/${qid}`, { lines: [] }, 400); // sent quotes are locked
  const qpage = await call("GET", `/api/quote/${token}`);
  assert.match(qpage, /\$21,696\.00/);
  assert.doesNotMatch(qpage, /9 Oak Ave/);
  await call("GET", `/api/quote/${"0".repeat(32)}`, undefined, 404);
  const acc = await call("POST", `/api/quote/${token}/accept`, "name=Ann+Lee&agree=yes", 200, { "Content-Type": "application/x-www-form-urlencoded" });
  assert.match(acc, /Accepted/);
  const d = await call("GET", `/api/crm/leads/${lead_id}`);
  assert.equal(d.lead.stage, "won");
  const ends = d.quotes[0].cooling_off_ends;
  assert.match(ends, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(d.touches.every((t) => t.done_at || t.skipped_at)); // follow-up paused on won
  // cooling-off: cannot schedule on/before the last cancel day
  const blocked = await call("POST", `/api/crm/leads/${lead_id}/job`, { scheduled_date: ends }, 400);
  assert.match(blocked.error, /cooling-off/);
  const later = new Date(Date.parse(ends + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  const { job_id } = await call("POST", `/api/crm/leads/${lead_id}/job`, { scheduled_date: later }, 201);
  await call("PUT", `/api/jobs/${job_id}`, { scheduled_date: ends }, 409); // base reschedule is guarded too
  // 10% cap on manual invoices; invoice from the quote is fine
  const cust = d.lead.customer_id;
  const over = await call("POST", "/api/invoices", { customer_id: cust, job_id, tax_rate: 13, lines: [{ description: "x", quantity: 1, unit_price: 21_200 }] }, 409);
  assert.match(over.error, /more than 10%/);
  await call("POST", "/api/invoices", { customer_id: cust, job_id, tax_rate: 13, lines: [{ description: "x", quantity: 1, unit_price: 21_000 }] }, 201);
  const inv = await call("POST", `/api/jobs/${job_id}/invoice`, undefined, 201);
  const { invoice } = await call("GET", `/api/invoices/${inv.invoice_id}`);
  assert.equal(invoice.total, 21_696);
  await call("PUT", `/api/jobs/${job_id}`, { status: "completed" });
  await call("PUT", `/api/invoices/${inv.invoice_id}`, { status: "paid" });
  const n = await call("GET", "/api/crm/numbers?period=year");
  assert.equal(n.now.revenue_booked_cents, 1_920_000);
  assert.equal(n.now.revenue_collected_cents, 2_169_600);
  assert.ok(n.now.leads >= 4);
});

test("website form (replaces Netlify): lead + photo, then back to /thanks/", async () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ "form-name": "quote", name: "Rita Gomes", phone: "289-555-0161", service: "Sod Installation", area: "Oakville", timing: "Spring 2027", details: "Backyard, about 900 sq ft", sms_consent: "yes", page: "/sod-installation/" })) fd.append(k, v);
  fd.append("photo", new Blob([new Uint8Array([255, 216, 255, 224, 1, 2, 3])], { type: "image/jpeg" }), "yard.jpg");
  const r = await fetch(base + "/api/form", { method: "POST", body: fd, redirect: "manual", headers: { origin: "https://solidlandscapeinc.com" } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "https://solidlandscapeinc.com/thanks/");
  const { leads } = await call("GET", "/api/crm/leads?q=Rita");
  const d = await call("GET", `/api/crm/leads/${leads[0].id}`);
  assert.equal(d.lead.source_detail, "quote");
  assert.equal(d.lead.area, "Oakville");
  assert.equal(d.photos.length, 1);
  assert.equal(d.consent.sms, true);
  const bot = await fetch(base + "/api/form", { method: "POST", body: new URLSearchParams({ name: "x", phone: "4165550100", company: "spam inc" }), redirect: "manual" });
  assert.equal(bot.status, 303); // honeypot: silently thanked, nothing saved
  assert.equal((await call("GET", "/api/crm/leads?q=spam")).leads.length, 0);
  const nul = await fetch(base + "/api/form", { method: "POST", body: new URLSearchParams({ name: "Null Origin", phone: "4165550177" }), headers: { origin: "null" }, redirect: "manual" });
  assert.equal(nul.status, 303); // privacy-mode browsers send Origin: null; they must not be refused
  assert.equal(nul.headers.get("location"), "https://solidlandscapeinc.com/thanks/");
});

test("private API blocks cross-site writes", async () => {
  await call("POST", "/api/crm/leads", { name: "X", phone: "4165550100" }, 403, { origin: "https://evil.example" });
  await call("POST", "/api/crm/leads", { name: "X", phone: "4165550100" }, 403, { "sec-fetch-site": "cross-site" });
});

test("intake rejects junk input", async () => {
  await call("POST", "/api/crm/leads", { name: "No contact", source: "phone" }, 400);
  await call("POST", "/api/crm/leads", { name: "", phone: "4165550100" }, 400);
  await call("GET", "/q/NOTACODE", undefined, 404);
});

test("daily cron writes a backup to R2 that restores into an empty database", async () => {
  assert.equal((await fetch(base + "/__scheduled?cron=0+12+*+*+*")).status, 200);
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const out = join(directory, "backup.json");
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    try { execFileSync(process.execPath, [wrangler, "r2", "object", "get", `solid-crm-files/backups/${day}.json`, "--local", "--persist-to", directory, "--file", out], { env, stdio: "ignore" }); ok = true; }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  assert.ok(ok, "backup object not found in R2");
  const dump = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(dump.leads.length >= 4 && dump.quotes.length >= 1 && dump.customers.length >= 4);
  const fresh = mkdtempSync(join(tmpdir(), "solid-crm-restore-"));
  try {
    execFileSync(process.execPath, ["scripts/setup-db.mjs", fresh], { env, encoding: "utf8" });
    execFileSync(process.execPath, ["scripts/restore-backup.mjs", out, "--persist-to", fresh], { env, encoding: "utf8" });
    const q = (sql) => JSON.parse(execFileSync(process.execPath, [wrangler, "d1", "execute", "solid-crm-db", "--local", "--persist-to", fresh, "--command", sql, "--json"], { env, encoding: "utf8" }))[0].results;
    assert.equal(q("SELECT COUNT(*) AS n FROM leads")[0].n, dump.leads.length);
    assert.equal(q("SELECT COUNT(*) AS n FROM touches")[0].n, dump.touches.length);
    assert.equal(q("SELECT total_cents FROM quotes WHERE status = 'accepted'")[0].total_cents, 2_169_600);
  } finally { rmSync(fresh, { recursive: true, force: true }); }
});
