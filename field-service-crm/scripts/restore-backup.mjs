// Restore a daily backup (backups/YYYY-MM-DD.json from R2) into D1.
//   Download:  npx wrangler r2 object get solid-crm-files/backups/2026-11-04.json --remote --file backup.json
//   Restore:   node scripts/restore-backup.mjs backup.json [--remote | --persist-to <dir>]
// Replaces every table's rows with the backup's. Test on a local copy first.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error("Usage: node scripts/restore-backup.mjs backup.json [--remote | --persist-to <dir>]"); process.exit(1); }
const dump = JSON.parse(readFileSync(file, "utf8"));
const target = rest.includes("--remote") ? ["--remote"] : ["--local", ...(rest.includes("--persist-to") ? ["--persist-to", rest[rest.indexOf("--persist-to") + 1]] : [])];

const lit = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL") : `'${String(v).replace(/'/g, "''")}'`;
const ident = (s) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error("Bad name in backup: " + s); return `"${s}"`; };

const sql = ["PRAGMA defer_foreign_keys = ON;"];
for (const [table, rows] of Object.entries(dump)) {
  sql.push(`DELETE FROM ${ident(table)};`);
  for (const row of rows) {
    const cols = Object.keys(row);
    sql.push(`INSERT INTO ${ident(table)} (${cols.map(ident).join(", ")}) VALUES (${cols.map((c) => lit(row[c])).join(", ")});`);
  }
}
const dir = mkdtempSync(join(tmpdir(), "solid-restore-"));
try {
  const out = join(dir, "restore.sql");
  writeFileSync(out, sql.join("\n"));
  const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  execFileSync(process.execPath, [wrangler, "d1", "execute", "solid-crm-db", ...target, "--file", out, ...(rest.includes("--remote") ? [] : [])], { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  console.log(`Restored ${Object.values(dump).reduce((a, r) => a + r.length, 0)} rows across ${Object.keys(dump).length} tables.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
