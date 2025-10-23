export type ServiceId = 'claude' | 'codex';

export interface ServiceConfig {
  name: string;
  base_url: string;
  api_key?: string;
  auth_token?: string;
  weight: number;
}

export interface TestConnectionResponse {
  success: boolean;
  status_code?: number;
  message?: string;
  duration_ms?: number;
  response_preview?: string;
}

// Claude 专用配置
export interface ClaudeConfig {
  name: string;
  base_url: string;        // Claude API URL，如 https://api.anthropic.com
  api_key?: string;        // Anthropic API 密钥
  auth_token?: string;     // Bearer 令牌认证
  weight: number;          // 负载均衡权重
}

// Codex 专用配置
export interface CodexConfig {
  name: string;
  base_url: string;        // OpenAI API URL，如 https://api.openai.com
  api_key?: string;        // OpenAI API 密钥
  auth_token?: string;     // Bearer 令牌认证
  weight: number;          // 负载均衡权重
}

// 分离的配置响应结构
export interface SeparatedConfigResponse {
  claude: {
    configs: Record<string, ClaudeConfig> | ClaudeConfig[];
    active: string | null;
  };
  codex: {
    configs: Record<string, CodexConfig> | CodexConfig[];
    active: string | null;
  };
}

export interface ConfigListResponse {
  configs: Record<string, ServiceConfig> | ServiceConfig[];
  active: string | null;
}

export interface StatusResponse {
  status: string;
  timestamp: string;
}
