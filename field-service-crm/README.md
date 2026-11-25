# Field-service CRM

Forked from [clawnify/OpenFieldService](https://github.com/clawnify/OpenFieldService) (MIT, see LICENSE), with `@clawnify/*` removed (plain Hono + D1 helpers in `src/server/db.ts`).

```
npm install
npm run dev        # sets up local D1, runs Vite (5173) + Wrangler (8787)
npm test
npm run typecheck
```

Built for my landscaping business. On top of the original customers, jobs, calendar, invoices and materials, I added the sales side:

- **Leads and pipeline:** website forms, Gmail (Apps Script in `integrations/`) and QR short links all create leads; new leads ping Telegram.
- **Follow-up:** a 9-touch, 14-day cadence with one-tap SMS/email templates.
- **Quotes:** versioned quote pages customers open from a link.
- **Numbers:** speed to lead, close rate, pipeline, ROI by source, computed from an events table.
- **Security:** the app sits behind Cloudflare Access (JWT checked server-side), and public endpoints are rate-limited.

Deploy: create a D1 database and put its id in `wrangler.toml`, set the secrets listed there with `wrangler secret put`, then `npx wrangler deploy`.
