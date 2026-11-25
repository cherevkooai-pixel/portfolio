// Worker entry: public routes → Cloudflare Access check → CRM API → base field-service API → static UI.
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { ZodError } from "zod";
import { initDB, query, run } from "./db.ts";
import base from "./index.ts";
import { crm, Bad } from "./crm.ts";
import { pub, PUBLIC_PATHS } from "./public.ts";
import { notify, type Env, type Bindings } from "./leads.ts";
import { focusMessage } from "./focus.ts";
import { verifyAccessJwt, torontoDate, addDays, torontoToUtc } from "./rules.ts";

const app = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => (i.path.length ? i.path.join(".") + ": " : "") + i.message).join("; ") }, 400);
  if (err instanceof Bad) return c.json({ error: err.message }, 400);
  console.error(err);
  return c.json({ error: "Something went wrong. Nothing was lost; try again." }, 500);
});

app.use("*", async (c, next) => {
  initDB(c.env);
  await next();
  c.res = new Response(c.res.body, c.res); // static-asset responses have immutable headers
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("x-frame-options", "DENY");
  if (!c.res.headers.has("referrer-policy")) c.res.headers.set("referrer-policy", "same-origin");
});

// Printed short links: go.solidlandscapeinc.com/AB12CD
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (!url.hostname.startsWith("go.")) return next();
  const m = url.pathname.match(/^\/([0-9A-Za-z-]{6,8})\/?$/);
  if (m) return app.fetch(new Request(`${url.origin}/q/${m[1]}`, c.req.raw), c.env, c.executionCtx);
  // go. is fully public but serves only the public routes; the private app lives on crm. behind Access.
  if (PUBLIC_PATHS.some((re) => re.test(url.pathname))) return next();
  return c.redirect("https://solidlandscapeinc.com", 302);
});

app.route("/", pub);

// Everything below is the owner's app: require a valid Cloudflare Access login.
let certs: { at: number; jwks: any } | null = null;
async function jwks(team: string, fresh = false) {
  if (!certs || fresh || Date.now() - certs.at > 3600_000) {
    certs = { at: Date.now(), jwks: await (await fetch(`${team.replace(/\/$/, "")}/cdn-cgi/access/certs`)).json() };
  }
  return certs.jwks;
}

app.use("*", async (c, next) => {
  if (c.env.DEV === "1") return next(); // local `wrangler dev` only (.dev.vars)
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  if (!team || !aud) return c.text("Login is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD).", 503);
  const token = c.req.header("cf-access-jwt-assertion") ?? getCookie(c, "CF_Authorization");
  let email = await verifyAccessJwt(token, await jwks(team), aud);
  if (!email && token && certs && Date.now() - certs.at > 300_000) email = await verifyAccessJwt(token, await jwks(team, true), aud); // key rotation
  const allowed = (c.env.OWNER_EMAILS ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!email || !allowed.includes(email)) return c.text("Forbidden", 403);
  await next();
});

// CSRF: writes must come from the CRM's own pages, never another site riding the Access cookie.
app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  if ((origin && new URL(origin).host !== new URL(c.req.url).host) || (site && !["same-origin", "none"].includes(site))) return c.json({ error: "Cross-site request blocked" }, 403);
  await next();
});

app.route("/", crm);
app.route("/", base);
app.notFound((c) => (c.env.ASSETS && !c.req.path.startsWith("/api/") ? c.env.ASSETS.fetch(c.req.raw) : c.json({ error: "Not found" }, 404)));

// ── Daily 7–8 am: digest to Telegram, backup to R2, privacy purge ──
export async function backup(env: Bindings) {
  if (!env.PHOTOS) return null;
  const tables = await query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'");
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) dump[t.name] = await query(`SELECT * FROM "${t.name.replace(/"/g, "")}"`);
  const key = `backups/${torontoDate(Date.now())}.json`;
  await env.PHOTOS.put(key, JSON.stringify(dump), { httpMetadata: { contentType: "application/json" } });
  const cutoff = `backups/${addDays(torontoDate(Date.now()), -30)}`;
  const old = await env.PHOTOS.list({ prefix: "backups/" });
  for (const o of old.objects) if (o.key < cutoff) await env.PHOTOS.delete(o.key);
  return key;
}

async function daily(env: Bindings) {
  initDB(env);
  await notify(env, focusMessage(torontoDate(Date.now())));
  const [y, m, d] = addDays(torontoDate(Date.now()), 1).split("-").map(Number);
  const end = new Date(torontoToUtc(y, m, d)).toISOString();
  const one = async (sql: string, p: unknown[] = []) => ((await query<{ n: number }>(sql, p))[0]?.n ?? 0);
  const fresh = await one("SELECT COUNT(*) AS n FROM leads l WHERE l.stage = 'new' AND l.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM touches t WHERE t.lead_id = l.id AND t.done_at IS NOT NULL)");
  const due = await one("SELECT COUNT(*) AS n FROM touches t JOIN leads l ON l.id = t.lead_id WHERE t.done_at IS NULL AND t.skipped_at IS NULL AND t.due_at < ? AND l.deleted_at IS NULL", [end]);
  const overdue = await one("SELECT COUNT(*) AS n FROM touches t JOIN leads l ON l.id = t.lead_id WHERE t.done_at IS NULL AND t.skipped_at IS NULL AND t.due_at < ? AND l.deleted_at IS NULL", [new Date().toISOString()]);
  const jobs = await one("SELECT COUNT(*) AS n FROM jobs WHERE scheduled_date = ? AND status != 'cancelled'", [torontoDate(Date.now())]);
  const mails = await one("SELECT COUNT(*) AS n FROM emails WHERE category = 'lead' AND dismissed = 0 AND lead_id IS NULL");
  if (fresh + due + jobs + mails) await notify(env, `☀️ Today: ${fresh} new lead${fresh === 1 ? "" : "s"} to call · ${due} follow-ups (${overdue} overdue) · ${jobs} job${jobs === 1 ? "" : "s"} · ${mails} possible lead email${mails === 1 ? "" : "s"}\n→ ${env.APP_URL ?? ""}/`);
  await backup(env);
  // PIPEDA: keep non-lead mail only 90 days
  await run("DELETE FROM emails WHERE category IN ('other', 'spam', 'form') AND lead_id IS NULL AND received_at < ?", [new Date(Date.now() - 90 * 86_400_000).toISOString()]);
}

export default {
  fetch: app.fetch,
  scheduled: (_e: ScheduledController, env: Bindings, ctx: ExecutionContext) => ctx.waitUntil(daily(env)),
};
