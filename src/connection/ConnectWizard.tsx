// Guided connect wizard — the first thing a beginner sees. One calm card:
// paste a connection string OR fill fields, test, connect. "Save" is on by
// default so you never retype it next launch.

import { useState } from "react";
import { useConnections } from "../store/connections";
import { api } from "../lib/api";
import { parseConnString } from "../lib/connstring";
import type { ConnConfig, SslMode } from "../lib/types";

const BLANK: Omit<ConnConfig, "id"> = {
  name: "",
  host: "localhost",
  port: 5432,
  user: "postgres",
  dbname: "postgres",
  sslMode: "prefer",
};

export function ConnectWizard({ existingId }: { existingId?: string }) {
  const connect = useConnections((s) => s.connect);
  const saved = useConnections((s) => s.saved);

  const initial = existingId ? saved.find((c) => c.id === existingId) : undefined;
  const [form, setForm] = useState<Omit<ConnConfig, "id">>(initial ?? BLANK);
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(true);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const parsed = parseConnString(text);
    if (!parsed) return;
    e.preventDefault();
    setForm({
      name: form.name || parsed.name,
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      dbname: parsed.dbname,
      sslMode: parsed.sslMode,
    });
    setPassword(parsed.password);
    setTestMsg({ ok: true, text: "Filled from connection string." });
  }

  function fillLocalDefaults() {
    setForm({ ...BLANK, name: "Local Postgres" });
    setPassword("");
    setTestMsg(null);
  }

  const toConfig = (): ConnConfig => ({ id: existingId ?? crypto.randomUUID(), ...form });

  async function onTest() {
    setBusy("test");
    setTestMsg(null);
    try {
      await api.testConnection(toConfig(), password);
      setTestMsg({ ok: true, text: "Connection works." });
    } catch (e) {
      setTestMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onConnect() {
    setBusy("connect");
    setTestMsg(null);
    try {
      await connect({ config: toConfig(), password, save });
    } catch (e) {
      setTestMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const canSubmit = form.host && form.user && form.dbname && !busy;

  return (
    <div className="wizard">
      <h1>{existingId ? "Edit connection" : "Connect to Postgres"}</h1>
      <p className="lede">
        Paste a connection string, or fill in the details below.
      </p>

      {testMsg && (
        <p className={`msg ${testMsg.ok ? "ok" : "err"}`}>{testMsg.text}</p>
      )}

      <div className="field">
        <label htmlFor="w-name">Name</label>
        <input
          id="w-name"
          value={form.name}
          placeholder="My database"
          onChange={(e) => set("name", e.target.value)}
          onPaste={onPaste}
        />
      </div>

      <div className="field mono">
        <label htmlFor="w-host">Host &amp; port</label>
        <div className="row-2">
          <input
            id="w-host"
            value={form.host}
            onChange={(e) => set("host", e.target.value)}
            onPaste={onPaste}
          />
          <input
            aria-label="Port"
            type="number"
            value={form.port}
            onChange={(e) => set("port", Number(e.target.value))}
          />
        </div>
      </div>

      <div className="row-3">
        <div className="field mono">
          <label htmlFor="w-db">Database</label>
          <input id="w-db" value={form.dbname} onChange={(e) => set("dbname", e.target.value)} />
        </div>
        <div className="field mono">
          <label htmlFor="w-user">User</label>
          <input id="w-user" value={form.user} onChange={(e) => set("user", e.target.value)} />
        </div>
      </div>

      <div className="row-3">
        <div className="field mono">
          <label htmlFor="w-pass">Password</label>
          <input
            id="w-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="w-ssl">SSL</label>
          <select
            id="w-ssl"
            value={form.sslMode}
            onChange={(e) => set("sslMode", e.target.value as SslMode)}
          >
            <option value="prefer">Prefer</option>
            <option value="require">Require</option>
            <option value="disable">Disable</option>
          </select>
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        Save this connection (password stored in your Keychain)
      </label>

      <div className="wizard-actions">
        <button className="btn btn-ghost" onClick={onTest} disabled={!canSubmit}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        <button className="btn btn-primary" onClick={onConnect} disabled={!canSubmit}>
          {busy === "connect" ? "Connecting…" : "Connect"}
        </button>
      </div>

      <div className="quick-links">
        <button className="link" onClick={fillLocalDefaults}>
          Use local defaults
        </button>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
