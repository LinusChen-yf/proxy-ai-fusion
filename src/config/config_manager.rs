use super::ServiceConfig;
use crate::error::ProxyError;
use toml::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tracing::{debug, info};

#[derive(Debug, Clone)]
pub struct ConfigManager {
    service_name: String,
    config_file: PathBuf,
    configs: Arc<RwLock<HashMap<String, ServiceConfig>>>,
    active_config: Arc<RwLock<Option<String>>>,
}

impl ConfigManager {
    pub fn new(service_name: &str) -> Result<Self, ProxyError> {
        let config_dir = Self::get_config_dir()?;
        let config_file = config_dir.join(format!("{}.toml", service_name));

        let manager = Self {
            service_name: service_name.to_string(),
            config_file,
            configs: Arc::new(RwLock::new(HashMap::new())),
            active_config: Arc::new(RwLock::new(None)),
        };

        manager.ensure_config_file()?;
        manager.load_configs()?;

        Ok(manager)
    }

    fn get_config_dir() -> Result<PathBuf, ProxyError> {
        let home = dirs::home_dir()
            .ok_or_else(|| ProxyError::ConfigurationError("Cannot find home directory".to_string()))?;
        
        let config_dir = home.join(".paf");
        fs::create_dir_all(&config_dir).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to create config directory: {}", e))
        })?;

        Ok(config_dir)
    }

    fn ensure_config_file(&self) -> Result<bool, ProxyError> {
        if !self.config_file.exists() {
            // Create empty TOML file
            fs::write(&self.config_file, "")
                .map_err(|e| {
                    ProxyError::ConfigurationError(format!("Failed to create config file: {}", e))
                })?;
            info!("Created new config file: {:?}", self.config_file);
            return Ok(true);
        }
        Ok(false)
    }

    pub fn load_configs(&self) -> Result<(), ProxyError> {
        let content = fs::read_to_string(&self.config_file).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to read config file: {}", e))
        })?;

        // Try parsing as TOML first, fallback to JSON for backwards compatibility
        let data: Value = if let Ok(toml_data) = toml::from_str(&content) {
            toml_data
        } else if let Ok(json_data) = serde_json::from_str::<serde_json::Value>(&content) {
            // Convert JSON to TOML Value for backwards compatibility
            toml::Value::try_from(json_data).map_err(|e| {
                ProxyError::ConfigurationError(format!("Failed to convert JSON to TOML: {}", e))
            })?
        } else {
            return Err(ProxyError::ConfigurationError("Failed to parse config file as TOML or JSON".to_string()));
        };

        let mut configs = HashMap::new();
        let mut active_config = None;

        if let Value::Table(map) = data {
            for (name, value) in map {
                if let Value::Table(config_obj) = value {
                    if let (Some(base_url), Some(auth_token)) = (
                        config_obj.get("base_url").and_then(|v| v.as_str()),
                        config_obj.get("auth_token").and_then(|v| v.as_str()),
                    ) {
                        let api_key = config_obj
                            .get("api_key")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        let is_active = config_obj
                            .get("active")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);

                        let weight = config_obj
                            .get("weight")
                            .and_then(|v| v.as_float())
                            .unwrap_or(0.0);

                        let config = ServiceConfig {
                            name: name.clone(),
                            base_url: base_url.to_string(),
                            api_key,
                            auth_token: Some(auth_token.to_string()),
                            active: is_active,
                            weight,
                        };

                        if is_active {
                            active_config = Some(name.clone());
                        }

                        configs.insert(name, config);
                    }
                }
            }
        }

        if active_config.is_none() && !configs.is_empty() {
            let first_key = configs.keys().next().unwrap().clone();
            active_config = Some(first_key);
        }

        *self.configs.write().unwrap() = configs;
        *self.active_config.write().unwrap() = active_config;

        debug!("Loaded {} configurations", self.configs.read().unwrap().len());

        Ok(())
    }

    pub fn get_configs(&self) -> HashMap<String, ServiceConfig> {
        self.configs.read().unwrap().clone()
    }

    pub fn get_active_config_name(&self) -> Option<String> {
        self.active_config.read().unwrap().clone()
    }

    pub fn get_active_config(&self) -> Option<ServiceConfig> {
        let active_name = self.active_config.read().unwrap().clone()?;
        self.configs.read().unwrap().get(&active_name).cloned()
    }

    pub fn set_active_config(&self, config_name: &str) -> Result<(), ProxyError> {
        let configs = self.configs.read().unwrap();
        if !configs.contains_key(config_name) {
            return Err(ProxyError::ConfigurationError(format!(
                "Configuration '{}' not found",
                config_name
            )));
        }
        drop(configs);

        *self.active_config.write().unwrap() = Some(config_name.to_string());
        self.save_configs()?;

        info!("Activated configuration: {}", config_name);
        Ok(())
    }

    pub fn add_config(&self, config: ServiceConfig) -> Result<(), ProxyError> {
        let mut configs = self.configs.write().unwrap();
        configs.insert(config.name.clone(), config);
        drop(configs);

        self.save_configs()?;
        Ok(())
    }

    pub fn remove_config(&self, config_name: &str) -> Result<(), ProxyError> {
        {
            let mut configs = self.configs.write().unwrap();
            configs.remove(config_name);
        }

        let active = self.active_config.read().unwrap().clone();
        if active.as_deref() == Some(config_name) {
            let configs = self.configs.read().unwrap();
            let new_active = configs.keys().next().cloned();
            drop(configs);
            *self.active_config.write().unwrap() = new_active;
        }

        self.save_configs()?;
        Ok(())
    }

    fn save_configs(&self) -> Result<(), ProxyError> {
        let configs = self.configs.read().unwrap();
        let active_name = self.active_config.read().unwrap();

        let mut data = toml::map::Map::new();

        for (name, config) in configs.iter() {
            let mut config_obj = toml::map::Map::new();
            config_obj.insert("base_url".to_string(), toml::Value::String(config.base_url.clone()));
            config_obj.insert(
                "auth_token".to_string(),
                toml::Value::String(config.auth_token.clone().unwrap_or_default()),
            );

            if let Some(ref api_key) = config.api_key {
                config_obj.insert("api_key".to_string(), toml::Value::String(api_key.clone()));
            }

            config_obj.insert("weight".to_string(), toml::Value::Float(config.weight));

            let is_active = active_name.as_ref().map(|a| a == name).unwrap_or(false);
            config_obj.insert("active".to_string(), toml::Value::Boolean(is_active));

            data.insert(name.clone(), toml::Value::Table(config_obj));
        }

        let toml_str = toml::to_string_pretty(&data).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to serialize config: {}", e))
        })?;

        fs::write(&self.config_file, toml_str).map_err(|e| {
            ProxyError::ConfigurationError(format!("Failed to write config file: {}", e))
        })?;

        Ok(())
    }

    pub fn reload(&self) -> Result<(), ProxyError> {
        self.load_configs()
    }
}

// Add dirs crate to dependencies
