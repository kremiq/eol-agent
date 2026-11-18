# EoL Agent – Lifecycle & Upgrade Paths pre AI agentov

Cloudflare Worker + D1, ktorý presales a ops agentom poskytuje:

- **End-of-Sale / End-of-Support** stav zariadení (PAN, Fortinet, Cisco, Juniper)
- **lifecycle OS releasov** (PAN-OS, FortiOS, IOS-XE, Junos…)
- **upgrade cesty** cez graf feature releasov, vrátane kontroly HW stropu, `min_from` medzikrokov a EoL varovaní
- **nástupcov** zariadení a **blížiace sa EoS/EoL** (refresh príležitosti)

Rozhrania: **MCP** (`/mcp`, Streamable HTTP, bezstavový), **REST** (`/api/<tool>`), **llms.txt** (`/llms.txt`).

## MCP nástroje

| Nástroj | Na čo |
|---|---|
| `check_lifecycle` | Je PA-3220 EoL? Dokedy je podporovaný? |
| `search_products` | Vyhľadanie modelov podľa názvu/rady/vendora |
| `get_release_lifecycle` | Lifecycle PAN-OS 10.2 / FortiOS 7.2 |
| `get_upgrade_path` | 10.1.9 → 11.1 na PA-3220, krok po kroku |
| `list_upcoming_eol` | Čo končí v najbližších N dňoch |
| `find_replacement` | Nástupca + jeho vlastný lifecycle |

Každá odpoveď nesie `verified` a `source_url`. Neoverené dáta vracajú varovanie, aby ich agent nepodal zákazníkovi ako fakt.

## Lokálne spustenie

```bash
npm install
npm run db:migrate:local
echo "ADMIN_TOKEN=devadmin" > .dev.vars
npm run dev                                   # http://localhost:8787
ADMIN_TOKEN=devadmin npm run import -- http://localhost:8787 data/sample.json
npm test
```

Test:
```bash
curl "localhost:8787/api/get_upgrade_path?os=PAN-OS&from_version=10.1.9&to_version=11.1&model=PA-3220"
curl -X POST localhost:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Deploy

```bash
# D1 sa vytvorí automaticky pri prvom deployi (Workers Builds: deploy command = npm run deploy)
npm run db:migrate:remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put API_TOKEN        # voliteľné – viď nižšie
npm run deploy
ADMIN_TOKEN=... npm run import -- https://eol-agent.<subdomena>.workers.dev data/sample.json
```

### Autentifikácia
- `API_TOKEN` nastavený → `/mcp` a `/api/*` vyžadujú `Authorization: Bearer <token>`.
- `API_TOKEN` nenastavený → otvorené. Hodí sa, keď je pred tým **Cloudflare Access** alebo **MCP server portal** (MCP URL pridáš ako server do portálu a autentifikáciu rieši Access).
- `/admin/import` vždy vyžaduje `ADMIN_TOKEN`.

## Dáta

`data/sample.json` obsahuje **ukážkové, neoverené dáta** (`verified: false`). Dátumy a HW stropy pred použitím nahraď údajmi z oficiálnych zdrojov:

- Palo Alto: End-of-Life Summary (HW aj PAN-OS)
- Fortinet: Product Life Cycle (support.fortinet.com) + Upgrade Path Tool
- Cisco: EoS/EoL notices per produkt
- Juniper: EOL/EOS stránky

Formát importu (upsert, idempotentný):

```json
{
  "products": [{ "vendor": "...", "model": "...", "os": "PAN-OS", "max_os_version": "11.1",
                 "eos_date": "YYYY-MM-DD", "eol_date": "YYYY-MM-DD", "replacement": "...",
                 "source_url": "...", "verified": true }],
  "releases": [{ "os": "PAN-OS", "version": "11.1", "eol_date": "...", "recommended": "11.1.x-hy", "verified": true }],
  "upgrade_edges": [{ "os": "PAN-OS", "from_version": "10.2", "to_version": "11.0", "min_from": "10.2.4", "notes": "...", "verified": true }]
}
```

Upgrade cesty sa modelujú ako hrany medzi feature releasmi. Ak vendor dovoľuje preskočiť release, pridaj priamu hranu (napr. `10.2 → 11.1`) a BFS ju automaticky uprednostní. `min_from` vloží povinný medzikrok v rámci releasu.

## Štruktúra

```
src/index.ts      router, auth, REST, llms.txt
src/mcp.ts        MCP JSON-RPC (initialize, tools/list, tools/call, ping)
src/tools.ts      definície nástrojov (zdieľané MCP + REST)
src/paths.ts      výpočet upgrade cesty (BFS)
src/version.ts    porovnávanie verzií (PAN-OS hotfixy, Junos R/S, IOS-XE)
src/lifecycle.ts  EoS/EoL stav
src/import.ts     validovaný batch upsert
migrations/       D1 schéma
```

## Ďalšie kroky
- Scrapery / parsery vendor EoL stránok (cron) → automatický import s `verified` po review
- Cache odpovedí (Cache API / KV) a rate limiting
- Prepojenie s CVE dátami: „na tejto verzii sú známe kritické CVE → upgrade odporúčaný“
