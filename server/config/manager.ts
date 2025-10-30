// Configuration manager - handles loading and managing configs from TOML files

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as TOML from '@iarna/toml';
import type { ProxyConfig, ServiceConfig, SystemConfig, LoadBalancerConfig } from './types';

export class ConfigManager {
  private configDir: string;
  private systemConfig!: SystemConfig;
  private services: Map<string, ServiceConfig> = new Map();

  constructor(configDir?: string) {
    // Default to ~/.paf/ directory
    this.configDir = configDir || join(process.env.HOME || '~', '.paf');

    // Ensure config directory exists
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    this.systemConfig = await this.loadSystemConfig();
  }

  private async loadSystemConfig(): Promise<SystemConfig> {
    const systemConfigPath = join(this.configDir, 'system.toml');

    if (!existsSync(systemConfigPath)) {
      // Create default system config
      const defaultConfig: SystemConfig = {
        webPort: 8800,
        proxyPorts: {
          claude: 8801,
          codex: 8802,
        },
        logLevel: 'info',
        dataDir: this.configDir,
      };

      // Write default config
      const tomlContent = `
# System Configuration
web_port = ${defaultConfig.webPort}
log_level = "${defaultConfig.logLevel}"
data_dir = "${defaultConfig.dataDir}"

[proxy_ports]
claude = ${defaultConfig.proxyPorts.claude}
codex = ${defaultConfig.proxyPorts.codex}
`;
      await Bun.write(systemConfigPath, tomlContent);
      return defaultConfig;
    }

    const content = await Bun.file(systemConfigPath).text();
    return this.parseSystemConfig(TOML.parse(content));
  }

  private parseSystemConfig(data: any): SystemConfig {
    return {
      webPort: data.web_port || 8800,
      proxyPorts: {
        claude: data.proxy_ports?.claude || 8801,
        codex: data.proxy_ports?.codex || 8802,
      },
      logLevel: data.log_level || 'info',
      dataDir: data.data_dir || this.configDir,
    };
  }

  async loadServiceConfig(serviceName: string): Promise<ServiceConfig> {
    const configPath = join(this.configDir, `${serviceName}.toml`);

    if (!existsSync(configPath)) {
      throw new Error(`Service config not found: ${serviceName}`);
    }

    const content = await Bun.file(configPath).text();
    const data = TOML.parse(content) as any;

    const configs: ProxyConfig[] = (Array.isArray(data.configs) ? data.configs : []).map((c: any) => ({
      name: c.name,
      baseUrl: c.base_url,
      authToken: c.auth_token,
      apiKey: c.api_key,
      weight: c.weight || 1.0,
      enabled: c.enabled !== false,
    }));

    const loadBalancer: LoadBalancerConfig = {
      strategy: (data.loadbalancer as any)?.strategy || 'weighted',
      healthCheck: {
        enabled: (data.loadbalancer as any)?.health_check?.enabled !== false,
        interval: (data.loadbalancer as any)?.health_check?.interval || 30000,
        timeout: (data.loadbalancer as any)?.health_check?.timeout || 5000,
        failureThreshold: (data.loadbalancer as any)?.health_check?.failure_threshold || 3,
        successThreshold: (data.loadbalancer as any)?.health_check?.success_threshold || 2,
      },
    };

    const serviceConfig: ServiceConfig = {
      configs,
      active: (data.active as any)?.name || configs[0]?.name || '',
      mode: (data.mode as 'manual' | 'load_balance') || 'manual',
      loadBalancer,
    };

    this.services.set(serviceName, serviceConfig);
    return serviceConfig;
  }

  async saveServiceConfig(serviceName: string, config: ServiceConfig): Promise<void> {
    const configPath = join(this.configDir, `${serviceName}.toml`);

    const normalizedConfigs = config.configs.map(c => ({
      ...c,
      enabled: c.enabled !== false,
      weight: c.weight ?? 1,
    }));

    let nextActive = config.active;
    const hasActiveConfig = normalizedConfigs.some(c => c.name === nextActive);
    if (!hasActiveConfig) {
      nextActive = normalizedConfigs[0]?.name || '';
    }

    const activeConfig = normalizedConfigs.find(c => c.name === nextActive);
    if (!activeConfig || !activeConfig.enabled) {
      const fallback = normalizedConfigs.find(c => c.enabled);
      nextActive = fallback ? fallback.name : '';
    }

    const sanitizedConfig: ServiceConfig = {
      ...config,
      configs: normalizedConfigs,
      active: nextActive,
    };

    // Convert to TOML format using standard library
    const tomlData: any = {
      mode: sanitizedConfig.mode,
      configs: sanitizedConfig.configs.map(c => ({
        name: c.name,
        base_url: c.baseUrl,
        auth_token: c.authToken || undefined,
        api_key: c.apiKey || undefined,
        weight: c.weight,
        enabled: c.enabled,
      })),
      active: {
        name: sanitizedConfig.active,
      },
      loadbalancer: {
        strategy: sanitizedConfig.loadBalancer.strategy,
        health_check: {
          enabled: sanitizedConfig.loadBalancer.healthCheck.enabled,
          interval: sanitizedConfig.loadBalancer.healthCheck.interval,
          timeout: sanitizedConfig.loadBalancer.healthCheck.timeout,
          failure_threshold: sanitizedConfig.loadBalancer.healthCheck.failureThreshold,
          success_threshold: sanitizedConfig.loadBalancer.healthCheck.successThreshold,
        },
      },
    };

    const tomlContent = TOML.stringify(tomlData);
    await Bun.write(configPath, tomlContent);

    // Update in-memory cache
    this.services.set(serviceName, sanitizedConfig);
  }

  getSystemConfig(): SystemConfig {
    return this.systemConfig;
  }

  getServiceConfig(serviceName: string): ServiceConfig | undefined {
    return this.services.get(serviceName);
  }

  getActiveConfig(serviceName: string): ProxyConfig | undefined {
    const service = this.services.get(serviceName);
    if (!service) return undefined;

    const active = service.configs.find(c => c.name === service.active);
    if (!active || !active.enabled) {
      return undefined;
    }

    return active;
  }

  getAllConfigs(serviceName: string): ProxyConfig[] {
    const service = this.services.get(serviceName);
    if (!service) return [];

    if (service.mode === 'manual') {
      const activeConfig = this.getActiveConfig(serviceName);
      return activeConfig ? [activeConfig] : [];
    }

    return service.configs.filter(c => c.enabled);
  }
}
