use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub name: String,
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub weight: f64,
}

impl ServiceConfig {
    pub fn new(
        name: String,
        base_url: String,
        api_key: Option<String>,
        auth_token: Option<String>,
    ) -> Self {
        Self {
            name,
            base_url,
            api_key,
            auth_token,
            active: false,
            weight: 0.0,
        }
    }

    pub fn with_weight(mut self, weight: f64) -> Self {
        self.weight = weight;
        self
    }

    pub fn set_active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }
}
