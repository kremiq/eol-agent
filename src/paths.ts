import { compareVersions, featureRelease } from "./version";
import type { Edge, Product, Release } from "./types";
import { lifecycleStatus } from "./lifecycle";

export type UpgradeStep = {
  step: number;
  from: string;
  to: string;
  target_feature_release: string;
  min_from?: string | null;
  notes?: string | null;
  release_eol_date?: string | null;
  release_status?: string;
  verified: boolean;
};

export type UpgradePlan = {
  os: string;
  from: string;
  to: string;
  possible: boolean;
  steps: UpgradeStep[];
  warnings: string[];
  blocked_reason?: string;
  suggested_replacement?: string | null;
  all_data_verified: boolean;
};

/**
 * Nájde najkratšiu upgrade cestu cez graf feature releasov (BFS).
 * `to` môže byť feature release ("11.1") alebo konkrétna verzia ("11.1.6-h3").
 */
export function planUpgrade(args: {
  os: string;
  from: string;
  to: string;
  edges: Edge[];
  releases: Release[];
  product?: Product | null;
  today?: string;
}): UpgradePlan {
  const { os, from, to, edges, releases, product } = args;
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  const relMap = new Map(releases.map((r) => [r.version, r]));
  const fromFR = featureRelease(from);
  const toFR = featureRelease(to);
  const toIsFeatureOnly = to.trim() === toFR;

  const base: UpgradePlan = {
    os, from, to, possible: false, steps: [], warnings, all_data_verified: true,
  };

  if (compareVersions(to, from) <= 0) {
    return { ...base, blocked_reason: `Cieľová verzia ${to} nie je novšia ako ${from}.` };
  }

  // Hardvérový strop
  if (product?.max_os_version && compareVersions(toFR, product.max_os_version) > 0) {
    return {
      ...base,
      blocked_reason: `${product.model} podporuje maximálne ${os} ${product.max_os_version}; cieľ ${toFR} nie je podporovaný.`,
      suggested_replacement: product.replacement ?? null,
      all_data_verified: !!product.verified,
    };
  }
  if (product) {
    const st = lifecycleStatus(product, today);
    if (st.status !== "active") warnings.push(`Zariadenie ${product.model}: ${st.message}`);
    if (!product.verified) base.all_data_verified = false;
  }

  const targetVersionFor = (fr: string): string => {
    if (fr === toFR && !toIsFeatureOnly) return to;
    const rec = relMap.get(fr)?.recommended;
    if (rec) return rec;
    missingRec.add(fr);
    return `${fr}.x`;
  };
  const missingRec = new Set<string>();

  // Upgrade v rámci jedného feature releasu
  if (fromFR === toFR) {
    const rel = relMap.get(toFR);
    const step: UpgradeStep = {
      step: 1, from, to: targetVersionFor(toFR), target_feature_release: toFR,
      release_eol_date: rel?.eol_date ?? null,
      release_status: rel ? releaseStatus(rel, today) : "unknown",
      verified: !!rel?.verified,
    };
    if (!rel?.verified) base.all_data_verified = false;
    addReleaseWarnings(rel, toFR, today, warnings);
    return { ...base, possible: true, steps: [step] };
  }

  // BFS
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!adj.has(e.from_version)) adj.set(e.from_version, []);
    adj.get(e.from_version)!.push(e);
  }
  const prev = new Map<string, Edge>();
  const seen = new Set([fromFR]);
  const queue = [fromFR];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toFR) break;
    // preferuj väčšie skoky (menej krokov) – zoradiť zostupne
    const next = [...(adj.get(cur) ?? [])].sort((a, b) => compareVersions(b.to_version, a.to_version));
    for (const e of next) {
      if (seen.has(e.to_version)) continue;
      if (product?.max_os_version && compareVersions(e.to_version, product.max_os_version) > 0) continue;
      seen.add(e.to_version);
      prev.set(e.to_version, e);
      queue.push(e.to_version);
    }
  }

  if (!prev.has(toFR)) {
    return {
      ...base,
      blocked_reason: `V DB nie je známa upgrade cesta z ${os} ${fromFR} na ${toFR}. Over vendor dokumentáciu / doplň upgrade_edges.`,
    };
  }

  const chain: Edge[] = [];
  for (let v = toFR; v !== fromFR; ) {
    const e = prev.get(v)!;
    chain.unshift(e);
    v = e.from_version;
  }

  const steps: UpgradeStep[] = [];
  let current = from;
  chain.forEach((e, i) => {
    const rel = relMap.get(e.to_version);
    // ak je na from_version požadované minimum, pridaj najprv krok v rámci releasu
    if (e.min_from && compareVersions(current, e.min_from) < 0) {
      steps.push({
        step: steps.length + 1, from: current, to: e.min_from,
        target_feature_release: e.from_version,
        notes: `Pred skokom na ${e.to_version} je potrebné minimum ${e.min_from}.`,
        verified: !!e.verified,
      });
      current = e.min_from;
    }
    const target = targetVersionFor(e.to_version);
    steps.push({
      step: steps.length + 1, from: current, to: target,
      target_feature_release: e.to_version,
      min_from: e.min_from ?? null,
      notes: e.notes ?? null,
      release_eol_date: rel?.eol_date ?? null,
      release_status: rel ? releaseStatus(rel, today) : "unknown",
      verified: !!e.verified && !!rel?.verified,
    });
    if (!e.verified || !rel?.verified) base.all_data_verified = false;
    if (i < chain.length - 1) addReleaseWarnings(rel, e.to_version, today, warnings, true);
    else addReleaseWarnings(rel, e.to_version, today, warnings);
    current = target;
  });

  if (missingRec.size) {
    warnings.push(`Pre ${[...missingRec].join(", ")} nie je v DB odporúčaný maintenance release – ".x" znamená aktuálny preferred maintenance release podľa vendora.`);
  }
  if (!base.all_data_verified) {
    warnings.push("Časť dát nie je overená voči vendorovi (verified=false). Pred použitím u zákazníka over v oficiálnej dokumentácii.");
  }
  return { ...base, possible: true, steps };
}

function releaseStatus(r: Release, today: string): string {
  if (r.eol_date && r.eol_date <= today) return "end_of_life";
  return "supported";
}

function addReleaseWarnings(rel: Release | undefined, fr: string, today: string, w: string[], intermediate = false) {
  if (!rel) {
    w.push(`Release ${fr} nie je v DB (chýba lifecycle info).`);
    return;
  }
  if (rel.eol_date && rel.eol_date <= today) {
    w.push(intermediate
      ? `Medzikrok ${fr} je už EoL (${rel.eol_date}) – OK ako prechodná verzia, nezostávaj na nej.`
      : `Cieľový release ${fr} je EoL od ${rel.eol_date}.`);
  }
}
