use crate::config::ConfigManager;
use crate::error::ProxyError;
use crate::logging::{RequestLog, RequestLogger};
use crate::proxy::ProxyService;
use crate::realtime::RealTimeHub;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use chrono::Utc;
use reqwest::Client;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use rust_embed::RustEmbed;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower_http::cors::CorsLayer;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(RustEmbed)]
#[folder = "frontend/dist"]
struct FrontendAssets;

#[derive(Clone)]
pub struct AppState {
    pub claude_config_manager: Arc<ConfigManager>,
    pub codex_config_manager: Arc<ConfigManager>,
    pub request_logger: Arc<RequestLogger>,
    pub realtime_hub: Arc<RealTimeHub>,
    pub proxy_service: Arc<ProxyService>,
}

pub struct WebServer {
    app: Router,
    port: u16,
}

impl WebServer {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        port: u16,
        claude_config_manager: Arc<ConfigManager>,
        codex_config_manager: Arc<ConfigManager>,
        request_logger: Arc<RequestLogger>,
        realtime_hub: Arc<RealTimeHub>,
        proxy_service: Arc<ProxyService>,
    ) -> Self {
        let state = AppState {
            claude_config_manager,
            codex_config_manager,
            request_logger,
            realtime_hub,
            proxy_service,
        };

        let app = Router::new()
            // Health check
            .route("/api/status", get(status_handler))

            // Service-specific configuration management
            .route("/api/configs/separated", get(list_separated_configs_handler))
            .route(
                "/api/configs/claude",
                get(list_claude_configs_handler).post(create_claude_config_handler),
            )
            .route(
                "/api/configs/claude/:name",
                put(update_claude_config_handler).delete(delete_claude_config_handler),
            )
            .route(
                "/api/configs/claude/:name/activate",
                post(activate_claude_config_handler),
            )
            .route(
                "/api/configs/codex",
                get(list_codex_configs_handler).post(create_codex_config_handler),
            )
            .route(
                "/api/configs/codex/:name",
                put(update_codex_config_handler).delete(delete_codex_config_handler),
            )
            .route(
                "/api/configs/codex/:name/activate",
                post(activate_codex_config_handler),
            )
            .route(
                "/api/configs/claude/:name/test/api",
                post(test_claude_api_handler),
            )
            .route(
                "/api/configs/codex/:name/test/api",
                post(test_codex_api_handler),
            )

            // Legacy configuration management (defaults to Claude service)
            .route(
                "/api/configs",
                get(list_configs_handler).post(create_config_handler),
            )
            .route(
                "/api/configs/:name",
                put(update_config_handler).delete(delete_config_handler),
            )
            .route("/api/configs/:name/activate", post(activate_config_handler))

            // Logs
            .route("/api/logs", get(list_logs_handler))
            .route("/api/logs/:id", get(get_log_handler))

            // Load Balancer
            .route("/api/loadbalancer", get(get_lb_config_handler))
            .route("/api/loadbalancer", put(update_lb_config_handler))

            // WebSocket endpoint
            .route("/ws/realtime", get(super::routes::websocket_handler))

            .with_state(state)
            .layer(CorsLayer::permissive())
            // Serve embedded static files, fallback to index.html for SPA routing
            .fallback(static_handler);

        Self { app, port }
    }

    pub fn router(self) -> Router {
        self.app
    }

    pub async fn run(self) -> Result<(), ProxyError> {
        let addr = format!("0.0.0.0:{}", self.port);
        info!("Web server starting on {}", addr);

        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| ProxyError::InternalError(format!("Failed to bind to {}: {}", addr, e)))?;

        axum::serve(listener, self.app)
            .await
            .map_err(|e| ProxyError::InternalError(format!("Server error: {}", e)))?;

        Ok(())
    }
}

#[derive(Deserialize)]
struct CreateConfigRequest {
    name: String,
    base_url: String,
    api_key: Option<String>,
    auth_token: Option<String>,
    weight: Option<f64>,
}

#[derive(Deserialize)]
struct LogQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

fn configs_payload(manager: &ConfigManager) -> serde_json::Value {
    serde_json::json!({
        "configs": manager.get_configs(),
        "active": manager.get_active_config_name(),
    })
}

fn add_config_for(
    manager: &Arc<ConfigManager>,
    payload: CreateConfigRequest,
) -> Result<(), ProxyError> {
    let CreateConfigRequest {
        name,
        base_url,
        api_key,
        auth_token,
        weight,
    } = payload;

    let mut config = crate::config::ServiceConfig::new(name, base_url, api_key, auth_token);
    if let Some(weight) = weight {
        config = config.with_weight(weight);
    }

    manager.add_config(config)?;
    Ok(())
}

fn update_config_for(
    manager: &Arc<ConfigManager>,
    current_name: String,
    payload: CreateConfigRequest,
) -> Result<(), ProxyError> {
    manager.remove_config(&current_name)?;

    let CreateConfigRequest {
        name,
        base_url,
        api_key,
        auth_token,
        weight,
    } = payload;

    let mut config = crate::config::ServiceConfig::new(name, base_url, api_key, auth_token);
    if let Some(weight) = weight {
        config = config.with_weight(weight);
    }

    manager.add_config(config)?;
    Ok(())
}

fn delete_config_for(manager: &Arc<ConfigManager>, name: &str) -> Result<(), ProxyError> {
    manager.remove_config(name)?;
    Ok(())
}

fn activate_config_for(manager: &Arc<ConfigManager>, name: &str) -> Result<(), ProxyError> {
    manager.set_active_config(name)?;
    Ok(())
}

// Handler implementations

async fn status_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

async fn list_separated_configs_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "claude": configs_payload(state.claude_config_manager.as_ref()),
        "codex": configs_payload(state.codex_config_manager.as_ref()),
    }))
}

async fn list_claude_configs_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(configs_payload(state.claude_config_manager.as_ref()))
}

async fn create_claude_config_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateConfigRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ProxyError> {
    add_config_for(&state.claude_config_manager, payload)?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "status": "created" })),
    ))
}

async fn update_claude_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(payload): Json<CreateConfigRequest>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    update_config_for(&state.claude_config_manager, name, payload)?;

    Ok(Json(serde_json::json!({ "status": "updated" })))
}

async fn delete_claude_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    delete_config_for(&state.claude_config_manager, &name)?;

    Ok(Json(serde_json::json!({ "status": "deleted" })))
}

async fn activate_claude_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    activate_config_for(&state.claude_config_manager, &name)?;

    Ok(Json(serde_json::json!({
        "status": "activated",
        "active": name,
    })))
}

async fn list_codex_configs_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(configs_payload(state.codex_config_manager.as_ref()))
}

async fn create_codex_config_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateConfigRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ProxyError> {
    add_config_for(&state.codex_config_manager, payload)?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "status": "created" })),
    ))
}

async fn update_codex_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(payload): Json<CreateConfigRequest>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    update_config_for(&state.codex_config_manager, name, payload)?;

    Ok(Json(serde_json::json!({ "status": "updated" })))
}

async fn delete_codex_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    delete_config_for(&state.codex_config_manager, &name)?;

    Ok(Json(serde_json::json!({ "status": "deleted" })))
}

async fn activate_codex_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    activate_config_for(&state.codex_config_manager, &name)?;

    Ok(Json(serde_json::json!({
        "status": "activated",
        "active": name,
    })))
}

async fn test_claude_api_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    test_config_endpoint(
        "claude",
        &state.claude_config_manager,
        &state.request_logger,
        &name,
    )
    .await
}

async fn test_codex_api_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    test_config_endpoint(
        "codex",
        &state.codex_config_manager,
        &state.request_logger,
        &name,
    )
    .await
}

// Legacy handlers (default to Claude)

async fn list_configs_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(configs_payload(state.claude_config_manager.as_ref()))
}

async fn create_config_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateConfigRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), ProxyError> {
    add_config_for(&state.claude_config_manager, payload)?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "status": "created" })),
    ))
}

async fn update_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(payload): Json<CreateConfigRequest>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    update_config_for(&state.claude_config_manager, name, payload)?;

    Ok(Json(serde_json::json!({ "status": "updated" })))
}

async fn delete_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    delete_config_for(&state.claude_config_manager, &name)?;

    Ok(Json(serde_json::json!({ "status": "deleted" })))
}

async fn activate_config_handler(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    activate_config_for(&state.claude_config_manager, &name)?;

    Ok(Json(serde_json::json!({
        "status": "activated",
        "active": name,
    })))
}

async fn list_logs_handler(
    State(state): State<AppState>,
    Query(query): Query<LogQuery>,
) -> Result<Json<Vec<crate::logging::RequestLog>>, ProxyError> {
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);

    let logs = state.request_logger.get_logs(limit, offset)?;
    Ok(Json(logs))
}

async fn get_log_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::logging::RequestLog>, ProxyError> {
    let log = state
        .request_logger
        .get_log_by_id(&id)?
        .ok_or_else(|| ProxyError::InternalError("Log not found".to_string()))?;

    Ok(Json(log))
}

// Load Balancer handlers
async fn get_lb_config_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let lb = state.proxy_service.get_load_balancer();
    let config = lb.get_config();
    Json(serde_json::to_value(config).unwrap())
}

async fn update_lb_config_handler(
    State(state): State<AppState>,
    Json(config): Json<crate::routing::LoadBalancerConfig>,
) -> Result<Json<serde_json::Value>, ProxyError> {
    let lb = state.proxy_service.get_load_balancer();
    lb.save_config_external(config)?;

    Ok(Json(serde_json::json!({
        "status": "updated"
    })))
}

async fn test_config_endpoint(
    service: &str,
    manager: &Arc<ConfigManager>,
    request_logger: &Arc<RequestLogger>,
    name: &str,
) -> Result<Json<serde_json::Value>, ProxyError> {
    let configs = manager.get_configs();
    let config = configs
        .get(name)
        .cloned()
        .ok_or_else(|| ProxyError::ConfigurationError(format!("Configuration '{}' not found", name)))?;

    if config.api_key.is_none() && config.auth_token.is_none() {
        return Ok(Json(serde_json::json!({
            "success": false,
            "message": "No API credentials configured."
        })));
    }

    let result = execute_connectivity_test(service, name, config, request_logger).await;
    Ok(Json(result))
}

async fn execute_connectivity_test(
    service: &str,
    config_name: &str,
    config: crate::config::ServiceConfig,
    request_logger: &Arc<RequestLogger>,
) -> serde_json::Value {
    let client = match Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            return serde_json::json!({
                "success": false,
                "message": format!("Failed to create HTTP client: {}", err),
            });
        }
    };

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    if let Some(ref api_key) = config.api_key {
        if let Ok(value) = HeaderValue::from_str(api_key) {
            headers.insert("x-api-key", value);
        }
    }
    if let Some(ref token) = config.auth_token {
        if let Ok(value) = HeaderValue::from_str(&format!("Bearer {}", token)) {
            headers.insert(AUTHORIZATION, value);
        }
    }

    let base_url = config.base_url.trim_end_matches('/');

    // Fetch available model if possible
    let model = fetch_model_identifier(&client, base_url, service, &headers).await;
    let fallback_model = match service {
        "claude" => "claude-3-5-sonnet-20241022",
        "codex" => "gpt-4.1-mini",
        _ => "default",
    };
    let model_id = model.unwrap_or_else(|| fallback_model.to_string());

    let (target_path, request_body) = match service {
        "claude" => {
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
            (
                "/v1/messages",
                serde_json::json!({
                    "model": model_id,
                    "max_output_tokens": 32,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "health check"
                                }
                            ]
                        }
                    ]
                }),
            )
        }
        "codex" => (
            "/v1/responses",
            serde_json::json!({
                "model": model_id,
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "health check"
                            }
                        ]
                    }
                ],
                "max_output_tokens": 32
            }),
        ),
        _ => (
            "/",
            serde_json::json!({
                "ping": true
            }),
        ),
    };

    let target_url = format!("{}{}", base_url, target_path);

    let start = Instant::now();
    let outcome = match client
        .post(&target_url)
        .headers(headers.clone())
        .json(&request_body)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            let duration_ms = start.elapsed().as_millis() as u64;
            let body_text = response.text().await.unwrap_or_default();
            let message = if body_text.is_empty() {
                status
                    .canonical_reason()
                    .map(|s| s.to_string())
                    .unwrap_or_default()
            } else {
                limit_string(&body_text, 512)
            };

            EndpointOutcome {
                success: status.is_success(),
                status_code: Some(status.as_u16()),
                duration_ms,
                message: Some(message),
                response_text: if body_text.is_empty() {
                    None
                } else {
                    Some(body_text)
                },
            }
        }
        Err(err) => EndpointOutcome {
            success: false,
            status_code: None,
            duration_ms: start.elapsed().as_millis() as u64,
            message: Some(err.to_string()),
            response_text: None,
        },
    };

    let log_entry = RequestLog {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now(),
        service: service.to_string(),
        method: "POST".to_string(),
        path: target_path.to_string(),
        status_code: outcome.status_code.unwrap_or(0),
        duration_ms: outcome.duration_ms,
        error_message: if outcome.success {
            None
        } else {
            outcome.message.clone()
        },
        channel: Some(format!("config-test:{}", config_name)),
        usage: None,
        target_url: Some(target_url),
        request_body: Some(limit_string(&request_body.to_string(), 2048)),
        response_body: outcome.response_text.clone().map(|text| limit_string(&text, 4096)),
    };

    if let Err(err) = request_logger.log_request(log_entry) {
        warn!("Failed to log configuration test request: {}", err);
    }

    serde_json::json!({
        "success": outcome.success,
        "status_code": outcome.status_code,
        "message": outcome.message,
        "duration_ms": outcome.duration_ms,
        "response_preview": outcome
            .response_text
            .as_ref()
            .map(|text| limit_string(text, 256)),
    })
}

async fn fetch_model_identifier(
    client: &Client,
    base_url: &str,
    service: &str,
    headers: &HeaderMap,
) -> Option<String> {
    let models_url = format!("{}/v1/models", base_url);
    let response = client.get(&models_url).headers(headers.clone()).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let payload: Value = response.json().await.ok()?;

    let candidates = payload
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| payload.get("models").and_then(Value::as_array));

    if let Some(models) = candidates {
        for entry in models {
            if let Some(id) = entry.get("id").and_then(Value::as_str) {
                if service == "claude" && id.starts_with("claude") {
                    return Some(id.to_string());
                }
                if service == "codex" && (id.starts_with("gpt") || id.starts_with("o1")) {
                    return Some(id.to_string());
                }
            }
        }
        if let Some(first) = models.first().and_then(|entry| entry.get("id").and_then(Value::as_str)) {
            return Some(first.to_string());
        }
    }

    None
}

struct EndpointOutcome {
    success: bool,
    status_code: Option<u16>,
    duration_ms: u64,
    message: Option<String>,
    response_text: Option<String>,
}

fn limit_string(input: &str, max: usize) -> String {
    if input.len() <= max {
        return input.to_string();
    }

    let mut truncated = String::new();
    for ch in input.chars() {
        let char_len = ch.len_utf8();
        if truncated.len() + char_len > max {
            break;
        }
        truncated.push(ch);
    }

    if truncated.is_empty() {
        if let Some(first) = input.chars().next() {
            return format!("{}…", first);
        }
        return String::new();
    }

    if truncated.len() < input.len() {
        truncated.push('…');
    }

    truncated
}

// Static file handler for embedded frontend assets
async fn static_handler(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');

    // If path is empty, serve index.html
    if path.is_empty() {
        return serve_file("index.html");
    }

    // Try to serve the requested file
    match FrontendAssets::get(path) {
        Some(_) => serve_file(path),
        None => {
            // For SPA routing: if the file doesn't exist and it's not an API/WS request,
            // serve index.html to let the frontend router handle it
            if !path.starts_with("api/") && !path.starts_with("ws/") {
                serve_file("index.html")
            } else {
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Body::from("Not Found"))
                    .unwrap()
            }
        }
    }
}

fn serve_file(path: &str) -> Response {
    match FrontendAssets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(content.data.into_owned()))
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap(),
    }
}
