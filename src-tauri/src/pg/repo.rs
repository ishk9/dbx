//! Catalog queries for the schema browser (Repository pattern).
//!
//! The tree loads lazily: schemas first, a schema's tables/views on expand,
//! a table's columns on expand. Each function takes an already-acquired client
//! so the command layer owns connection state; the repo just runs SQL and maps
//! rows to serializable structs the frontend renders.

use deadpool_postgres::Client;
use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, Result};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbObject {
    pub name: String,
    /// "table" or "view" — drives the tree icon and later CRUD availability.
    pub kind: ObjectKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ObjectKind {
    Table,
    View,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    /// Part of the primary key — shown as a labeled affordance, not a hidden
    /// icon (the pgAdmin discoverability complaint).
    pub is_primary_key: bool,
}

/// User schemas, excluding Postgres' internal ones.
pub async fn list_schemas(client: &Client) -> Result<Vec<Schema>> {
    let rows = client
        .query(
            "SELECT nspname AS name
               FROM pg_namespace
              WHERE nspname NOT IN ('pg_catalog', 'information_schema')
                AND nspname NOT LIKE 'pg_temp%'
                AND nspname NOT LIKE 'pg_toast%'
              ORDER BY nspname",
            &[],
        )
        .await?;
    Ok(rows.into_iter().map(|r| Schema { name: r.get("name") }).collect())
}

/// Tables and views in a schema, ordered together for a flat tree level.
pub async fn list_objects(client: &Client, schema: &str) -> Result<Vec<DbObject>> {
    let rows = client
        .query(
            "SELECT table_name AS name, table_type AS kind
               FROM information_schema.tables
              WHERE table_schema = $1
              ORDER BY table_name",
            &[&schema],
        )
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let kind = match r.get::<_, String>("kind").as_str() {
                "VIEW" => ObjectKind::View,
                _ => ObjectKind::Table,
            };
            DbObject { name: r.get("name"), kind }
        })
        .collect())
}

/// Columns of a table/view, in definition order, with primary-key flags.
pub async fn list_columns(client: &Client, schema: &str, table: &str) -> Result<Vec<Column>> {
    let rows = client
        .query(
            "SELECT c.column_name AS name,
                    c.data_type   AS data_type,
                    (c.is_nullable = 'YES') AS nullable,
                    COALESCE(pk.is_pk, false) AS is_primary_key
               FROM information_schema.columns c
               LEFT JOIN (
                    SELECT a.attname AS column_name, true AS is_pk
                      FROM pg_index i
                      JOIN pg_attribute a
                        ON a.attrelid = i.indrelid
                       AND a.attnum = ANY (i.indkey)
                     WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass
                       AND i.indisprimary
               ) pk ON pk.column_name = c.column_name
              WHERE c.table_schema = $1
                AND c.table_name = $2
              ORDER BY c.ordinal_position",
            &[&schema, &table],
        )
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| Column {
            name: r.get("name"),
            data_type: r.get("data_type"),
            nullable: r.get("nullable"),
            is_primary_key: r.get("is_primary_key"),
        })
        .collect())
}

// --- row data + CRUD ---
//
// Rows travel as jsonb: `to_jsonb(row)` lets Postgres render every column
// (arrays, jsonb, enums, numerics, timestamps) into correct JSON, and
// `jsonb_populate_record` coerces JSON back into the row's real types on write.
// That keeps a whole Rust type-adapter out of the codebase. Column values are
// ALWAYS bound as parameters ($1/$2) — never string-interpolated — so writes are
// injection-safe; only identifiers are inlined, and those go through quote_ident.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePage {
    pub columns: Vec<Column>,
    pub rows: Vec<Value>,
}

/// Quote an identifier for safe inlining: wrap in double quotes and double any
/// internal quote. The only defense between a table/column name and the query.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn qualified(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

/// A page of rows plus the column metadata the grid needs to render headers.
pub async fn table_rows(
    client: &Client,
    schema: &str,
    table: &str,
    limit: i64,
    offset: i64,
) -> Result<TablePage> {
    let columns = list_columns(client, schema, table).await?;
    let rel = qualified(schema, table);
    // ORDER BY 1 (first column) gives stable paging without assuming a PK.
    let sql = format!(
        "SELECT to_jsonb(t) AS row
           FROM (SELECT * FROM {rel} ORDER BY 1 LIMIT $1 OFFSET $2) t"
    );
    let rows = client.query(&sql, &[&limit, &offset]).await?;
    let rows = rows.into_iter().map(|r| r.get::<_, Value>("row")).collect();
    Ok(TablePage { columns, rows })
}

/// Insert a row from a JSON object of column -> value; returns the stored row
/// (with server-generated defaults like serial ids filled in).
pub async fn insert_row(
    client: &Client,
    schema: &str,
    table: &str,
    values: &Value,
) -> Result<Value> {
    let obj = require_object(values, "insert values")?;
    if obj.is_empty() {
        return Err(AppError::Other("insert needs at least one column".into()));
    }
    let rel = qualified(schema, table);
    // Name only the provided columns so unspecified ones keep their DEFAULT
    // (serial ids, `now()`, etc.). `jsonb_populate_record` fills unlisted columns
    // with NULL, so a bare `SELECT *` would clobber those defaults.
    let cols = obj.keys().map(|k| quote_ident(k)).collect::<Vec<_>>().join(", ");
    let sql = format!(
        "INSERT INTO {rel} AS r ({cols})
         SELECT {cols} FROM jsonb_populate_record(NULL::{rel}, $1::jsonb)
         RETURNING to_jsonb(r)"
    );
    let row = client.query_one(&sql, &[values]).await?;
    Ok(row.get(0))
}

/// Update the columns present in `changes` on the row matching `pk` (a JSON
/// object of primary-key column -> value taken from the original row). Returns
/// rows affected.
pub async fn update_row(
    client: &Client,
    schema: &str,
    table: &str,
    pk: &Value,
    changes: &Value,
) -> Result<u64> {
    require_object(pk, "primary key")?;
    let obj = require_object(changes, "changes")?;
    if obj.is_empty() {
        return Ok(0);
    }
    let rel = qualified(schema, table);
    let cols = obj.keys().map(|k| quote_ident(k)).collect::<Vec<_>>().join(", ");
    // Row-expression SET pulls correctly-typed values from jsonb_populate_record;
    // `to_jsonb(t) @> $1` matches the row whose pk columns equal the given ones.
    let sql = format!(
        "UPDATE {rel} AS t
            SET ({cols}) = (SELECT {cols} FROM jsonb_populate_record(NULL::{rel}, $2::jsonb))
          WHERE to_jsonb(t) @> $1::jsonb"
    );
    Ok(client.execute(&sql, &[pk, changes]).await?)
}

/// Delete the row(s) whose columns contain the given primary-key JSON. Returns
/// rows affected.
pub async fn delete_row(client: &Client, schema: &str, table: &str, pk: &Value) -> Result<u64> {
    require_object(pk, "primary key")?;
    let rel = qualified(schema, table);
    let sql = format!("DELETE FROM {rel} AS t WHERE to_jsonb(t) @> $1::jsonb");
    Ok(client.execute(&sql, &[pk]).await?)
}

fn require_object<'a>(
    v: &'a Value,
    what: &str,
) -> Result<&'a serde_json::Map<String, Value>> {
    v.as_object()
        .ok_or_else(|| AppError::Other(format!("{what} must be a JSON object")))
}

// --- ad-hoc SQL (query tool) ---

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum QueryResult {
    /// A result set to show in the grid.
    Rows { columns: Vec<Column>, rows: Vec<Value> },
    /// A statement with no result set (INSERT/UPDATE/DDL) — just a summary.
    Command { message: String },
}

/// Run one ad-hoc statement. Column order and types come from preparing the
/// statement; values come from `row_to_json` (json preserves SELECT column
/// order, unlike jsonb which sorts keys). Non-SELECT statements return a count.
pub async fn run_query(client: &Client, sql: &str) -> Result<QueryResult> {
    let sql = sql.trim().trim_end_matches(';').trim();
    if sql.is_empty() {
        return Err(AppError::Other("empty query".into()));
    }

    // Prepare to learn the shape without running it yet.
    let stmt = client.prepare(sql).await?;
    let cols = stmt.columns();

    if cols.is_empty() {
        // No result set — a command. Execute and report rows affected.
        let n = client.execute(&stmt, &[]).await?;
        return Ok(QueryResult::Command {
            message: format!("Statement OK — {n} row(s) affected"),
        });
    }

    let columns = cols
        .iter()
        .map(|c| Column {
            name: c.name().to_string(),
            data_type: c.type_().name().to_string(),
            nullable: true,
            is_primary_key: false,
        })
        .collect();

    // row_to_json keeps the original column order; jsonb would re-sort keys.
    let wrapped = format!("SELECT row_to_json(t) AS row FROM ({sql}) t");
    let rows = client.query(&wrapped, &[]).await?;
    let rows = rows.into_iter().map(|r| r.get::<_, Value>("row")).collect();
    Ok(QueryResult::Rows { columns, rows })
}
