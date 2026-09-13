// Lazy schema tree: schemas -> tables/views -> columns, each level loaded on
// expand. Clicking a table opens it in the data grid. Primary-key columns get a
// labeled "PK" badge (not a hidden icon — the pgAdmin discoverability gripe).

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useWorkspace } from "../store/workspace";
import type { Column, DbObject, Schema, TableRef } from "../lib/types";

export function SchemaTree({ connId }: { connId: string }) {
  const [schemas, setSchemas] = useState<Schema[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSchemas(null);
    setError(null);
    api
      .listSchemas(connId)
      .then((s) => alive && setSchemas(s))
      .catch((e) => alive && setError(errText(e)));
    return () => {
      alive = false;
    };
  }, [connId]);

  if (error) return <div className="tree-msg err">{error}</div>;
  if (!schemas) return <div className="tree-msg">Loading schemas…</div>;
  if (schemas.length === 0) return <div className="tree-msg">No schemas.</div>;

  return (
    <div className="tree" role="tree">
      {schemas.map((s) => (
        <SchemaNode key={s.name} connId={connId} schema={s.name} />
      ))}
    </div>
  );
}

function SchemaNode({ connId, schema }: { connId: string; schema: string }) {
  const [open, setOpen] = useState(false);
  const [objects, setObjects] = useState<DbObject[] | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && objects === null) {
      setObjects(await api.listObjects(connId, schema).catch(() => []));
    }
  }

  return (
    <div className="tree-branch">
      <button className="tree-row" onClick={toggle} aria-expanded={open}>
        <Caret open={open} />
        <span className="tree-ico">▤</span>
        <span className="tree-label">{schema}</span>
      </button>
      {open && (
        <div className="tree-children">
          {objects === null ? (
            <div className="tree-msg sub">Loading…</div>
          ) : objects.length === 0 ? (
            <div className="tree-msg sub">Empty</div>
          ) : (
            objects.map((o) => (
              <ObjectNode key={o.name} connId={connId} schema={schema} object={o} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ObjectNode({
  connId,
  schema,
  object,
}: {
  connId: string;
  schema: string;
  object: DbObject;
}) {
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<Column[] | null>(null);
  const openTable = useWorkspace((s) => s.openTable);
  const view = useWorkspace((s) => s.view);

  const selected =
    view?.kind === "table" &&
    view.table.connId === connId &&
    view.table.schema === schema &&
    view.table.name === object.name;

  async function toggleColumns(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    if (next && columns === null) {
      setColumns(await api.listColumns(connId, schema, object.name).catch(() => []));
    }
  }

  function select() {
    const ref: TableRef = { connId, schema, name: object.name, kind: object.kind };
    openTable(ref);
  }

  return (
    <div className="tree-branch">
      <div className={`tree-row leaf ${selected ? "selected" : ""}`}>
        <button className="tree-caret-btn" onClick={toggleColumns} aria-expanded={open}>
          <Caret open={open} />
        </button>
        <button className="tree-row-main" onClick={select} role="treeitem">
          <span className="tree-ico">{object.kind === "view" ? "◫" : "▦"}</span>
          <span className="tree-label">{object.name}</span>
          {object.kind === "view" && <span className="tree-tag">view</span>}
        </button>
      </div>
      {open && columns && (
        <div className="tree-children columns">
          {columns.map((c) => (
            <div key={c.name} className="tree-col" title={c.dataType}>
              <span className="tree-col-name">{c.name}</span>
              <span className="tree-col-type">{c.dataType}</span>
              {c.isPrimaryKey && <span className="tree-badge pk">PK</span>}
              {!c.nullable && !c.isPrimaryKey && <span className="tree-badge nn">not null</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return <span className={`caret ${open ? "open" : ""}`}>▸</span>;
}

function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
