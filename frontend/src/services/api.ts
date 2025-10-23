import type {
  ServiceConfig,
  ConfigListResponse,
  StatusResponse,
  ClaudeConfig,
  CodexConfig,
  SeparatedConfigResponse,
  TestConnectionResponse,
} from '@/types/common';
import type { LoadBalancerConfig } from '@/types/loadbalancer';
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

  // Configs (原有的统一配置接口，保持向后兼容)
  async listConfigs(): Promise<ConfigListResponse> {
    return fetchJSON<ConfigListResponse>(`${API_BASE}/configs`);
  },

  async createConfig(config: Omit<ServiceConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async updateConfig(name: string, config: Omit<ServiceConfig, 'weight'> & { weight?: number }): Promise<void> {
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

  // Claude 配置管理
  async listClaudeConfigs(): Promise<{ configs: Record<string, ClaudeConfig> | ClaudeConfig[]; active: string | null }> {
    return fetchJSON(`${API_BASE}/configs/claude`);
  },

  async createClaudeConfig(config: Omit<ClaudeConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/claude`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async updateClaudeConfig(name: string, config: Omit<ClaudeConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/claude/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async deleteClaudeConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/claude/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },

  async activateClaudeConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/claude/${encodeURIComponent(name)}/activate`, {
      method: 'POST',
    });
  },

  async testClaudeApi(name: string): Promise<TestConnectionResponse> {
    return fetchJSON<TestConnectionResponse>(
      `${API_BASE}/configs/claude/${encodeURIComponent(name)}/test/api`,
      { method: 'POST' },
    );
  },

  // Codex 配置管理
  async listCodexConfigs(): Promise<{ configs: Record<string, CodexConfig> | CodexConfig[]; active: string | null }> {
    return fetchJSON(`${API_BASE}/configs/codex`);
  },

  async createCodexConfig(config: Omit<CodexConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/codex`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async updateCodexConfig(name: string, config: Omit<CodexConfig, 'weight'> & { weight?: number }): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/codex/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async deleteCodexConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/codex/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },

  async activateCodexConfig(name: string): Promise<void> {
    await fetchJSON(`${API_BASE}/configs/codex/${encodeURIComponent(name)}/activate`, {
      method: 'POST',
    });
  },

  async testCodexApi(name: string): Promise<TestConnectionResponse> {
    return fetchJSON<TestConnectionResponse>(
      `${API_BASE}/configs/codex/${encodeURIComponent(name)}/test/api`,
      { method: 'POST' },
    );
  },

  // 获取所有分离的配置
  async listSeparatedConfigs(): Promise<SeparatedConfigResponse> {
    return fetchJSON<SeparatedConfigResponse>(`${API_BASE}/configs/separated`);
  },

  // Load Balancer
  async getLoadBalancerConfig(): Promise<LoadBalancerConfig> {
    return fetchJSON<LoadBalancerConfig>(`${API_BASE}/loadbalancer`);
  },

  async updateLoadBalancerConfig(config: LoadBalancerConfig): Promise<void> {
    await fetchJSON(`${API_BASE}/loadbalancer`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  // Logs
  async getLogs(limit = 50, offset = 0): Promise<RequestLog[]> {
    return fetchJSON<RequestLog[]>(`${API_BASE}/logs?limit=${limit}&offset=${offset}`);
  },

  async getLogById(id: string): Promise<RequestLog> {
    return fetchJSON<RequestLog>(`${API_BASE}/logs/${encodeURIComponent(id)}`);
  },
};
