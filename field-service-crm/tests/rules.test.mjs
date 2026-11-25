import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/server/rules.ts";

test("money: line totals, HST 13% and margin in integer cents", () => {
  const t = R.quoteTotals([{ qty: 600, unit_cents: 3200, cost_cents: 1800 }, { qty: 1, unit_cents: 150050, cost_cents: 50000 }]);
  assert.equal(t.subtotal_cents, 600 * 3200 + 150050);
  assert.equal(t.tax_cents, Math.round(t.subtotal_cents * 0.13));
  assert.equal(t.total_cents, t.subtotal_cents + t.tax_cents);
  assert.equal(t.cost_cents, 600 * 1800 + 50000);
  assert.equal(R.quoteTotals([{ qty: 1, unit_cents: 1050 }]).tax_cents, 137); // 136.5 rounds half up
  assert.equal(R.quoteTotals([{ qty: 2.5, unit_cents: 333 }]).subtotal_cents, 833);
  assert.equal(R.quoteTotals([]).margin_pct, 0);
});

test("CPA: invoice may exceed the accepted estimate by at most 10%", () => {
  const quotes = [{ version: 1, total_cents: 1_000_000, accepted_at: "2026-11-01T15:00:00Z" }];
  assert.equal(R.invoiceCapCents(1_000_000), 1_100_000);
  assert.equal(R.checkInvoiceCap(1_100_000, quotes), null);
  assert.match(R.checkInvoiceCap(1_100_001, quotes), /more than 10% over/);
  // an accepted change order (newer version) moves the cap
  const withChange = [...quotes, { version: 2, total_cents: 1_300_000, accepted_at: "2026-11-05T15:00:00Z" }];
  assert.equal(R.checkInvoiceCap(1_400_000, withChange), null);
  // a sent-but-unaccepted change order does not
  const pending = [...quotes, { version: 2, total_cents: 1_300_000, accepted_at: null }];
  assert.match(R.checkInvoiceCap(1_200_000, pending), /change-order/);
  assert.equal(R.checkInvoiceCap(9_999_999, []), null);
});

test("CPA: 10-day cooling-off blocks an early start when signed at home", () => {
  const acceptedAt = Date.parse("2026-11-04T23:30:00Z"); // 18:30 Toronto, Nov 4
  assert.equal(R.coolingOffEnds(acceptedAt), "2026-11-14");
  const q = [{ version: 1, total_cents: 1, accepted_at: "2026-11-04T23:30:00Z", signed_at_home: 1, cooling_off_ends: "2026-11-14" }];
  assert.match(R.checkStartDate("2026-11-14", q), /cooling-off runs to 2026-11-14.*2026-11-15/);
  assert.equal(R.checkStartDate("2026-11-15", q), null);
  assert.equal(R.checkStartDate("2026-11-06", [{ ...q[0], waiver_text: "Customer asked to start early, signed." }]), null);
  assert.equal(R.checkStartDate("2026-11-06", [{ ...q[0], signed_at_home: 0 }]), null);
  // late-evening UTC that is already the next day? 03:00Z Nov 5 = 22:00 Toronto Nov 4
  assert.equal(R.coolingOffEnds(Date.parse("2026-11-05T03:00:00Z")), "2026-11-14");
});

test("follow-up: 9 touches over 14 days, inside 8:00–20:00 Toronto, DST-safe", () => {
  const created = R.torontoToUtc(2026, 10, 30, 15, 0); // Fri Oct 30, 15:00 EDT
  const s = R.followUpSchedule(created);
  assert.equal(s.length, 9);
  assert.equal(s[0].due_at, new Date(created + 3600_000).toISOString());
  assert.deepEqual(s.map((x) => x.kind), ["call", "sms", "call", "video", "sms", "call", "email", "sms", "call"]);
  assert.equal(s[8].due_at, "2026-11-13T15:00:00.000Z"); // day 14 = Nov 13 10:00 EST (after DST ends)
  assert.equal(s[2].due_at, "2026-10-31T14:00:00.000Z"); // day 1 10:00 EDT
  for (const x of s) { const h = R.torontoParts(Date.parse(x.due_at)).h; assert.ok(h >= 8 && h < 20, x.due_at); }
  const late = R.followUpSchedule(R.torontoToUtc(2026, 11, 4, 21, 15));
  assert.equal(late[0].due_at, new Date(R.torontoToUtc(2026, 11, 5, 8, 0)).toISOString());
  const early = R.followUpSchedule(R.torontoToUtc(2026, 11, 4, 5, 0));
  assert.equal(early[0].due_at, new Date(R.torontoToUtc(2026, 11, 4, 8, 0)).toISOString());
});

test("CASL: implied consent expires (6 months inquiry, 2 years purchase), express until withdrawn", () => {
  const at = "2026-01-15T12:00:00Z";
  const now = (s) => Date.parse(s);
  assert.ok(R.consentActive([{ channel: "sms", basis: "implied-inquiry", created_at: at }], "sms", now("2026-07-14T12:00:00Z")));
  assert.ok(!R.consentActive([{ channel: "sms", basis: "implied-inquiry", created_at: at }], "sms", now("2026-07-16T12:00:00Z")));
  assert.ok(R.consentActive([{ channel: "sms", basis: "implied-purchase", created_at: at }], "sms", now("2028-01-14T12:00:00Z")));
  assert.ok(!R.consentActive([{ channel: "sms", basis: "implied-purchase", created_at: at }], "sms", now("2028-01-16T12:00:00Z")));
  assert.ok(R.consentActive([{ channel: "sms", basis: "express", created_at: at }], "sms", now("2035-01-01T00:00:00Z")));
  assert.ok(!R.consentActive([{ channel: "sms", basis: "express", created_at: at, withdrawn_at: "2026-02-01T00:00:00Z" }], "sms", now("2026-03-01T00:00:00Z")));
  assert.ok(!R.consentActive([{ channel: "email", basis: "express", created_at: at }], "sms", now("2026-03-01T00:00:00Z")));
});

test("phones normalise to E.164 so the same phone = the same customer", () => {
  for (const raw of ["437-299-1681", "(437) 299 1681", "+1 437 299 1681", "14372991681"]) assert.equal(R.toE164(raw), "+14372991681");
  assert.equal(R.toE164("12345"), null);
  assert.equal(R.toE164("037-299-1681"), null);
  assert.equal(R.prettyPhone("+14372991681"), "437-299-1681");
});

test("QR: Crockford alphabet, 6 chars, forgiving input, street-only display", () => {
  assert.equal(R.QR_ALPHABET.length, 32);
  assert.ok(!/[ILOU]/.test(R.QR_ALPHABET));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const c = R.newQrCode(); assert.match(c, /^[0-9A-HJKMNP-TV-Z]{6}$/); seen.add(c); }
  assert.ok(seen.size > 1990);
  assert.equal(R.normalizeQrCode("ab-o1il"), "AB0111");
  assert.equal(R.normalizeQrCode("ABCDEU"), null);
  assert.equal(R.streetOnly("1234 Lorne Park Rd"), "Lorne Park Rd");
  assert.equal(R.streetOnly("Unit 5, 200 Queen St W, Mississauga ON L5H 1A1"), "Queen St W");
  assert.equal(R.streetOnly("12-345 Mississauga Rd"), "Mississauga Rd");
  assert.equal(R.streetOnly("1234"), "");
});

test("email triage: leads, spam, form copies, bulk mail", () => {
  const lead = R.classifyEmail({ from: "Jane Doe <jane.doe@gmail.com>", subject: "Driveway quote", body: "Hi, how much to redo our interlock driveway in Lorne Park? 416-555-0199" });
  assert.equal(lead.category, "lead");
  assert.equal(R.classifyEmail({ from: "Mike <mike@growthseo.io>", subject: "Rank your landscaping business on the first page of Google", body: "We do SEO and backlinks" }).category, "spam");
  assert.equal(R.classifyEmail({ from: "x@y.com", subject: "hi", body: "", spam: true }).category, "spam");
  assert.equal(R.classifyEmail({ from: "Netlify <formresponses@netlify.com>", subject: "New form submission", body: "driveway quote" }).category, "form");
  assert.equal(R.classifyEmail({ from: "Home Depot <no-reply@homedepot.ca>", subject: "Save on pavers and patio stones", body: "Unsubscribe", category: "promotions" }).category, "other");
  assert.equal(R.classifyEmail({ from: "Mom <mom@gmail.com>", subject: "Dinner Sunday?", body: "See you at 6" }).category, "other");
  assert.deepEqual(R.parseFrom('"Jane Doe" <Jane@Gmail.com>'), { name: "Jane Doe", addr: "jane@gmail.com" });
  assert.equal(R.findPhone("call me at (416) 555-0199 thanks"), "+14165550199");
});

const b64url = (buf) => Buffer.from(buf).toString("base64url");

test("Netlify webhook signature: accepts a valid JWS, rejects tampering", async () => {
  const secret = "s3cret", body = JSON.stringify({ form_name: "quote", data: { name: "A" } });
  const sha = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))).toString("hex");
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64url(JSON.stringify({ iss: "netlify", sha256: sha }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${p}`)));
  const token = `${h}.${p}.${sig}`;
  assert.equal(await R.verifyNetlifyJws(token, body, secret), true);
  assert.equal(await R.verifyNetlifyJws(token, body + " ", secret), false);
  assert.equal(await R.verifyNetlifyJws(token, body, "wrong"), false);
  assert.equal(await R.verifyNetlifyJws(null, body, secret), false);
  assert.equal(await R.verifyNetlifyJws("a.b", body, secret), false);
});

test("Cloudflare Access JWT: signature, audience and expiry checked", async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
  const sign = async (payload, kid = "k1") => {
    const h = b64url(JSON.stringify({ alg: "RS256", kid })), p = b64url(JSON.stringify(payload));
    return `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
  };
  const now = 1_800_000_000, jwks = { keys: [jwk] };
  assert.equal(await R.verifyAccessJwt(await sign({ aud: ["AUD"], exp: now + 60, email: "Owner@Gmail.com" }), jwks, "AUD", now), "owner@gmail.com");
  assert.equal(await R.verifyAccessJwt(await sign({ aud: ["OTHER"], exp: now + 60, email: "a@b.c" }), jwks, "AUD", now), null);
  assert.equal(await R.verifyAccessJwt(await sign({ aud: ["AUD"], exp: now - 1, email: "a@b.c" }), jwks, "AUD", now), null);
  assert.equal(await R.verifyAccessJwt(await sign({ aud: ["AUD"], exp: now + 60, email: "a@b.c" }, "k2"), jwks, "AUD", now), null);
  const good = await sign({ aud: ["AUD"], exp: now + 60, email: "a@b.c" });
  assert.equal(await R.verifyAccessJwt(good.slice(0, -4) + "AAAA", jwks, "AUD", now), null);
});

test("CSV escapes quotes and blocks formula injection but keeps phone numbers", () => {
  assert.equal(R.csv([{ a: 'say "hi"', b: "=HYPERLINK(1)", c: "+14372991681" }]), 'a,b,c\n"say ""hi""",\'=HYPERLINK(1),+14372991681\n');
});

test("templates fill placeholders and leave unknown ones", () => {
  assert.equal(R.fillTemplate("Hi {first}, re {service} {x}", { first: "Jane", service: "driveway" }), "Hi Jane, re driveway {x}");
  assert.equal(R.firstName("  jane doe"), "Jane");
});
