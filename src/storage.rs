use rusqlite::{Connection, OptionalExtension, params};
use std::{env, fs, path::PathBuf};

#[derive(Clone, Debug)]
pub struct MemoStore {
    path: PathBuf,
}

impl MemoStore {
    pub fn in_home() -> Result<Self, String> {
        let home = env::var_os("USERPROFILE")
            .or_else(|| env::var_os("HOME"))
            .map(PathBuf::from)
            .ok_or("Could not determine the home directory")?;
        Self::open(home.join(".memo").join("data.sqlite"))
    }

    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let store = Self { path };
        store.with_connection(|connection| {
            connection.execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA foreign_keys=ON;
                 CREATE TABLE IF NOT EXISTS app_data (
                   key TEXT PRIMARY KEY,
                   value TEXT NOT NULL,
                   updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                 );
                 CREATE TABLE IF NOT EXISTS conversations (
                   id TEXT PRIMARY KEY,
                   title TEXT,
                   status TEXT NOT NULL DEFAULT 'regular',
                   metadata_json TEXT NOT NULL DEFAULT '{}',
                   updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                 );
                 CREATE TABLE IF NOT EXISTS messages (
                   conversation_id TEXT NOT NULL,
                   id TEXT NOT NULL,
                   position INTEGER NOT NULL,
                   message_json TEXT NOT NULL,
                   created_at INTEGER NOT NULL DEFAULT (unixepoch()),
                   PRIMARY KEY (conversation_id, id),
                   FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                 );
                 CREATE TABLE IF NOT EXISTS runtime_sessions (
                   conversation_id TEXT NOT NULL,
                   runtime TEXT NOT NULL,
                   session_id TEXT NOT NULL,
                   updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                   PRIMARY KEY (conversation_id, runtime)
                 );
                 CREATE TABLE IF NOT EXISTS request_log (
                   id TEXT PRIMARY KEY,
                   runtime TEXT,
                   model TEXT,
                   status TEXT NOT NULL,
                   duration_ms INTEGER,
                   error TEXT,
                   created_at INTEGER NOT NULL DEFAULT (unixepoch())
                 );",
            )?;
            Ok(())
        })?;
        Ok(store)
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, String> {
        self.with_connection(|connection| {
            connection
                .query_row("SELECT value FROM app_data WHERE key = ?1", [key], |row| {
                    row.get(0)
                })
                .optional()
        })
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), String> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO app_data(key, value, updated_at) VALUES (?1, ?2, unixepoch())
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![key, value],
            )?;
            Ok(())
        })
    }

    pub fn remove(&self, key: &str) -> Result<(), String> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM app_data WHERE key = ?1", [key])?;
            Ok(())
        })
    }

    pub fn save_exchange(
        &self,
        conversation_id: &str,
        model: &str,
        input_json: &str,
        output_json: &str,
    ) -> Result<(), String> {
        self.with_connection(|connection| {
            let transaction = connection.unchecked_transaction()?;
            transaction.execute(
                "INSERT INTO conversations(id, metadata_json, updated_at) VALUES (?1, ?2, unixepoch())
                 ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json, updated_at=excluded.updated_at",
                params![conversation_id, serde_json::json!({"model": model}).to_string()],
            )?;
            let next_position: i64 = transaction.query_row(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM messages WHERE conversation_id = ?1",
                [conversation_id],
                |row| row.get(0),
            )?;
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            transaction.execute(
                "INSERT INTO messages(conversation_id, id, position, message_json) VALUES (?1, ?2, ?3, ?4)",
                params![conversation_id, format!("input-{stamp}"), next_position, input_json],
            )?;
            transaction.execute(
                "INSERT INTO messages(conversation_id, id, position, message_json) VALUES (?1, ?2, ?3, ?4)",
                params![conversation_id, format!("output-{stamp}"), next_position + 1, output_json],
            )?;
            transaction.commit()
        })
    }

    pub fn record_request(
        &self,
        id: &str,
        runtime: &str,
        model: &str,
        status: &str,
        duration_ms: u128,
        error: Option<&str>,
    ) -> Result<(), String> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT OR REPLACE INTO request_log(id, runtime, model, status, duration_ms, error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, runtime, model, status, duration_ms as i64, error],
            )?;
            Ok(())
        })
    }

    fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let connection = Connection::open(&self.path).map_err(|error| error.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        operation(&connection).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::MemoStore;

    #[test]
    fn persists_values_in_sqlite() {
        let path = std::env::temp_dir().join(format!(
            "memo-storage-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let store = MemoStore::open(path.clone()).unwrap();
        store.set("memo:threads", "[]").unwrap();
        assert_eq!(store.get("memo:threads").unwrap().as_deref(), Some("[]"));
        store.remove("memo:threads").unwrap();
        assert_eq!(store.get("memo:threads").unwrap(), None);
        drop(store);
        let _ = std::fs::remove_file(path);
    }
}
