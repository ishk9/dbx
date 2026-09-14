//! One error type for the whole backend. Commands return `Result<T, AppError>`;
//! `AppError` serializes to a plain string the frontend shows in an inline
//! banner (never a modal). Connection-loss is its own variant so the UI can
//! render "reconnecting" vs a hard failure differently.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("connection lost: {0}")]
    ConnectionLost(String),

    #[error("no such connection: {0}")]
    UnknownConnection(String),

    #[error("{0}")]
    Db(String),

    #[error("connection pool error: {0}")]
    Pool(String),

    #[error("keychain error: {0}")]
    Keychain(String),

    #[error("{0}")]
    Other(String),
}

// tokio_postgres::Error's own Display is generic ("db error: ..."). The real
// Postgres message (syntax error, undefined column, SQLSTATE, hint) lives in the
// attached DbError — pull it out so the query tool shows what actually failed.
impl From<tokio_postgres::Error> for AppError {
    fn from(e: tokio_postgres::Error) -> Self {
        let Some(db) = e.as_db_error() else {
            // Not a SQL error (protocol/IO) — its Display is the best we have.
            return AppError::Db(e.to_string());
        };
        let mut msg = format!("ERROR [{}]: {}", db.code().code(), db.message());
        if let Some(detail) = db.detail() {
            msg.push_str(&format!("\nDETAIL: {detail}"));
        }
        if let Some(hint) = db.hint() {
            msg.push_str(&format!("\nHINT: {hint}"));
        }
        AppError::Db(msg)
    }
}

// deadpool's PoolError isn't `#[from]`-friendly across its generic, so map it here.
impl From<deadpool_postgres::PoolError> for AppError {
    fn from(e: deadpool_postgres::PoolError) -> Self {
        AppError::Pool(e.to_string())
    }
}

impl From<deadpool_postgres::BuildError> for AppError {
    fn from(e: deadpool_postgres::BuildError) -> Self {
        AppError::Pool(e.to_string())
    }
}

/// Tauri needs command errors to be `Serialize`. Flatten to a tagged shape so
/// the frontend can branch on `kind` (e.g. show a Retry button on `connectionLost`).
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            AppError::ConnectionLost(_) => "connectionLost",
            AppError::UnknownConnection(_) => "unknownConnection",
            AppError::Db(_) => "db",
            AppError::Pool(_) => "pool",
            AppError::Keychain(_) => "keychain",
            AppError::Other(_) => "other",
        };
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
