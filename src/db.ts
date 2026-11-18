import type { Edge, Product, Release } from "./types";

export const normModel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function searchProducts(db: D1Database, q: { query?: string; vendor?: string; limit?: number }): Promise<Product[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.query) {
    where.push("(model_norm LIKE ? OR lower(family) LIKE ?)");
    binds.push(`%${normModel(q.query)}%`, `%${q.query.toLowerCase()}%`);
  }
  if (q.vendor) {
    where.push("lower(vendor) LIKE ?");
    binds.push(`%${q.vendor.toLowerCase()}%`);
  }
  const sql = `SELECT * FROM products ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY vendor, model LIMIT ?`;
  binds.push(Math.min(q.limit ?? 20, 100));
  const r = await db.prepare(sql).bind(...binds).all<Product>();
  return r.results;
}

/** Presná zhoda na normalizovaný model, inak najlepšia čiastočná zhoda. */
export async function findProduct(db: D1Database, model: string, vendor?: string): Promise<Product | null> {
  const n = normModel(model);
  const vendorClause = vendor ? " AND lower(vendor) LIKE ?" : "";
  const vb = vendor ? [`%${vendor.toLowerCase()}%`] : [];
  const exact = await db.prepare(`SELECT * FROM products WHERE model_norm = ?${vendorClause} LIMIT 1`).bind(n, ...vb).first<Product>();
  if (exact) return exact;
  return db
    .prepare(`SELECT * FROM products WHERE model_norm LIKE ?${vendorClause} ORDER BY length(model_norm) LIMIT 1`)
    .bind(`%${n}%`, ...vb)
    .first<Product>();
}

export async function getReleases(db: D1Database, os: string): Promise<Release[]> {
  return (await db.prepare("SELECT * FROM releases WHERE lower(os) = lower(?)").bind(os).all<Release>()).results;
}

export async function getRelease(db: D1Database, os: string, version: string): Promise<Release | null> {
  return db.prepare("SELECT * FROM releases WHERE lower(os) = lower(?) AND version = ?").bind(os, version).first<Release>();
}

export async function getEdges(db: D1Database, os: string): Promise<Edge[]> {
  return (await db.prepare("SELECT * FROM upgrade_edges WHERE lower(os) = lower(?)").bind(os).all<Edge>()).results;
}

export async function listOS(db: D1Database): Promise<string[]> {
  const r = await db.prepare("SELECT DISTINCT os FROM releases ORDER BY os").all<{ os: string }>();
  return r.results.map((x) => x.os);
}

export async function upcoming(db: D1Database, from: string, to: string, vendor?: string) {
  const vb = vendor ? [`%${vendor.toLowerCase()}%`] : [];
  const vc = vendor ? " AND lower(vendor) LIKE ?" : "";
  const products = await db
    .prepare(
      `SELECT id, vendor, model, kind, eos_date, eol_date, replacement, verified FROM products
       WHERE ((eol_date BETWEEN ? AND ?) OR (eos_date BETWEEN ? AND ?))${vc}
       ORDER BY coalesce(eos_date, eol_date)`
    )
    .bind(from, to, from, to, ...vb)
    .all();
  const releases = await db
    .prepare("SELECT os, version, eol_date, recommended, verified FROM releases WHERE eol_date BETWEEN ? AND ? ORDER BY eol_date")
    .bind(from, to)
    .all();
  return { products: products.results, releases: releases.results };
}
