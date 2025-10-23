mod config;
mod daemon;
mod error;
mod logging;
mod proxy;
mod realtime;
mod routing;
mod web;

use clap::{Parser, Subcommand};
use config::ConfigManager;
use daemon::DaemonManager;
use logging::RequestLogger;
use proxy::ProxyService;
use realtime::RealTimeHub;
use std::sync::Arc;
use tracing::{error, info};
use web::WebServer;

#[derive(Parser)]
#[command(name = "proxy-ai-fusion")]
#[command(about = "AI Proxy Fusion - High-performance AI service proxy", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start all proxy services (daemon mode)
    Start,
    /// Stop all proxy services
    Stop,
    /// Restart all proxy services
    Restart,
    /// Show service status
    Status,
    /// Start services in foreground (development mode)
    Dev,
    /// List configurations for a service
    List {
        /// Service name (claude or codex)
        service: String,
    },
    /// Activate a configuration
    Active {
        /// Service name (claude or codex)
        service: String,
        /// Configuration name
        config: String,
    },
    /// Open web UI
    Ui,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Start => {
            let daemon = DaemonManager::new().unwrap_or_else(|e| {
                eprintln!("Failed to initialize daemon manager: {}", e);
                std::process::exit(1);
            });

            // Check if already running
            if daemon.is_running().unwrap_or(false) {
                if let Ok(Some(pid)) = daemon.read_pid() {
                    println!("Services already running (PID: {})", pid);
                    println!("Use 'paf stop' to stop the services first.");
                    std::process::exit(0);
                }
            }

            println!("Starting services in background...");

            // Daemonize the process BEFORE creating tokio runtime
            if let Err(e) = daemon.daemonize() {
                eprintln!("Failed to daemonize: {}", e);
                std::process::exit(1);
            }

            // Now we're in the daemon process
            // Set up file logging for daemon
            let log_dir = dirs::data_local_dir()
                .unwrap()
                .join("proxy-ai-fusion");
            std::fs::create_dir_all(&log_dir).ok();
            let log_file = log_dir.join("paf.log");

            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_file)
                .expect("Failed to open log file");

            tracing_subscriber::fmt()
                .with_writer(std::sync::Arc::new(file))
                .with_ansi(false)
                .with_env_filter(
                    tracing_subscriber::EnvFilter::from_default_env()
                        .add_directive(tracing::Level::INFO.into()),
                )
                .init();

            // Write PID file
            if let Err(e) = daemon.write_pid() {
                std::process::exit(1);
            }

            // Create tokio runtime AFTER daemonizing
            let rt = tokio::runtime::Runtime::new().unwrap();

            // Start services
            rt.block_on(async {
                if let Err(e) = start_services().await {
                    let _ = daemon.remove_pid();
                    std::process::exit(1);
                }
            });
        }
        Commands::Stop => {
            let daemon = DaemonManager::new().unwrap_or_else(|e| {
                eprintln!("Failed to initialize daemon manager: {}", e);
                std::process::exit(1);
            });

            match daemon.stop() {
                Ok(_) => {
                    println!("Services stopped successfully");
                }
                Err(e) => {
                    eprintln!("Failed to stop services: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Commands::Restart => {
            let daemon = DaemonManager::new().unwrap_or_else(|e| {
                eprintln!("Failed to initialize daemon manager: {}", e);
                std::process::exit(1);
            });

            // Stop first
            if daemon.is_running().unwrap_or(false) {
                println!("Stopping services...");
                if let Err(e) = daemon.stop() {
                    eprintln!("Failed to stop services: {}", e);
                    std::process::exit(1);
                }
            }

            // Wait a bit
            std::thread::sleep(std::time::Duration::from_secs(1));

            // Start again
            println!("Starting services...");

            // Daemonize
            if let Err(e) = daemon.daemonize() {
                eprintln!("Failed to daemonize: {}", e);
                std::process::exit(1);
            }

            // Re-initialize logging to file
            let log_dir = dirs::data_local_dir()
                .unwrap()
                .join("proxy-ai-fusion");
            std::fs::create_dir_all(&log_dir).ok();
            let log_file = log_dir.join("paf.log");

            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_file)
                .expect("Failed to open log file");

            tracing_subscriber::fmt()
                .with_writer(std::sync::Arc::new(file))
                .with_ansi(false)
                .init();

            // Write PID
            if let Err(e) = daemon.write_pid() {
                std::process::exit(1);
            }

            // Create runtime and start services
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                if let Err(e) = start_services().await {
                    let _ = daemon.remove_pid();
                    std::process::exit(1);
                }
            });
        }
        Commands::Status => {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(print_status());
        }
        Commands::Dev => {
            // Initialize tracing for dev mode
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::from_default_env()
                        .add_directive(tracing::Level::INFO.into()),
                )
                .init();

            println!("Starting services in development mode...");
            println!("Press Ctrl+C to stop.\n");

            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                if let Err(e) = start_services().await {
                    eprintln!("Failed to start services: {}", e);
                    std::process::exit(1);
                }
            });
        }
        Commands::List { service } => {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(list_configs(&service));
        }
        Commands::Active { service, config } => {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                if let Err(e) = activate_config(&service, &config).await {
                    eprintln!("Failed to activate config: {}", e);
                    std::process::exit(1);
                }
            });
        }
        Commands::Ui => {
            println!("Opening web UI at http://localhost:8800");
            if let Err(e) = open::that("http://localhost:8800") {
                eprintln!("Failed to open browser: {}", e);
            }
        }
    }
}

async fn start_services() -> Result<(), error::ProxyError> {
    info!("Starting Proxy AI Fusion services...");

    // Initialize Claude service
    info!("Initializing Claude service...");
    let claude_config = Arc::new(ConfigManager::new("claude")?);
    let claude_realtime = Arc::new(RealTimeHub::new("claude".to_string(), 100));
    let claude_proxy = Arc::new(ProxyService::new("claude".to_string(), claude_config.clone())?);
    
    // Initialize Codex service
    info!("Initializing Codex service...");
    let codex_config = Arc::new(ConfigManager::new("codex")?);
    let codex_realtime = Arc::new(RealTimeHub::new("codex".to_string(), 100));
    let codex_proxy = Arc::new(ProxyService::new("codex".to_string(), codex_config.clone())?);

    // Initialize shared request logger
    let request_logger = Arc::new(RequestLogger::new()?);

    // Start Claude proxy on port 8801
    let claude_app = create_proxy_router(
        claude_proxy.clone(),
        claude_realtime.clone(),
        request_logger.clone(),
    );
    let claude_listener = tokio::net::TcpListener::bind("0.0.0.0:8801")
        .await
        .map_err(|e| error::ProxyError::InternalError(format!("Failed to bind Claude port: {}", e)))?;
    
    info!("Claude proxy server starting on port 8801");
    tokio::spawn(async move {
        if let Err(e) = axum::serve(claude_listener, claude_app).await {
            error!("Claude proxy server error: {}", e);
        }
    });

    // Start Codex proxy on port 8802
    let codex_app = create_proxy_router(
        codex_proxy.clone(),
        codex_realtime.clone(),
        request_logger.clone(),
    );
    let codex_listener = tokio::net::TcpListener::bind("0.0.0.0:8802")
        .await
        .map_err(|e| error::ProxyError::InternalError(format!("Failed to bind Codex port: {}", e)))?;
    
    info!("Codex proxy server starting on port 8802");
    tokio::spawn(async move {
        if let Err(e) = axum::serve(codex_listener, codex_app).await {
            error!("Codex proxy server error: {}", e);
        }
    });

    // Start Web UI server on port 8800
    info!("Starting Web UI server on port 8800");
    let web_server = WebServer::new(
        8800,
        claude_config.clone(),
        codex_config.clone(),
        request_logger.clone(),
        claude_realtime.clone(),
        claude_proxy.clone(),
    );

    web_server.run().await?;

    Ok(())
}

fn create_proxy_router(
    proxy_service: Arc<ProxyService>,
    realtime_hub: Arc<RealTimeHub>,
    request_logger: Arc<RequestLogger>,
) -> axum::Router {
    use axum::routing::any;

    let state = (proxy_service, realtime_hub, request_logger);

    axum::Router::new()
        .route("/*path", any(proxy_handler))
        .fallback(proxy_handler)
        .with_state(state)
}

async fn proxy_handler(
    axum::extract::State((proxy_service, realtime_hub, request_logger)): axum::extract::State<(
        Arc<ProxyService>,
        Arc<RealTimeHub>,
        Arc<RequestLogger>,
    )>,
    req: axum::extract::Request,
) -> Result<axum::response::Response, error::ProxyError> {
    use axum::body::to_bytes;
    
    let start = std::time::Instant::now();
    let request_id = uuid::Uuid::new_v4().to_string();
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();

    // Extract body
    let (_parts, body) = req.into_parts();
    let body_bytes = to_bytes(body, usize::MAX).await
        .map_err(|e| error::ProxyError::InternalError(format!("Failed to read body: {}", e)))?;

    // Notify real-time hub
    let _config_name = proxy_service.service_name().to_string();
    realtime_hub
        .request_started(
            request_id.clone(),
            method.to_string(),
            uri.path().to_string(),
            proxy_service.service_name().to_string(),
            None,
        )
        .await;

    // Forward request
    let response = proxy_service
        .handle_request(method.clone(), uri.clone(), headers.clone(), body_bytes)
        .await;

    let duration = start.elapsed();
    let status_code = response.as_ref().map(|r| r.status().as_u16()).unwrap_or(500);
    let success = status_code >= 200 && status_code < 400;

    // Record result to load balancer (for failure tracking)
    let config_manager = proxy_service.get_config_manager();
    if let Some(config_name) = config_manager.get_active_config_name() {
        proxy_service.get_load_balancer().record_result(
            proxy_service.service_name(),
            &config_name,
            success,
        );
    }

    // Notify completion
    realtime_hub
        .request_completed(request_id.clone(), status_code, duration.as_millis() as u64, success)
        .await;

    // Log request
    let log = logging::RequestLog {
        id: request_id,
        timestamp: chrono::Utc::now(),
        service: proxy_service.service_name().to_string(),
        method: method.to_string(),
        path: uri.path().to_string(),
        status_code,
        duration_ms: duration.as_millis() as u64,
        error_message: if success { None } else { Some("Request failed".to_string()) },
        channel: Some(proxy_service.service_name().to_string()),
        usage: None, // TODO: Extract usage from response
        target_url: None,
        request_body: None,
        response_body: None,
    };

    if let Err(e) = request_logger.log_request(log) {
        error!("Failed to log request: {}", e);
    }

    response
}

async fn print_status() {
    println!("=== Proxy AI Fusion Service Status ===\n");

    let daemon = match DaemonManager::new() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Failed to initialize daemon manager: {}", e);
            return;
        }
    };

    let (is_running, pid) = match daemon.is_running() {
        Ok(running) => {
            let pid = if running {
                daemon.read_pid().ok().flatten()
            } else {
                None
            };
            (running, pid)
        }
        Err(_) => (false, None),
    };

    let status_text = if is_running {
        "Running"
    } else {
        "Stopped"
    };

    let pid_text = if let Some(p) = pid {
        format!(" (PID: {})", p)
    } else {
        String::new()
    };

    println!("Main Process:");
    println!("  Status: {}{}", status_text, pid_text);
    if let Ok(Some(p)) = daemon.read_pid() {
        println!("  PID File: {:?}", daemon.get_pid_file());
    }
    println!();

    if is_running {
        // Try to check if services are responding
        println!("Services:");
        println!("  Claude Proxy: Port 8801");
        println!("  Codex Proxy:  Port 8802");
        println!("  Web UI:       Port 8800");
        println!();
        println!("Access Web UI at: http://localhost:8800");

        // Load and display active configurations
        if let Ok(claude_manager) = ConfigManager::new("claude") {
            if let Some(active) = claude_manager.get_active_config_name() {
                println!();
                println!("Active Configurations:");
                println!("  Claude: {}", active);
            }
        }

        if let Ok(codex_manager) = ConfigManager::new("codex") {
            if let Some(active) = codex_manager.get_active_config_name() {
                println!("  Codex:  {}", active);
            }
        }
    } else {
        println!("All services are stopped.");
        println!("Use 'paf start' to start the services.");
    }
}

async fn list_configs(service: &str) {
    match ConfigManager::new(service) {
        Ok(manager) => {
            let configs = manager.get_configs();
            let active = manager.get_active_config_name();

            println!("=== {} Configurations ===\n", service);

            let is_empty = configs.is_empty();

            for (name, config) in configs {
                let is_active = active.as_ref().map(|a| a == &name).unwrap_or(false);
                let marker = if is_active { " [ACTIVE]" } else { "" };

                println!("  {}{}:", name, marker);
                println!("    Base URL: {}", config.base_url);
                println!("    Weight: {}", config.weight);
                println!();
            }

            if is_empty {
                println!("  No configurations found.");
            }
        }
        Err(e) => {
            eprintln!("Failed to load configurations: {}", e);
        }
    }
}

async fn activate_config(service: &str, config_name: &str) -> Result<(), error::ProxyError> {
    let manager = ConfigManager::new(service)?;
    manager.set_active_config(config_name)?;
    
    info!("Activated {} configuration: {}", service, config_name);
    Ok(())
}
