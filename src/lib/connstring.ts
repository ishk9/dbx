// Parse a `postgres://user:pass@host:port/dbname?sslmode=...` URL into wizard
// fields, so beginners can paste what their provider gave them instead of
// decoding it by hand. Returns null if it doesn't look like a PG URL.

import type { SslMode } from "./types";

export interface ParsedConn {
  host: string;
  port: number;
  user: string;
  password: string;
  dbname: string;
  sslMode: SslMode;
  name: string;
}

export function parseConnString(raw: string): ParsedConn | null {
  const trimmed = raw.trim();
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    const sslParam = u.searchParams.get("sslmode");
    const sslMode: SslMode =
      sslParam === "disable" || sslParam === "require" ? sslParam : "prefer";
    const dbname = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
    return {
      host: u.hostname || "localhost",
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username) || "postgres",
      password: decodeURIComponent(u.password),
      dbname,
      sslMode,
      name: `${u.hostname || "localhost"}/${dbname}`,
    };
  } catch {
    return null;
  }
}
