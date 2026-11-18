export interface Env {
  DB: D1Database;
  API_TOKEN?: string;
  ADMIN_TOKEN?: string;
}

export type Product = {
  id: string;
  vendor: string;
  family?: string | null;
  model: string;
  kind: string;
  os?: string | null;
  max_os_version?: string | null;
  eos_date?: string | null;
  eol_date?: string | null;
  replacement?: string | null;
  notes?: string | null;
  source_url?: string | null;
  verified: number | boolean;
};

export type Release = {
  os: string;
  version: string;
  release_date?: string | null;
  eol_date?: string | null;
  recommended?: string | null;
  notes?: string | null;
  source_url?: string | null;
  verified: number | boolean;
};

export type Edge = {
  os: string;
  from_version: string;
  to_version: string;
  min_from?: string | null;
  notes?: string | null;
  source_url?: string | null;
  verified: number | boolean;
};
