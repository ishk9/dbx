//! Postgres data access: catalog reads today, row CRUD + type mapping to come
//! in the grid phase. Keeps all SQL behind typed functions so the command layer
//! and frontend never build queries by hand.

pub mod repo;
