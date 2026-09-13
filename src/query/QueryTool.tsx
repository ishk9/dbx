// SQL query tool: write a statement, run it (Cmd/Ctrl+Enter), see rows in a
// virtualized read-only grid or a command summary. Export results to CSV.
//
// ponytail: the editor is a monospace textarea, not Monaco. Monaco needs web
// workers wired to bundled assets for an offline desktop app (a real config
// trap); a textarea ships the feature now. Syntax highlighting + schema-aware
// autocomplete are the upgrade — swap the textarea for Monaco when we invest.

import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "../lib/api";
import { isNull, renderCell } from "../lib/cells";
import { downloadText, toCsv } from "../lib/csv";
import type { Column, QueryResult, Row } from "../lib/types";

const ROW_H = 34;

export function QueryTool({ connId }: { connId: string }) {
  const [sql, setSql] = useState("select * from ");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await api.runQuery(connId, sql));
    } catch (e) {
      setResult(null);
      setError(errText(e));
    } finally {
      setRunning(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  }

  return (
    <div className="query">
      <div className="q-editor">
        <textarea
          className="q-input"
          value={sql}
          spellCheck={false}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="SELECT * FROM …"
        />
        <div className="q-bar">
          <span className="q-hint">⌘/Ctrl + Enter to run</span>
          <div className="q-bar-actions">
            {result?.kind === "rows" && result.rows.length > 0 && (
              <button
                className="btn btn-ghost sm"
                onClick={() => downloadText("dbx-export.csv", toCsv(result.columns, result.rows))}
              >
                Export CSV
              </button>
            )}
            <button className="btn btn-primary sm" onClick={run} disabled={running}>
              {running ? "Running…" : "Run"}
            </button>
          </div>
        </div>
      </div>

      <div className="q-result">
        {error && <div className="tv-banner err">{error}</div>}
        {result?.kind === "command" && <div className="q-command">{result.message}</div>}
        {result?.kind === "rows" && (
          <>
            <div className="q-meta">{result.rows.length} rows</div>
            <ResultsGrid columns={result.columns} rows={result.rows} />
          </>
        )}
        {!error && !result && <div className="q-empty">Run a query to see results.</div>}
      </div>
    </div>
  );
}

function ResultsGrid({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const template = columns.map(() => "minmax(140px, 1fr)").join(" ");

  return (
    <div className="grid-wrap" ref={scrollRef}>
      <div className="grid-header" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => (
          <div key={c.name} className="gh-cell" title={c.dataType}>
            <span className="gh-name">{c.name}</span>
            <span className="gh-type">{c.dataType}</span>
          </div>
        ))}
      </div>
      <div className="grid-body" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          return (
            <div
              key={vi.key}
              className="grid-row"
              style={{ gridTemplateColumns: template, transform: `translateY(${vi.start}px)` }}
            >
              {columns.map((c) => {
                const value = row[c.name];
                return (
                  <div key={c.name} className={`g-cell ${isNull(value) ? "null" : ""}`}>
                    {isNull(value) ? <span className="null-tag">NULL</span> : renderCell(value)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
