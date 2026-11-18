import * as db from "./db";
import { lifecycleStatus, daysBetween } from "./lifecycle";
import { planUpgrade } from "./paths";
import { featureRelease, isValidVersion } from "./version";
import type { Env, Product } from "./types";

const today = () => new Date().toISOString().slice(0, 10);
const UNVERIFIED_NOTE = "Záznam nie je overený voči vendorovi (verified=false) – pred použitím u zákazníka over v source_url.";

export class ToolError extends Error {}

type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (env: Env, args: any) => Promise<unknown>;
};

const str = (description: string) => ({ type: "string", description });

function productView(p: Product, on: string) {
  const st = lifecycleStatus(p, on);
  return {
    vendor: p.vendor, model: p.model, family: p.family, kind: p.kind,
    os: p.os, max_os_version: p.max_os_version,
    eos_date: p.eos_date, eol_date: p.eol_date, replacement: p.replacement,
    lifecycle: st, notes: p.notes, source_url: p.source_url,
    verified: !!p.verified, ...(p.verified ? {} : { warning: UNVERIFIED_NOTE }),
  };
}

export const TOOLS: ToolDef[] = [
  {
    name: "check_lifecycle",
    title: "Lifecycle zariadenia",
    description:
      "Vráti End-of-Sale / End-of-Support stav konkrétneho modelu (napr. 'PA-3220', 'FortiGate 100F'), počet dní do EoS/EoL, max. podporovanú verziu OS a nástupcu. Použi, keď sa niekto pýta, či je zariadenie EoL, dokedy je podporované alebo čím ho nahradiť.",
    inputSchema: {
      type: "object",
      properties: {
        model: str("Model zariadenia, napr. 'PA-3220', 'FG-100F', 'ISR4331'"),
        vendor: str("Voliteľne vendor na zúženie (Palo Alto Networks, Fortinet, Cisco, Juniper)"),
        on_date: str("Voliteľný dátum YYYY-MM-DD, ku ktorému sa stav počíta (default dnes)"),
      },
      required: ["model"],
    },
    async handler(env, a) {
      const p = await db.findProduct(env.DB, a.model, a.vendor);
      if (!p) {
        const similar = await db.searchProducts(env.DB, { query: a.model.slice(0, 4), vendor: a.vendor, limit: 5 });
        return { found: false, query: a.model, similar: similar.map((s) => `${s.vendor} ${s.model}`) };
      }
      return { found: true, ...productView(p, a.on_date ?? today()) };
    },
  },
  {
    name: "search_products",
    title: "Vyhľadať produkty",
    description: "Fulltextové vyhľadávanie produktov podľa modelu, rady alebo vendora. Vracia lifecycle súhrn pre každý nájdený produkt.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Časť názvu modelu alebo rady, napr. 'PA-32', 'FortiGate 60'"),
        vendor: str("Vendor"),
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
    async handler(env, a) {
      const rows = await db.searchProducts(env.DB, a);
      const t = today();
      return { count: rows.length, products: rows.map((p) => productView(p, t)) };
    },
  },
  {
    name: "get_release_lifecycle",
    title: "Lifecycle verzie OS",
    description:
      "Vráti lifecycle feature releasu OS (PAN-OS, FortiOS, IOS-XE, Junos…): dátum vydania, EoL, odporúčaný maintenance release. Akceptuje aj plnú verziu ('10.2.9-h1').",
    inputSchema: {
      type: "object",
      properties: { os: str("Napr. 'PAN-OS', 'FortiOS'"), version: str("Napr. '10.2' alebo '10.2.9-h1'") },
      required: ["os", "version"],
    },
    async handler(env, a) {
      if (!isValidVersion(a.version)) throw new ToolError(`Neplatná verzia '${a.version}'`);
      const fr = featureRelease(a.version);
      const r = await db.getRelease(env.DB, a.os, fr);
      if (!r) {
        return { found: false, os: a.os, feature_release: fr, known_os: await db.listOS(env.DB) };
      }
      const t = today();
      return {
        found: true, os: r.os, feature_release: r.version, release_date: r.release_date, eol_date: r.eol_date,
        days_to_eol: r.eol_date ? daysBetween(t, r.eol_date) : null,
        status: r.eol_date && r.eol_date <= t ? "end_of_life" : "supported",
        recommended: r.recommended, notes: r.notes, source_url: r.source_url,
        verified: !!r.verified, ...(r.verified ? {} : { warning: UNVERIFIED_NOTE }),
      };
    },
  },
  {
    name: "get_upgrade_path",
    title: "Upgrade cesta",
    description:
      "Vypočíta krokovú upgrade cestu medzi verziami OS (napr. PAN-OS 10.1.9 → 11.1). Ak zadáš model, overí hardvérový strop (max. podporovaná verzia) a EoL zariadenia a navrhne nástupcu. Vracia jednotlivé kroky, medziverzie, upozornenia a či sú dáta overené.",
    inputSchema: {
      type: "object",
      properties: {
        os: str("Napr. 'PAN-OS', 'FortiOS'"),
        from_version: str("Aktuálna verzia, napr. '10.1.9-h1'"),
        to_version: str("Cieľ – feature release ('11.1') alebo presná verzia ('11.1.6-h3')"),
        model: str("Voliteľne model zariadenia pre kontrolu HW stropu"),
      },
      required: ["os", "from_version", "to_version"],
    },
    async handler(env, a) {
      for (const v of [a.from_version, a.to_version]) if (!isValidVersion(v)) throw new ToolError(`Neplatná verzia '${v}'`);
      const [edges, releases, product] = await Promise.all([
        db.getEdges(env.DB, a.os),
        db.getReleases(env.DB, a.os),
        a.model ? db.findProduct(env.DB, a.model) : Promise.resolve(null),
      ]);
      if (!releases.length && !edges.length) {
        return { possible: false, blocked_reason: `OS '${a.os}' nie je v DB.`, known_os: await db.listOS(env.DB) };
      }
      const plan = planUpgrade({ os: a.os, from: a.from_version, to: a.to_version, edges, releases, product });
      if (a.model && !product) plan.warnings.unshift(`Model '${a.model}' nie je v DB – HW strop nebol overený.`);
      return plan;
    },
  },
  {
    name: "list_upcoming_eol",
    title: "Blížiace sa EoS/EoL",
    description:
      "Zoznam produktov a OS releasov, ktorým v najbližších N dňoch končí predaj alebo podpora. Ideálne na proaktívne obchodné príležitosti (refresh) a plánovanie upgradov.",
    inputSchema: {
      type: "object",
      properties: {
        within_days: { type: "integer", minimum: 1, maximum: 1825, default: 365 },
        vendor: str("Voliteľne vendor"),
      },
    },
    async handler(env, a) {
      const t = today();
      const end = new Date(Date.now() + (a.within_days ?? 365) * 86_400_000).toISOString().slice(0, 10);
      return { from: t, to: end, ...(await db.upcoming(env.DB, t, end, a.vendor)) };
    },
  },
  {
    name: "find_replacement",
    title: "Nástupca zariadenia",
    description: "Pre EoL/EoS model vráti odporúčaného nástupcu a jeho lifecycle (aby sa nenavrhol nástupca, ktorý je sám blízko EoS).",
    inputSchema: {
      type: "object",
      properties: { model: str("Pôvodný model"), vendor: str("Voliteľne vendor") },
      required: ["model"],
    },
    async handler(env, a) {
      const p = await db.findProduct(env.DB, a.model, a.vendor);
      if (!p) return { found: false, query: a.model };
      const t = today();
      const out: Record<string, unknown> = { original: productView(p, t) };
      if (p.replacement) {
        const r = await db.findProduct(env.DB, p.replacement, p.vendor);
        out.replacement = r ? productView(r, t) : { model: p.replacement, in_db: false };
      } else out.replacement = null;
      return out;
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
