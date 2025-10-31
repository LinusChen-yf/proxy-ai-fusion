export type ServiceId = 'claude' | 'codex';

export interface ServiceConfig {
  name: string;
  base_url: string;
  api_key?: string;
  auth_token?: string;
  weight: number;
  enabled?: boolean;
  freeze_until?: number;
}

export interface TestConnectionResponse {
  success: boolean;
  status_code?: number;
  message?: string;
  duration_ms?: number;
  response_preview?: string;
}

// Claude-specific configuration
export interface ClaudeConfig {
  name: string;
  base_url: string;        // Claude API URL, e.g., https://api.anthropic.com
  api_key?: string;        // Anthropic API key
  auth_token?: string;     // Bearer token credentials
  weight: number;          // Load-balancing weight
  enabled?: boolean;
  freeze_until?: number;
}

// Codex-specific configuration
export interface CodexConfig {
  name: string;
  base_url: string;        // OpenAI API URL, e.g., https://api.openai.com
  api_key?: string;        // OpenAI API key
  auth_token?: string;     // Bearer token credentials
  weight: number;          // Load-balancing weight
  enabled?: boolean;
  freeze_until?: number;
}

// Response structure for separated configs
export interface SeparatedConfigResponse {
  claude: {
    configs: Record<string, ClaudeConfig> | ClaudeConfig[];
    active: string | null;
    mode: 'manual' | 'load_balance';
    current?: string | null;
  };
  codex: {
    configs: Record<string, CodexConfig> | CodexConfig[];
    active: string | null;
    mode: 'manual' | 'load_balance';
    current?: string | null;
  };
}

export interface ConfigListResponse {
  configs: Record<string, ServiceConfig> | ServiceConfig[];
  active: string | null;
  mode?: 'manual' | 'load_balance';
}

export interface StatusResponse {
  status: string;
  timestamp: string;
}
