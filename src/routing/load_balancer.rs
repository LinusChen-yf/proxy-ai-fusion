use crate::error::ProxyError;
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum LoadBalancerMode {
    ActiveFirst,   // 只使用激活的配置
    WeightBased,   // 基于权重的负载均衡
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceLBConfig {
    #[serde(rename = "failureThreshold")]
    pub failure_threshold: u32,
    #[serde(rename = "autoResetMinutes")]
    pub auto_reset_minutes: u32,
    #[serde(rename = "currentFailures")]
    pub current_failures: HashMap<String, u32>,
    #[serde(rename = "excludedConfigs")]
    pub excluded_configs: Vec<String>,
    #[serde(rename = "excludedTimestamps")]
    pub excluded_timestamps: HashMap<String, f64>,
    #[serde(rename = "manualDisabledUntil")]
    pub manual_disabled_until: HashMap<String, String>,
}

impl Default for ServiceLBConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 3,
            auto_reset_minutes: 10,
            current_failures: HashMap::new(),
            excluded_configs: Vec::new(),
            excluded_timestamps: HashMap::new(),
            manual_disabled_until: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerConfig {
    pub mode: LoadBalancerMode,
    pub services: HashMap<String, ServiceLBConfig>,
}

impl Default for LoadBalancerConfig {
    fn default() -> Self {
        let mut services = HashMap::new();
        services.insert("claude".to_string(), ServiceLBConfig::default());
        services.insert("codex".to_string(), ServiceLBConfig::default());

        Self {
            mode: LoadBalancerMode::ActiveFirst,
            services,
        }
    }
}

pub struct LoadBalancer {
    config_file: PathBuf,
    config: Arc<RwLock<LoadBalancerConfig>>,
    last_modified: Arc<RwLock<SystemTime>>,
}

impl LoadBalancer {
    pub fn new() -> Result<Self, ProxyError> {
        let config_dir = Self::get_config_dir()?;
        let config_file = config_dir.join("lb_config.toml");

        let balancer = Self {
            config_file: config_file.clone(),
            config: Arc::new(RwLock::new(LoadBalancerConfig::default())),
            last_modified: Arc::new(RwLock::new(SystemTime::UNIX_EPOCH)),
        };

        balancer.load_config()?;
        Ok(balancer)
    }

    fn get_config_dir() -> Result<PathBuf, ProxyError> {
        let home = dirs::home_dir()
            .ok_or_else(|| ProxyError::ConfigurationError("Cannot find home directory".to_string()))?;
        
        let config_dir = home.join(".paf").join("data");
        fs::create_dir_all(&config_dir).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to create config directory: {}", e))
        })?;

        Ok(config_dir)
    }

    pub fn load_config(&self) -> Result<(), ProxyError> {
        let config = if self.config_file.exists() {
            let content = fs::read_to_string(&self.config_file).map_err(|e| {
                ProxyError::ConfigurationError(format!("Failed to read LB config: {}", e))
            })?;

            serde_json::from_str(&content).unwrap_or_else(|e| {
                warn!("Failed to parse LB config: {}, using default", e);
                LoadBalancerConfig::default()
            })
        } else {
            LoadBalancerConfig::default()
        };

        *self.config.write().unwrap() = config;

        // Update last modified time
        if let Ok(metadata) = fs::metadata(&self.config_file) {
            if let Ok(modified) = metadata.modified() {
                *self.last_modified.write().unwrap() = modified;
            }
        }

        Ok(())
    }

    pub fn check_and_reload(&self) -> Result<(), ProxyError> {
        if !self.config_file.exists() {
            return Ok(());
        }

        if let Ok(metadata) = fs::metadata(&self.config_file) {
            if let Ok(modified) = metadata.modified() {
                let last_modified = *self.last_modified.read().unwrap();
                if modified > last_modified {
                    debug!("LB config file changed, reloading...");
                    self.load_config()?;
                }
            }
        }

        Ok(())
    }

    pub fn get_config(&self) -> LoadBalancerConfig {
        self.config.read().unwrap().clone()
    }

    /// 选择配置（基于负载均衡策略）
    pub fn select_config(
        &self,
        service: &str,
        active_config: &str,
        configs: &HashMap<String, f64>, // config_name -> weight
    ) -> String {
        // 自动重新加载配置
        let _ = self.check_and_reload();

        let mut config_guard = self.config.write().unwrap();
        let mode = config_guard.mode.clone();

        // 确保服务配置存在
        if !config_guard.services.contains_key(service) {
            config_guard.services.insert(service.to_string(), ServiceLBConfig::default());
        }

        let service_config = config_guard.services.get_mut(service).unwrap();

        // 自动重置和清理
        Self::apply_auto_reset(service_config);
        Self::cleanup_manual_disabled(service_config);

        match mode {
            LoadBalancerMode::ActiveFirst => active_config.to_string(),
            LoadBalancerMode::WeightBased => {
                Self::select_weighted_config(active_config, configs, service_config)
            }
        }
    }

    fn select_weighted_config(
        active_config: &str,
        configs: &HashMap<String, f64>,
        service_config: &ServiceLBConfig,
    ) -> String {
        if configs.is_empty() {
            return active_config.to_string();
        }

        let today = Utc::now().date_naive().to_string();

        // 按权重排序配置
        let mut sorted_configs: Vec<_> = configs.iter().collect();
        sorted_configs.sort_by(|a, b| {
            b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(b.0))
        });

        // 选择第一个可用的配置
        for (name, _weight) in &sorted_configs {
            let name_str = *name;
            
            // 检查失败次数
            if let Some(failures) = service_config.current_failures.get(name_str) {
                if *failures >= service_config.failure_threshold {
                    continue;
                }
            }

            // 检查是否在排除列表中
            if service_config.excluded_configs.contains(name_str) {
                continue;
            }

            // 检查是否手动禁用
            if let Some(disabled_until) = service_config.manual_disabled_until.get(name_str) {
                if disabled_until == &today {
                    continue;
                }
            }

            return name_str.to_string();
        }

        // 如果所有配置都不可用，返回激活配置
        if configs.contains_key(active_config) {
            return active_config.to_string();
        }

        // 返回第一个配置
        sorted_configs.iter().next()
            .map(|(name, _)| (*name).clone())
            .unwrap_or_else(|| active_config.to_string())
    }

    /// 记录请求结果（用于更新失败计数）
    pub fn record_result(&self, service: &str, config_name: &str, success: bool) {
        let _ = self.check_and_reload();

        let mut config_guard = self.config.write().unwrap();
        
        // 确保服务配置存在
        if !config_guard.services.contains_key(service) {
            config_guard.services.insert(service.to_string(), ServiceLBConfig::default());
        }

        let service_config = config_guard.services.get_mut(service).unwrap();

        // 自动重置和清理
        Self::apply_auto_reset(service_config);
        Self::cleanup_manual_disabled(service_config);

        if success {
            // 成功：重置失败计数
            service_config.current_failures.insert(config_name.to_string(), 0);
            
            // 从排除列表中移除
            service_config.excluded_configs.retain(|x| x != config_name);
            service_config.excluded_timestamps.remove(config_name);
        } else {
            // 失败：增加失败计数
            let failures = service_config.current_failures
                .entry(config_name.to_string())
                .or_insert(0);
            *failures += 1;

            // 如果达到阈值，加入排除列表
            if *failures >= service_config.failure_threshold {
                if !service_config.excluded_configs.contains(&config_name.to_string()) {
                    service_config.excluded_configs.push(config_name.to_string());
                    
                    // 记录排除时间戳
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_secs_f64();
                    service_config.excluded_timestamps.insert(config_name.to_string(), now);
                }
            }
        }

        // 保存配置
        drop(config_guard);
        let _ = self.save_config();
    }

    fn apply_auto_reset(service_config: &mut ServiceLBConfig) {
        if service_config.auto_reset_minutes == 0 {
            return;
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        
        let reset_duration = (service_config.auto_reset_minutes as f64) * 60.0;

        let mut to_reset = Vec::new();
        for config_name in &service_config.excluded_configs {
            if let Some(&timestamp) = service_config.excluded_timestamps.get(config_name) {
                if now - timestamp >= reset_duration {
                    to_reset.push(config_name.clone());
                }
            }
        }

        for config_name in to_reset {
            service_config.excluded_configs.retain(|x| x != &config_name);
            service_config.excluded_timestamps.remove(&config_name);
            service_config.current_failures.insert(config_name, 0);
        }
    }

    fn cleanup_manual_disabled(service_config: &mut ServiceLBConfig) {
        let today = Utc::now().date_naive().to_string();
        
        service_config.manual_disabled_until.retain(|_name, disabled_until| {
            disabled_until == &today
        });
    }

    fn save_config(&self) -> Result<(), ProxyError> {
        let config = self.config.read().unwrap();
        
        let json = serde_json::to_string_pretty(&*config).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to serialize LB config: {}", e))
        })?;

        fs::write(&self.config_file, json).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to write LB config: {}", e))
        })?;

        // Update last modified time
        if let Ok(metadata) = fs::metadata(&self.config_file) {
            if let Ok(modified) = metadata.modified() {
                *self.last_modified.write().unwrap() = modified;
            }
        }

        Ok(())
    }

    pub fn save_config_external(&self, config: LoadBalancerConfig) -> Result<(), ProxyError> {
        *self.config.write().unwrap() = config;
        self.save_config()
    }
}
