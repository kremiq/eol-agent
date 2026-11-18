#!/usr/bin/env node
// Použitie: ADMIN_TOKEN=xxx node scripts/import.mjs <url> [data/sample.json]
//   napr.   ADMIN_TOKEN=xxx node scripts/import.mjs http://localhost:8787
import { readFile } from "node:fs/promises";

const [, , base, file = "data/sample.json"] = process.argv;
if (!base || !process.env.ADMIN_TOKEN) {
  console.error("Použitie: ADMIN_TOKEN=xxx node scripts/import.mjs <base-url> [file.json]");
  process.exit(1);
}
const data = JSON.parse(await readFile(file, "utf8"));
const res = await fetch(new URL("/admin/import", base), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  body: JSON.stringify(data),
});
console.log(res.status, JSON.stringify(await res.json(), null, 2));
process.exit(res.ok ? 0 : 1);
