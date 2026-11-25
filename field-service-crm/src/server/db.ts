// Thin D1 helpers (replaces @clawnify/db). Set per request by the middleware in index.ts.
let db: D1Database | null = null;

export type DBEnv = { DB: D1Database };

export function initDB(env: DBEnv) {
  db = env.DB;
}

function ensure() {
  if (!db) throw new Error("DB not initialized");
  return db;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await ensure().prepare(sql).bind(...params).all<T>()).results ?? [];
}

export async function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await ensure().prepare(sql).bind(...params).first<T>()) ?? undefined;
}

export async function run(sql: string, params: unknown[] = []) {
  const r = await ensure().prepare(sql).bind(...params).run();
  return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) };
}
