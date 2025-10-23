use crate::error::ProxyError;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageMetrics {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub model: String,
}

impl Default for UsageMetrics {
    fn default() -> Self {
        Self {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            model: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub service: String,
    pub method: String,
    pub path: String,
    pub status_code: u16,
    pub duration_ms: u64,
    pub error_message: Option<String>,
    pub channel: Option<String>,
    pub usage: Option<UsageMetrics>,
    pub target_url: Option<String>,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
}

pub struct RequestLogger {
    db: Arc<Mutex<Connection>>,
    max_logs: usize,
}

impl RequestLogger {
    pub fn new() -> Result<Self, ProxyError> {
        let db_path = Self::get_db_path()?;
        let conn = Connection::open(&db_path)?;

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS request_logs (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                service TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                error_message TEXT,
                channel TEXT,
                target_url TEXT,
                request_body TEXT,
                response_body TEXT,
                prompt_tokens INTEGER,
                completion_tokens INTEGER,
                total_tokens INTEGER,
                model TEXT
            )",
            [],
        )?;

        // Create index for efficient queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_timestamp ON request_logs(timestamp DESC)",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_service ON request_logs(service)",
            [],
        )?;

        info!("Request logger initialized with database: {:?}", db_path);

        let _ = conn.execute("ALTER TABLE request_logs ADD COLUMN request_body TEXT", []);
        let _ = conn.execute("ALTER TABLE request_logs ADD COLUMN response_body TEXT", []);

        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
            max_logs: 50, // Default, can be configured
        })
    }

    fn get_db_path() -> Result<PathBuf, ProxyError> {
        let home = dirs::home_dir()
            .ok_or_else(|| ProxyError::ConfigurationError("Cannot find home directory".to_string()))?;
        
        let data_dir = home.join(".paf").join("data");
        std::fs::create_dir_all(&data_dir).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to create data directory: {}", e))
        })?;

        Ok(data_dir.join("proxy_requests.db"))
    }

    pub fn log_request(&self, log: RequestLog) -> Result<(), ProxyError> {
        let db = self.db.lock().unwrap();

        db.execute(
            "INSERT INTO request_logs (
                id, timestamp, service, method, path, status_code, duration_ms,
                error_message, channel, target_url, request_body, response_body,
                prompt_tokens, completion_tokens,
                total_tokens, model
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                log.id,
                log.timestamp.to_rfc3339(),
                log.service,
                log.method,
                log.path,
                log.status_code as i64,
                log.duration_ms as i64,
                log.error_message,
                log.channel,
                log.target_url,
                log.request_body,
                log.response_body,
                log.usage.as_ref().map(|u| u.prompt_tokens as i64),
                log.usage.as_ref().map(|u| u.completion_tokens as i64),
                log.usage.as_ref().map(|u| u.total_tokens as i64),
                log.usage.as_ref().map(|u| u.model.clone()),
            ],
        )?;

        drop(db);

        // Maintain log limit
        self.maintain_log_limit()?;

        debug!("Logged request: {} {} - {}", log.method, log.path, log.status_code);

        Ok(())
    }

    fn maintain_log_limit(&self) -> Result<(), ProxyError> {
        let db = self.db.lock().unwrap();

        // Count current logs
        let count: i64 = db.query_row("SELECT COUNT(*) FROM request_logs", [], |row| row.get(0))?;

        if count > self.max_logs as i64 {
            let to_delete = count - self.max_logs as i64;
            
            // Delete oldest logs
            db.execute(
                "DELETE FROM request_logs WHERE id IN (
                    SELECT id FROM request_logs ORDER BY timestamp ASC LIMIT ?1
                )",
                params![to_delete],
            )?;

            debug!("Deleted {} old log entries", to_delete);
        }

        Ok(())
    }

    pub fn get_logs(&self, limit: usize, offset: usize) -> Result<Vec<RequestLog>, ProxyError> {
        let db = self.db.lock().unwrap();

        let mut stmt = db.prepare(
            "SELECT id, timestamp, service, method, path, status_code, duration_ms,
                    error_message, channel, target_url, request_body, response_body,
                    prompt_tokens, completion_tokens,
                    total_tokens, model
             FROM request_logs
             ORDER BY timestamp DESC
             LIMIT ?1 OFFSET ?2"
        )?;

        let logs = stmt
            .query_map(params![limit as i64, offset as i64], |row| {
                let timestamp_str: String = row.get(1)?;
                let timestamp = DateTime::parse_from_rfc3339(&timestamp_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());

                let usage = if let (Some(prompt), Some(completion), Some(total), Some(model)) = (
                    row.get::<_, Option<i64>>(10)?,
                    row.get::<_, Option<i64>>(11)?,
                    row.get::<_, Option<i64>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                ) {
                    Some(UsageMetrics {
                        prompt_tokens: prompt as u64,
                        completion_tokens: completion as u64,
                        total_tokens: total as u64,
                        model,
                    })
                } else {
                    None
                };

                Ok(RequestLog {
                    id: row.get(0)?,
                    timestamp,
                    service: row.get(2)?,
                    method: row.get(3)?,
                    path: row.get(4)?,
                    status_code: row.get::<_, i64>(5)? as u16,
                    duration_ms: row.get::<_, i64>(6)? as u64,
                    error_message: row.get(7)?,
                    channel: row.get(8)?,
                    target_url: row.get(9)?,
                    request_body: row.get(10)?,
                    response_body: row.get(11)?,
                    usage,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(logs)
    }

    pub fn get_log_by_id(&self, id: &str) -> Result<Option<RequestLog>, ProxyError> {
        let db = self.db.lock().unwrap();

        let mut stmt = db.prepare(
            "SELECT id, timestamp, service, method, path, status_code, duration_ms,
                    error_message, channel, target_url, request_body, response_body,
                    prompt_tokens, completion_tokens, total_tokens, model
             FROM request_logs
             WHERE id = ?1"
        )?;

        let log = stmt.query_row(params![id], |row| {
            let timestamp_str: String = row.get(1)?;
            let timestamp = DateTime::parse_from_rfc3339(&timestamp_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            let usage = if let (Some(prompt), Some(completion), Some(total), Some(model)) = (
                row.get::<_, Option<i64>>(12)?,
                row.get::<_, Option<i64>>(13)?,
                row.get::<_, Option<i64>>(14)?,
                row.get::<_, Option<String>>(15)?,
            ) {
                Some(UsageMetrics {
                    prompt_tokens: prompt as u64,
                    completion_tokens: completion as u64,
                    total_tokens: total as u64,
                    model,
                })
            } else {
                None
            };

            Ok(RequestLog {
                id: row.get(0)?,
                timestamp,
                service: row.get(2)?,
                method: row.get(3)?,
                path: row.get(4)?,
                status_code: row.get::<_, i64>(5)? as u16,
                duration_ms: row.get::<_, i64>(6)? as u64,
                error_message: row.get(7)?,
                channel: row.get(8)?,
                target_url: row.get(9)?,
                request_body: row.get(10)?,
                response_body: row.get(11)?,
                usage,
            })
        }).optional()?;

        Ok(log)
    }

    pub fn set_max_logs(&mut self, max_logs: usize) {
        self.max_logs = max_logs;
    }
}
