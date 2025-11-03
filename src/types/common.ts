export type ServiceId = 'claude' | 'codex';

export enum ConfigStatus {
  Ok = 'ok',
  Frozen = 'frozen',
  Disabled = 'disabled',
  Unknown = 'unknown',
}

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
  completed_at?: number;
  source?: 'cli' | 'proxy';
  method?: string;
  path?: string;
}

export interface RequestResultPayload extends TestConnectionResponse {}

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
    last_results?: Record<string, RequestResultPayload>;
  };
  codex: {
    configs: Record<string, CodexConfig> | CodexConfig[];
    active: string | null;
    mode: 'manual' | 'load_balance';
    current?: string | null;
    last_results?: Record<string, RequestResultPayload>;
  };
}

export interface ConfigListResponse<TConfig = ServiceConfig> {
  configs: Record<string, TConfig> | TConfig[];
  active: string | null;
  mode?: 'manual' | 'load_balance';
  last_results?: Record<string, RequestResultPayload>;
}

export interface StatusResponse {
  status: string;
  timestamp: string;
}
