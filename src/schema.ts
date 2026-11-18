// Samoinicializácia DB – rovnaká schéma ako migrations/0001_init.sql.
// Beží raz na izolát; CREATE … IF NOT EXISTS je idempotentné.
import { importDataset } from "./import";
import sample from "../data/sample.json";
import type { Env } from "./types";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, vendor TEXT NOT NULL, family TEXT, model TEXT NOT NULL, model_norm TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'hardware', os TEXT, max_os_version TEXT, eos_date TEXT, eol_date TEXT,
    replacement TEXT, notes TEXT, source_url TEXT, verified INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor)`,
  `CREATE INDEX IF NOT EXISTS idx_products_norm ON products(model_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_products_eol ON products(eol_date)`,
  `CREATE TABLE IF NOT EXISTS releases (
    os TEXT NOT NULL, version TEXT NOT NULL, release_date TEXT, eol_date TEXT, recommended TEXT, notes TEXT,
    source_url TEXT, verified INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (os, version))`,
  `CREATE TABLE IF NOT EXISTS upgrade_edges (
    os TEXT NOT NULL, from_version TEXT NOT NULL, to_version TEXT NOT NULL, min_from TEXT, notes TEXT,
    source_url TEXT, verified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (os, from_version, to_version))`,
];

let ready: Promise<void> | null = null;

export function ensureSchema(env: Env): Promise<void> {
  ready ??= (async () => {
    await env.DB.batch(STATEMENTS.map((s) => env.DB.prepare(s)));
    // Prázdna DB → nahraj ukážkové dáta (verified=false), aby API hneď odpovedalo.
    if (env.AUTO_SEED !== "false") {
      const row = await env.DB.prepare("SELECT (SELECT count(*) FROM products) + (SELECT count(*) FROM releases) AS n").first<{ n: number }>();
      if (!row?.n) await importDataset(env, sample as any);
    }
  })().catch((e) => {
    ready = null; // pri chybe skús nabudúce znova
    throw e;
  });
  return ready;
}
