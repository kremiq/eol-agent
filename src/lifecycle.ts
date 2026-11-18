import type { Product } from "./types";

export type LifecycleStatus = {
  status: "active" | "end_of_sale" | "end_of_support" | "unknown";
  days_to_eos: number | null;
  days_to_eol: number | null;
  message: string;
};

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function lifecycleStatus(p: Pick<Product, "eos_date" | "eol_date" | "replacement">, today: string): LifecycleStatus {
  const dEos = p.eos_date ? daysBetween(today, p.eos_date) : null;
  const dEol = p.eol_date ? daysBetween(today, p.eol_date) : null;
  const repl = p.replacement ? ` Nástupca: ${p.replacement}.` : "";

  if (dEol !== null && dEol <= 0)
    return { status: "end_of_support", days_to_eos: dEos, days_to_eol: dEol, message: `Bez podpory od ${p.eol_date}.${repl}` };
  if (dEos !== null && dEos <= 0)
    return {
      status: "end_of_sale", days_to_eos: dEos, days_to_eol: dEol,
      message: `Už sa nepredáva (EoS ${p.eos_date})${p.eol_date ? `, podpora končí ${p.eol_date} (o ${dEol} dní)` : ""}.${repl}`,
    };
  if (dEos === null && dEol === null)
    return { status: "unknown", days_to_eos: null, days_to_eol: null, message: "Lifecycle dátumy nie sú v DB." };
  return {
    status: "active", days_to_eos: dEos, days_to_eol: dEol,
    message: `Aktívny produkt${p.eos_date ? `, EoS ${p.eos_date}` : ""}${p.eol_date ? `, EoL ${p.eol_date}` : ""}.`,
  };
}
