import type {
  ServiceConfig,
  ConfigListResponse,
  StatusResponse,
  ClaudeConfig,
  CodexConfig,
  SeparatedConfigResponse,
  TestConnectionResponse,
  ClaudeSetupResponse,
  ServiceId,
} from '@/types/common';
import type { LoadBalancerConfig } from '@/types/loadbalancer';
import { DEFAULT_LOAD_BALANCER_CONFIG } from '@/types/loadbalancer';
import type { RequestLog } from '@/types/logs';

const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export const api = {
  // Status
  async getStatus(): Promise<StatusResponse> {
    return fetchJSON<StatusResponse>(`${API_BASE}/status`);
  },

  // Docs
  async setupLocalClaudeCode(): Promise<ClaudeSetupResponse> {
    return fetchJSON<ClaudeSetupResponse>(`${API_BASE}/docs/claude/setup`, {
      method: 'POST',
    });
  },

  // Configs (legacy unified endpoint kept for backward compatibility)
  async listConfigs(): Promise<ConfigListResponse> {
    return fetchJSON<ConfigListResponse>(`${API_BASE}/configs`);
  },

  async createConfig(config: Omit<ServiceConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async updateConfig(name: string, config: Partial<ServiceConfig>): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async deleteConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },

  async activateConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}/activate`, {
      method: 'POST',
    });
  },

  // Claude configuration management
  async listClaudeConfigs(): Promise<ConfigListResponse<ClaudeConfig>> {
    return fetchJSON<ConfigListResponse<ClaudeConfig>>(`${API_BASE}/configs?service=claude`);
  },

  async createClaudeConfig(config: Omit<ClaudeConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs?service=claude`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async updateClaudeConfig(name: string, config: Partial<ClaudeConfig>): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}?service=claude`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async deleteClaudeConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}?service=claude`, {
      method: 'DELETE',
    });
  },

  async activateClaudeConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}/activate?service=claude`, {
      method: 'POST',
    });
  },

  async testClaudeApi(name: string): Promise<TestConnectionResponse> {
    return fetchJSON<TestConnectionResponse>(
      `${API_BASE}/configs/${encodeURIComponent(name)}/test?service=claude`,
      { method: 'POST' }
    );
  },

  // Codex configuration management
  async listCodexConfigs(): Promise<ConfigListResponse<CodexConfig>> {
    return fetchJSON<ConfigListResponse<CodexConfig>>(`${API_BASE}/configs?service=codex`);
  },

  async createCodexConfig(config: Omit<CodexConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs?service=codex`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async updateCodexConfig(name: string, config: Partial<CodexConfig>): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}?service=codex`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async deleteCodexConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}?service=codex`, {
      method: 'DELETE',
    });
  },

  async activateCodexConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/${encodeURIComponent(name)}/activate?service=codex`, {
      method: 'POST',
    });
  },

  async testCodexApi(name: string): Promise<TestConnectionResponse> {
    return fetchJSON<TestConnectionResponse>(
      `${API_BASE}/configs/${encodeURIComponent(name)}/test?service=codex`,
      { method: 'POST' }
    );
  },

  // Fetch all separated configurations
  async listSeparatedConfigs(): Promise<SeparatedConfigResponse> {
    return fetchJSON<SeparatedConfigResponse>(`${API_BASE}/configs/separated`);
  },

  // Update service mode
  async updateServiceMode(service: 'claude' | 'codex', mode: 'manual' | 'load_balance'): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/mode?service=${service}`, {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    });
  },

  // Load Balancer
  async getLoadBalancerConfig(service: ServiceId = 'claude'): Promise<LoadBalancerConfig> {
    const response = await fetchJSON<{ loadBalancer: LoadBalancerConfig | null }>(
      `${API_BASE}/loadbalancer?service=${service}`
    );

    return response.loadBalancer ?? DEFAULT_LOAD_BALANCER_CONFIG;
  },

  async updateLoadBalancerConfig(config: LoadBalancerConfig, service: ServiceId = 'claude'): Promise<void> {
    await fetchJSON(`${API_BASE}/loadbalancer?service=${service}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  // Logs
  async getLogs(limit = 50, offset = 0): Promise<RequestLog[]> {
    const response = await fetchJSON<{ logs: RequestLog[] }>(`${API_BASE}/logs?limit=${limit}&offset=${offset}`);
    return response.logs;
  },

  async getLogById(id: string): Promise<RequestLog> {
    const response = await fetchJSON<{ log: RequestLog }>(`${API_BASE}/logs/${encodeURIComponent(id)}`);
    return response.log;
  },

  async clearLogs(): Promise<{ success: boolean; deletedCount: number }> {
    return fetchJSON(`${API_BASE}/logs`, {
      method: 'DELETE',
    });
  },
};
