use crate::config::{ConfigManager, ServiceConfig};
use crate::error::ProxyError;
use crate::routing::LoadBalancer;
use axum::{
    body::{Body, Bytes},
    http::{HeaderMap, Method, Uri},
    response::Response,
};
use reqwest::Client;
use std::sync::Arc;
use tracing::debug;

#[derive(Clone)]
pub struct ProxyService {
    http_client: Client,
    config_manager: Arc<ConfigManager>,
    service_name: String,
    load_balancer: Arc<LoadBalancer>,
}

impl ProxyService {
    pub fn new(service_name: String, config_manager: Arc<ConfigManager>) -> Result<Self, ProxyError> {
        let http_client = Client::builder()
            .timeout(std::time::Duration::from_secs(300)) // 5 minutes timeout
            .connect_timeout(std::time::Duration::from_secs(30))
            .pool_max_idle_per_host(100)
            .pool_idle_timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| ProxyError::InternalError(format!("Failed to create HTTP client: {}", e)))?;

        let load_balancer = Arc::new(LoadBalancer::new()?);

        Ok(Self {
            http_client,
            config_manager,
            service_name,
            load_balancer,
        })
    }

    pub async fn handle_request(
        &self,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> Result<Response, ProxyError> {
        // 选择配置（考虑负载均衡）
        let (config, _config_name) = self.select_config()?;

        // Build target URL
        let path = uri.path();
        let query = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();
        let target_url = format!("{}{}{}", config.base_url.trim_end_matches('/'), path, query);

        debug!(
            "Proxying request: {} {} -> {}",
            method, path, target_url
        );

        // Build headers
        let target_headers = self.build_headers(&headers, &config, &target_url)?;

        // Check if streaming is needed
        let is_stream = self.is_streaming_request(&headers);

        // Build and send request
        let mut request_builder = self
            .http_client
            .request(method.clone(), &target_url)
            .headers(target_headers);

        if !body.is_empty() {
            request_builder = request_builder.body(body.to_vec());
        }

        let response = request_builder.send().await?;

        let status = response.status();
        let response_headers = response.headers().clone();

        // Build response
        let mut resp_builder = Response::builder().status(status);

        // Copy safe headers to response
        for (key, value) in response_headers.iter() {
            let key_lower = key.as_str().to_lowercase();
            if !matches!(
                key_lower.as_str(),
                "connection" | "transfer-encoding" | "content-length"
            ) {
                resp_builder = resp_builder.header(key, value);
            }
        }

        if is_stream {
            // Stream response
            let stream = response.bytes_stream();
            let body = Body::from_stream(stream);
            Ok(resp_builder.body(body).unwrap())
        } else {
            // Buffer entire response
            let bytes = response.bytes().await?;
            Ok(resp_builder.body(Body::from(bytes)).unwrap())
        }
    }

    fn build_headers(
        &self,
        original_headers: &HeaderMap,
        config: &ServiceConfig,
        target_url: &str,
    ) -> Result<reqwest::header::HeaderMap, ProxyError> {
        let mut headers = reqwest::header::HeaderMap::new();

        // Copy headers except excluded ones
        let excluded = ["host", "content-length", "x-api-key", "authorization"];
        for (key, value) in original_headers.iter() {
            let key_str = key.as_str().to_lowercase();
            if !excluded.contains(&key_str.as_str()) {
                if let Ok(val) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                    headers.insert(
                        reqwest::header::HeaderName::from_bytes(key.as_str().as_bytes()).unwrap(),
                        val,
                    );
                }
            }
        }

        // Set host header
        if let Ok(url) = url::Url::parse(target_url) {
            if let Some(host) = url.host_str() {
                headers.insert(
                    reqwest::header::HOST,
                    reqwest::header::HeaderValue::from_str(host).unwrap(),
                );
            }
        }

        // Set authentication headers
        if let Some(ref api_key) = config.api_key {
            headers.insert(
                reqwest::header::HeaderName::from_static("x-api-key"),
                reqwest::header::HeaderValue::from_str(api_key).unwrap(),
            );
        }

        if let Some(ref auth_token) = config.auth_token {
            headers.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&format!("Bearer {}", auth_token)).unwrap(),
            );
        }

        // Set keep-alive
        headers.insert(
            reqwest::header::CONNECTION,
            reqwest::header::HeaderValue::from_static("keep-alive"),
        );

        Ok(headers)
    }

    fn is_streaming_request(&self, headers: &HeaderMap) -> bool {
        // Check for streaming indicators in headers
        if let Some(accept) = headers.get("accept") {
            if let Ok(accept_str) = accept.to_str() {
                if accept_str.contains("text/event-stream") 
                    || accept_str.contains("application/x-ndjson") {
                    return true;
                }
            }
        }

        if let Some(content_type) = headers.get("content-type") {
            if let Ok(ct_str) = content_type.to_str() {
                if ct_str.contains("stream") || ct_str.contains("event-stream") {
                    return true;
                }
            }
        }

        if let Some(method) = headers.get("x-stainless-helper-method") {
            if let Ok(method_str) = method.to_str() {
                if method_str.to_lowercase().contains("stream") {
                    return true;
                }
            }
        }

        false
    }

    pub fn service_name(&self) -> &str {
        &self.service_name
    }

    pub fn get_config_manager(&self) -> Arc<ConfigManager> {
        self.config_manager.clone()
    }

    /// 选择配置（考虑负载均衡）
    fn select_config(&self) -> Result<(ServiceConfig, String), ProxyError> {
        let configs = self.config_manager.get_configs();
        let active_config_name = self.config_manager.get_active_config_name()
            .ok_or_else(|| ProxyError::ConfigurationError("No active configuration".to_string()))?;

        // 构建配置权重映射
        let config_weights: std::collections::HashMap<String, f64> = configs
            .iter()
            .map(|(name, config)| (name.clone(), config.weight))
            .collect();

        // 使用负载均衡器选择配置
        let selected_config_name = self.load_balancer.select_config(
            &self.service_name,
            &active_config_name,
            &config_weights,
        );

        // 获取最终配置
        let final_config = configs.get(&selected_config_name)
            .ok_or_else(|| ProxyError::ConfigurationError(format!("Configuration '{}' not found", selected_config_name)))?
            .clone();

        Ok((final_config, selected_config_name))
    }

    pub fn get_load_balancer(&self) -> Arc<LoadBalancer> {
        self.load_balancer.clone()
    }
}
