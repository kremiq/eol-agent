import { describe, expect, it } from "vitest";
import { compareVersions, featureRelease } from "../src/version";
import { planUpgrade } from "../src/paths";
import { lifecycleStatus } from "../src/lifecycle";
import type { Edge, Release, Product } from "../src/types";

describe("version", () => {
  it("porovnáva PAN-OS hotfixy", () => {
    expect(compareVersions("11.1.2-h3", "11.1.2")).toBe(1);
    expect(compareVersions("10.2.9-h1", "10.2.10")).toBe(-1);
    expect(compareVersions("11.1", "11.1.0")).toBe(0);
  });
  it("Junos a IOS-XE", () => {
    expect(compareVersions("22.4R3-S2", "22.4R3")).toBe(1);
    expect(compareVersions("17.9.4a", "17.9.4")).toBe(1);
    expect(featureRelease("22.4R3-S2")).toBe("22.4");
    expect(featureRelease("7.2.8")).toBe("7.2");
  });
});

const rel = (version: string, eol_date?: string, recommended?: string): Release => ({ os: "PAN-OS", version, eol_date, recommended, verified: 1 });
const edge = (from_version: string, to_version: string, min_from?: string): Edge => ({ os: "PAN-OS", from_version, to_version, min_from, verified: 1 });
const releases = [rel("10.1", "2025-08-31", "10.1.14-h9"), rel("10.2", undefined, "10.2.13"), rel("11.0", "2025-11-17", "11.0.6"), rel("11.1", undefined, "11.1.6-h3")];
const edges = [edge("10.1", "10.2"), edge("10.2", "11.0", "10.2.4"), edge("11.0", "11.1")];

describe("planUpgrade", () => {
  it("sekvenčná cesta 10.1 -> 11.1 s min_from", () => {
    const p = planUpgrade({ os: "PAN-OS", from: "10.1.9", to: "11.1", edges, releases, today: "2026-11-18" });
    expect(p.possible).toBe(true);
    expect(p.steps.map((s) => s.to)).toEqual(["10.2.13", "11.0.6", "11.1.6-h3"]);
    expect(p.warnings.some((w) => w.includes("Medzikrok 11.0"))).toBe(true);
    expect(p.all_data_verified).toBe(true);
  });
  it("vloží krok na min_from", () => {
    const p = planUpgrade({ os: "PAN-OS", from: "10.2.1", to: "11.0.6", edges, releases, today: "2026-11-18" });
    expect(p.steps.map((s) => s.to)).toEqual(["10.2.4", "11.0.6"]);
  });
  it("blokuje nad HW strop a navrhne nástupcu", () => {
    const product: Product = { id: "x", vendor: "PAN", model: "PA-220", kind: "hardware", max_os_version: "10.2", replacement: "PA-440", verified: 1 };
    const p = planUpgrade({ os: "PAN-OS", from: "10.1.9", to: "11.1", edges, releases, product, today: "2026-11-18" });
    expect(p.possible).toBe(false);
    expect(p.suggested_replacement).toBe("PA-440");
  });
  it("downgrade odmietne", () => {
    expect(planUpgrade({ os: "PAN-OS", from: "11.1.2", to: "10.2", edges, releases }).possible).toBe(false);
  });
  it("neznáma cesta", () => {
    const p = planUpgrade({ os: "PAN-OS", from: "9.1.0", to: "11.1", edges, releases });
    expect(p.possible).toBe(false);
    expect(p.blocked_reason).toMatch(/nie je známa/);
  });
});

describe("lifecycle", () => {
  it("stavy", () => {
    expect(lifecycleStatus({ eos_date: "2023-01-01", eol_date: "2027-01-01" }, "2026-11-18").status).toBe("end_of_sale");
    expect(lifecycleStatus({ eos_date: "2023-01-01", eol_date: "2025-01-01" }, "2026-11-18").status).toBe("end_of_support");
    expect(lifecycleStatus({ eos_date: "2027-01-01" }, "2026-11-18").status).toBe("active");
  });
});
