import { normModel } from "./db";
import { isValidVersion } from "./version";
import type { Edge, Env, Product, Release } from "./types";

export type Dataset = { products?: Partial<Product>[]; releases?: Partial<Release>[]; upgrade_edges?: Partial<Edge>[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v: unknown, field: string, errors: string[], ctx: string) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !DATE.test(v)) { errors.push(`${ctx}: ${field} musí byť YYYY-MM-DD`); return null; }
  return v;
};
const b = (v: unknown) => (v ? 1 : 0);
const n = (v: unknown) => (v === undefined || v === "" ? null : v);

export async function importDataset(env: Env, data: Dataset) {
  const errors: string[] = [];
  const stmts: D1PreparedStatement[] = [];

  for (const [i, p] of (data.products ?? []).entries()) {
    const ctx = `products[${i}]`;
    if (!p.vendor || !p.model) { errors.push(`${ctx}: vendor a model sú povinné`); continue; }
    const id = p.id ?? `${normModel(p.vendor)}:${normModel(p.model)}`;
    stmts.push(env.DB.prepare(
      `INSERT INTO products (id,vendor,family,model,model_norm,kind,os,max_os_version,eos_date,eol_date,replacement,notes,source_url,verified,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(id) DO UPDATE SET vendor=excluded.vendor,family=excluded.family,model=excluded.model,model_norm=excluded.model_norm,
         kind=excluded.kind,os=excluded.os,max_os_version=excluded.max_os_version,eos_date=excluded.eos_date,eol_date=excluded.eol_date,
         replacement=excluded.replacement,notes=excluded.notes,source_url=excluded.source_url,verified=excluded.verified,updated_at=datetime('now')`
    ).bind(
      id, p.vendor, n(p.family), p.model, normModel(p.model), p.kind ?? "hardware", n(p.os), n(p.max_os_version),
      dateOrNull(p.eos_date, "eos_date", errors, ctx), dateOrNull(p.eol_date, "eol_date", errors, ctx),
      n(p.replacement), n(p.notes), n(p.source_url), b(p.verified),
    ));
  }

  for (const [i, r] of (data.releases ?? []).entries()) {
    const ctx = `releases[${i}]`;
    if (!r.os || !r.version || !isValidVersion(r.version)) { errors.push(`${ctx}: os a platná version sú povinné`); continue; }
    stmts.push(env.DB.prepare(
      `INSERT INTO releases (os,version,release_date,eol_date,recommended,notes,source_url,verified,updated_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(os,version) DO UPDATE SET release_date=excluded.release_date,eol_date=excluded.eol_date,recommended=excluded.recommended,
         notes=excluded.notes,source_url=excluded.source_url,verified=excluded.verified,updated_at=datetime('now')`
    ).bind(
      r.os, r.version, dateOrNull(r.release_date, "release_date", errors, ctx), dateOrNull(r.eol_date, "eol_date", errors, ctx),
      n(r.recommended), n(r.notes), n(r.source_url), b(r.verified),
    ));
  }

  for (const [i, e] of (data.upgrade_edges ?? []).entries()) {
    const ctx = `upgrade_edges[${i}]`;
    if (!e.os || !e.from_version || !e.to_version) { errors.push(`${ctx}: os, from_version, to_version sú povinné`); continue; }
    stmts.push(env.DB.prepare(
      `INSERT INTO upgrade_edges (os,from_version,to_version,min_from,notes,source_url,verified) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(os,from_version,to_version) DO UPDATE SET min_from=excluded.min_from,notes=excluded.notes,
         source_url=excluded.source_url,verified=excluded.verified`
    ).bind(e.os, e.from_version, e.to_version, n(e.min_from), n(e.notes), n(e.source_url), b(e.verified)));
  }

  if (errors.length) return { ok: false, errors };
  // D1 batch = jedna transakcia
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return {
    ok: true,
    imported: { products: data.products?.length ?? 0, releases: data.releases?.length ?? 0, upgrade_edges: data.upgrade_edges?.length ?? 0 },
  };
}
