use axum::extract::ws::{Message, WebSocket};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealTimeRequest {
    pub request_id: String,
    pub service: String,
    pub channel: String,
    pub method: String,
    pub path: String,
    pub start_time: DateTime<Utc>,
    pub status: String,
    pub duration_ms: u64,
    pub status_code: Option<u16>,
    pub target_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum Event {
    #[serde(rename = "started")]
    RequestStarted {
        request_id: String,
        service: String,
        channel: String,
        method: String,
        path: String,
        timestamp: DateTime<Utc>,
        target_url: Option<String>,
    },
    #[serde(rename = "progress")]
    RequestProgress {
        request_id: String,
        status: String,
        duration_ms: u64,
        response_delta: Option<String>,
    },
    #[serde(rename = "completed")]
    RequestCompleted {
        request_id: String,
        status: String,
        status_code: u16,
        duration_ms: u64,
    },
    #[serde(rename = "failed")]
    RequestFailed {
        request_id: String,
        status: String,
        status_code: u16,
        duration_ms: u64,
    },
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Clone)]
pub struct RealTimeHub {
    service_name: String,
    event_tx: broadcast::Sender<Event>,
    active_requests: Arc<RwLock<HashMap<String, RealTimeRequest>>>,
}

impl RealTimeHub {
    pub fn new(service_name: String, _max_requests: usize) -> Self {
        let (event_tx, _) = broadcast::channel(1000);

        Self {
            service_name,
            event_tx,
            active_requests: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn handle_connection(&self, socket: WebSocket) {
        let mut rx = self.event_tx.subscribe();
        let (mut sender, mut receiver) = socket.split();

        // Send snapshot of active requests
        if let Err(e) = self.send_snapshot(&mut sender).await {
            error!("Failed to send snapshot: {}", e);
            return;
        }

        // Spawn task to handle incoming messages (ping/pong)
        let mut recv_task = tokio::spawn(async move {
            while let Some(Ok(msg)) = receiver.next().await {
                if let Message::Close(_) = msg {
                    break;
                }
            }
        });

        // Spawn task to broadcast events
        let mut send_task = tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                let json = serde_json::to_string(&event).unwrap_or_default();
                if let Err(e) = sender.send(Message::Text(json)).await {
                    error!("Failed to send message: {}", e);
                    break;
                }
            }
        });

        // Wait for either task to finish
        tokio::select! {
            _ = (&mut send_task) => {
                recv_task.abort();
            },
            _ = (&mut recv_task) => {
                send_task.abort();
            },
        }

        info!("WebSocket connection closed");
    }

    async fn send_snapshot(&self, sender: &mut futures_util::stream::SplitSink<WebSocket, Message>) -> Result<(), Box<dyn std::error::Error>> {
        let requests = self.active_requests.read().await;
        
        for request in requests.values() {
            let event = Event::RequestStarted {
                request_id: request.request_id.clone(),
                service: request.service.clone(),
                channel: request.channel.clone(),
                method: request.method.clone(),
                path: request.path.clone(),
                timestamp: request.start_time,
                target_url: request.target_url.clone(),
            };

            let json = serde_json::to_string(&event)?;
            sender.send(Message::Text(json)).await?;
        }

        Ok(())
    }

    pub async fn request_started(
        &self,
        request_id: String,
        method: String,
        path: String,
        channel: String,
        target_url: Option<String>,
    ) {
        let request = RealTimeRequest {
            request_id: request_id.clone(),
            service: self.service_name.clone(),
            channel: channel.clone(),
            method: method.clone(),
            path: path.clone(),
            start_time: Utc::now(),
            status: "PENDING".to_string(),
            duration_ms: 0,
            status_code: None,
            target_url: target_url.clone(),
        };

        self.active_requests.write().await.insert(request_id.clone(), request);

        let event = Event::RequestStarted {
            request_id,
            service: self.service_name.clone(),
            channel,
            method,
            path,
            timestamp: Utc::now(),
            target_url,
        };

        let _ = self.event_tx.send(event);
        self.cleanup_old_requests().await;
    }

    pub async fn request_streaming(&self, request_id: String, duration_ms: u64) {
        if let Some(request) = self.active_requests.write().await.get_mut(&request_id) {
            request.status = "STREAMING".to_string();
            request.duration_ms = duration_ms;
        }

        let event = Event::RequestProgress {
            request_id,
            status: "STREAMING".to_string(),
            duration_ms,
            response_delta: None,
        };

        let _ = self.event_tx.send(event);
    }

    pub async fn response_chunk(&self, request_id: String, chunk: String, duration_ms: u64) {
        if let Some(request) = self.active_requests.write().await.get_mut(&request_id) {
            request.duration_ms = duration_ms;
        }

        let event = Event::RequestProgress {
            request_id,
            status: "STREAMING".to_string(),
            duration_ms,
            response_delta: Some(chunk),
        };

        let _ = self.event_tx.send(event);
    }

    pub async fn request_completed(&self, request_id: String, status_code: u16, duration_ms: u64, success: bool) {
        if let Some(request) = self.active_requests.write().await.get_mut(&request_id) {
            request.status = if success { "COMPLETED" } else { "FAILED" }.to_string();
            request.status_code = Some(status_code);
            request.duration_ms = duration_ms;
        }

        let event = if success {
            Event::RequestCompleted {
                request_id: request_id.clone(),
                status: "COMPLETED".to_string(),
                status_code,
                duration_ms,
            }
        } else {
            Event::RequestFailed {
                request_id: request_id.clone(),
                status: "FAILED".to_string(),
                status_code,
                duration_ms,
            }
        };

        let _ = self.event_tx.send(event);

        // Schedule cleanup after 30 seconds
        let active_requests = self.active_requests.clone();
        let req_id = request_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            active_requests.write().await.remove(&req_id);
        });
    }

    async fn cleanup_old_requests(&self) {
        let mut requests = self.active_requests.write().await;
        
        if requests.len() > 100 {
            let mut sorted: Vec<_> = requests.iter().map(|(k, v)| (k.clone(), v.start_time)).collect();
            sorted.sort_by(|a, b| b.1.cmp(&a.1));
            
            // Keep only the 100 most recent requests
            for (id, _) in sorted.iter().skip(100) {
                requests.remove(id);
            }
        }
    }

    pub fn get_connection_count(&self) -> usize {
        self.event_tx.receiver_count()
    }
}
