-- Hardvér / softvér / licencie a ich lifecycle
CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,          -- napr. "paloalto:pa-3220"
  vendor         TEXT NOT NULL,             -- "Palo Alto Networks", "Fortinet", "Cisco", "Juniper"
  family         TEXT,                      -- "PA-3200 Series", "FortiGate"
  model          TEXT NOT NULL,             -- "PA-3220"
  model_norm     TEXT NOT NULL,             -- "pa3220" (pre vyhľadávanie)
  kind           TEXT NOT NULL DEFAULT 'hardware', -- hardware | software | license
  os             TEXT,                      -- OS, ktorý na zariadení beží ("PAN-OS", "FortiOS")
  max_os_version TEXT,                      -- posledný podporovaný feature release (napr. "11.1")
  eos_date       TEXT,                      -- End of Sale (YYYY-MM-DD)
  eol_date       TEXT,                      -- End of Support / Life (YYYY-MM-DD)
  replacement    TEXT,                      -- odporúčaný nástupca (model)
  notes          TEXT,
  source_url     TEXT,
  verified       INTEGER NOT NULL DEFAULT 0,-- 1 = overené voči vendorovi
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor);
CREATE INDEX IF NOT EXISTS idx_products_norm   ON products(model_norm);
CREATE INDEX IF NOT EXISTS idx_products_eol    ON products(eol_date);

-- Feature releasy OS a ich lifecycle
CREATE TABLE IF NOT EXISTS releases (
  os           TEXT NOT NULL,               -- "PAN-OS"
  version      TEXT NOT NULL,               -- feature release "11.1"
  release_date TEXT,
  eol_date     TEXT,
  recommended  TEXT,                        -- odporúčaný maintenance release, napr. "11.1.6-h3"
  notes        TEXT,
  source_url   TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (os, version)
);

-- Povolené upgrade hrany medzi feature releasmi (graf)
CREATE TABLE IF NOT EXISTS upgrade_edges (
  os           TEXT NOT NULL,
  from_version TEXT NOT NULL,               -- feature release "10.2"
  to_version   TEXT NOT NULL,               -- feature release "11.0"
  min_from     TEXT,                        -- min. maintenance verzia na from_version pred skokom
  notes        TEXT,
  source_url   TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (os, from_version, to_version)
);
