// Porovnávanie verzií sieťových OS: "11.1.2-h3" (PAN-OS hotfix), "7.2.8" (FortiOS),
// "17.9.4a" (IOS-XE), "22.4R3-S2" (Junos).

export type ParsedVersion = { parts: number[]; raw: string };

export function parseVersion(v: string): ParsedVersion {
  const raw = v.trim();
  const tokens = raw.toLowerCase().match(/\d+|[a-z]+/g) ?? [];
  const parts: number[] = [];
  const trailingLetter = /\d[a-z]$/i.test(raw);
  tokens.forEach((t, i) => {
    if (/^\d+$/.test(t)) parts.push(Number(t));
    else if (trailingLetter && i === tokens.length - 1 && t.length === 1) {
      // "17.9.4a" – písmenkový suffix ako ďalšia úroveň
      parts.push(t.charCodeAt(0) - 96);
    }
    // ostatné markery (h, r, s, build) sú len oddeľovače
  });
  return { parts, raw };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a).parts;
  const pb = parseVersion(b).parts;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Feature release = major.minor ("11.1.2-h3" -> "11.1"; Junos "22.4R3" -> "22.4"). */
export function featureRelease(v: string): string {
  const p = parseVersion(v).parts;
  if (p.length === 0) throw new Error(`Neplatná verzia: ${v}`);
  return `${p[0]}.${p[1] ?? 0}`;
}

export function isValidVersion(v: string): boolean {
  return /^\s*\d+(\.\d+)*/.test(v);
}
