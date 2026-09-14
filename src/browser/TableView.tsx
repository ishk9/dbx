// Table data grid — the headline feature: browse and edit rows with no SQL.
// Rows are virtualized so a large table scrolls smoothly. Editing a cell,
// deleting a row, and inserting a row call the typed CRUD commands; primary-key
// columns identify the row for update/delete (mutation is disabled without a PK,
// since we can't target a row safely).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "../lib/api";
import { coerceInput, isNull, renderCell } from "../lib/cells";
import type { Column, Row, TableRef } from "../lib/types";

const PAGE = 200;
const ROW_H = 34;

export function TableView({ table }: { table: TableRef }) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<{ err?: string; note?: string }>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const pkCols = useMemo(() => columns.filter((c) => c.isPrimaryKey), [columns]);
  const canMutate = pkCols.length > 0;

  const load = useCallback(
    async (nextOffset: number, replace: boolean) => {
      setLoading(true);
      try {
        const page = await api.tableRows(
          table.connId,
          table.schema,
          table.name,
          PAGE,
          nextOffset,
        );
        setColumns(page.columns);
        setRows((prev) => (replace ? page.rows : [...prev, ...page.rows]));
        setOffset(nextOffset);
        setHasMore(page.rows.length === PAGE);
        setStatus({});
      } catch (e) {
        setStatus({ err: errText(e) });
      } finally {
        setLoading(false);
      }
    },
    [table.connId, table.schema, table.name],
  );

  useEffect(() => {
    setRows([]);
    setAdding(false);
    load(0, true);
  }, [load]);

  const pkOf = (row: Row): Row => Object.fromEntries(pkCols.map((c) => [c.name, row[c.name]]));

  async function commitEdit(rowIndex: number, col: Column, input: string) {
    const current = renderCell(rows[rowIndex][col.name]);
    if (input === current) return;
    let value: unknown;
    try {
      value = coerceInput(col.dataType, input);
    } catch (e) {
      setStatus({ err: errText(e) });
      return;
    }
    try {
      await api.updateRow(table.connId, table.schema, table.name, pkOf(rows[rowIndex]), {
        [col.name]: value,
      });
      setRows((prev) =>
        prev.map((r, i) => (i === rowIndex ? { ...r, [col.name]: value } : r)),
      );
      setStatus({ note: "Saved." });
    } catch (e) {
      setStatus({ err: errText(e) });
    }
  }

  async function deleteRow(rowIndex: number) {
    try {
      await api.deleteRow(table.connId, table.schema, table.name, pkOf(rows[rowIndex]));
      setRows((prev) => prev.filter((_, i) => i !== rowIndex));
      setStatus({ note: "Row deleted." });
    } catch (e) {
      setStatus({ err: errText(e) });
    }
  }

  async function insertRow(draft: Row) {
    try {
      const saved = await api.insertRow(table.connId, table.schema, table.name, draft);
      setRows((prev) => [saved, ...prev]);
      setAdding(false);
      setStatus({ note: "Row inserted." });
    } catch (e) {
      setStatus({ err: errText(e) });
    }
  }

  return (
    <div className="tableview">
      <header className="tv-head">
        <div className="tv-title">
          <span className="tv-schema">{table.schema}.</span>
          <b>{table.name}</b>
          <span className="tv-count">{rows.length} rows{hasMore ? "+" : ""}</span>
        </div>
        <div className="tv-actions">
          {table.kind === "table" && canMutate && (
            <button className="btn btn-ghost sm" onClick={() => setAdding((a) => !a)}>
              + Add row
            </button>
          )}
          <button className="btn btn-ghost sm" onClick={() => load(0, true)} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {!canMutate && table.kind === "table" && (
        <div className="tv-banner">This table has no primary key — rows are read-only.</div>
      )}
      {status.err && <div className="tv-banner err">{status.err}</div>}

      {adding && (
        <InsertForm columns={columns} onCancel={() => setAdding(false)} onSave={insertRow} />
      )}

      <Grid
        columns={columns}
        rows={rows}
        canMutate={canMutate && table.kind === "table"}
        onCommit={commitEdit}
        onDelete={deleteRow}
      />

      {hasMore && (
        <div className="tv-more">
          <button className="btn btn-ghost sm" onClick={() => load(offset + PAGE, false)} disabled={loading}>
            {loading ? "Loading…" : `Load ${PAGE} more`}
          </button>
        </div>
      )}
    </div>
  );
}

function Grid({
  columns,
  rows,
  canMutate,
  onCommit,
  onDelete,
}: {
  columns: Column[];
  rows: Row[];
  canMutate: boolean;
  onCommit: (rowIndex: number, col: Column, input: string) => void;
  onDelete: (rowIndex: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewing, setViewing] = useState<{ row: number; col: string } | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // Grid columns: an actions gutter (if mutable) + one per column. Fixed-ish
  // widths (grow to fill when there's room) plus an explicit min-width on the
  // header/body let wide tables overflow horizontally so grid-wrap can scroll.
  const GUT = 40;
  const COL_W = 200;
  const template = `${canMutate ? `${GUT}px ` : ""}${columns.map(() => `minmax(${COL_W}px, 1fr)`).join(" ")}`;
  const minWidth = (canMutate ? GUT : 0) + columns.length * COL_W;

  return (
    <div className="grid-wrap" ref={scrollRef}>
      <div className="grid-header" style={{ gridTemplateColumns: template, minWidth }}>
        {canMutate && <div className="gh-cell gutter" />}
        {columns.map((c) => (
          <div key={c.name} className="gh-cell" title={c.dataType}>
            <span className="gh-name">{c.name}</span>
            {c.isPrimaryKey && <span className="tree-badge pk">PK</span>}
            <span className="gh-type">{c.dataType}</span>
          </div>
        ))}
      </div>

      <div className="grid-body" style={{ height: virtualizer.getTotalSize(), minWidth }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          return (
            <div
              key={vi.key}
              className="grid-row"
              style={{
                gridTemplateColumns: template,
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {canMutate && (
                <button
                  className="g-del gutter"
                  title="Delete row"
                  onClick={() => onDelete(vi.index)}
                >
                  ✕
                </button>
              )}
              {columns.map((c) => {
                const value = row[c.name];
                return (
                  <div
                    key={c.name}
                    className={`g-cell ${isNull(value) ? "null" : ""}`}
                    title="Click to view"
                    onClick={() => setViewing({ row: vi.index, col: c.name })}
                  >
                    {isNull(value) ? <span className="null-tag">NULL</span> : renderCell(value)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {viewing &&
        (() => {
          const col = columns.find((c) => c.name === viewing.col);
          if (!col) return null;
          return (
            <CellModal
              col={col}
              value={rows[viewing.row]?.[col.name]}
              canMutate={canMutate}
              onClose={() => setViewing(null)}
              onSave={(v) => {
                onCommit(viewing.row, col, v);
                setViewing(null);
              }}
            />
          );
        })()}
    </div>
  );
}

// Full-value viewer/editor for a single cell. Solves two things the inline grid
// can't: reading a value too wide to fit, and editing multi-line values (jsonb,
// arrays, long text) that a one-line input mangled.
function CellModal({
  col,
  value,
  canMutate,
  onClose,
  onSave,
}: {
  col: Column;
  value: unknown;
  canMutate: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [text, setText] = useState(() => (isNull(value) ? "" : renderCell(value)));
  const [copied, setCopied] = useState(false);
  const dirty = text !== (isNull(value) ? "" : renderCell(value));

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="tv-title">
            <b>{col.name}</b>
            <span className="gh-type">{col.dataType}</span>
          </div>
          <button className="g-del" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <textarea
          className="modal-text"
          autoFocus
          spellCheck={false}
          readOnly={!canMutate}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="modal-actions">
          <button
            className="btn btn-ghost sm"
            onClick={() => {
              navigator.clipboard.writeText(text);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          {canMutate && (
            <button className="btn btn-primary sm" disabled={!dirty} onClick={() => onSave(text)}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InsertForm({
  columns,
  onCancel,
  onSave,
}: {
  columns: Column[];
  onCancel: () => void;
  onSave: (draft: Row) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});

  function save() {
    // Only include columns the user actually filled — everything else keeps its
    // DEFAULT (serial ids, now(), etc.).
    const draft: Row = {};
    for (const c of columns) {
      const raw = fields[c.name];
      if (raw === undefined || raw.trim() === "") continue;
      try {
        draft[c.name] = coerceInput(c.dataType, raw);
      } catch {
        draft[c.name] = raw; // let Postgres reject with a clear error
      }
    }
    onSave(draft);
  }

  return (
    <div className="insert-form">
      <div className="if-fields">
        {columns.map((c) => (
          <label key={c.name} className="if-field">
            <span>
              {c.name}
              {c.isPrimaryKey && <span className="tree-badge pk">PK</span>}
            </span>
            <input
              placeholder={c.dataType}
              value={fields[c.name] ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, [c.name]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="if-actions">
        <button className="btn btn-ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary sm" onClick={save}>
          Insert
        </button>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
