use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::fmt;

#[derive(Debug)]
pub enum ProxyError {
    ConfigurationError(String),
    UpstreamError {
        status: u16,
        message: String,
        details: Option<String>,
    },
    NetworkError(String),
    TimeoutError,
    InternalError(String),
    DatabaseError(String),
}

impl fmt::Display for ProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProxyError::ConfigurationError(msg) => write!(f, "Configuration error: {}", msg),
            ProxyError::UpstreamError { message, .. } => write!(f, "Upstream error: {}", message),
            ProxyError::NetworkError(msg) => write!(f, "Network error: {}", msg),
            ProxyError::TimeoutError => write!(f, "Request timeout"),
            ProxyError::InternalError(msg) => write!(f, "Internal error: {}", msg),
            ProxyError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
        }
    }
}

impl std::error::Error for ProxyError {}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        let (status, error_type, message, details) = match self {
            ProxyError::ConfigurationError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "ConfigurationError", msg, None)
            }
            ProxyError::UpstreamError {
                status,
                message,
                details,
            } => (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                "UpstreamError",
                message,
                details,
            ),
            ProxyError::NetworkError(msg) => {
                (StatusCode::BAD_GATEWAY, "NetworkError", msg, None)
            }
            ProxyError::TimeoutError => (
                StatusCode::GATEWAY_TIMEOUT,
                "TimeoutError",
                "Request timeout".to_string(),
                None,
            ),
            ProxyError::InternalError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "InternalError", msg, None)
            }
            ProxyError::DatabaseError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "DatabaseError", msg, None)
            }
        };

        let body = json!({
            "error": {
                "type": error_type,
                "message": message,
                "details": details,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            }
        });

        (status, Json(body)).into_response()
    }
}

impl From<reqwest::Error> for ProxyError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            ProxyError::TimeoutError
        } else if err.is_connect() {
            ProxyError::NetworkError(format!("Connection failed: {}", err))
        } else {
            ProxyError::NetworkError(err.to_string())
        }
    }
}

impl From<rusqlite::Error> for ProxyError {
    fn from(err: rusqlite::Error) -> Self {
        ProxyError::DatabaseError(err.to_string())
    }
}

impl From<serde_json::Error> for ProxyError {
    fn from(err: serde_json::Error) -> Self {
        ProxyError::InternalError(format!("JSON error: {}", err))
    }
}
