// Minimal CSV export for query/table results. RFC-4180 quoting: wrap fields
// containing a comma, quote, or newline in quotes and double any inner quote.

import { renderCell } from "./cells";
import type { Column, Row } from "./types";

function field(v: unknown): string {
  const s = renderCell(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: Column[], rows: Row[]): string {
  const header = columns.map((c) => field(c.name)).join(",");
  const body = rows.map((r) => columns.map((c) => field(r[c.name])).join(",")).join("\n");
  return `${header}\n${body}`;
}

/** Trigger a client-side download of `text` as `filename`. */
export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
