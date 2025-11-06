// Load balancer - selects upstream servers based on configured strategy

import type { ProxyConfig, LoadBalancerConfig } from '../config/types';

interface ServerHealth {
  isHealthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastChecked: number;
}

export class LoadBalancer {
  private healthStatus: Map<string, ServerHealth> = new Map();
  private roundRobinIndex = 0;
  private config: LoadBalancerConfig;
  private currentServerName: string | null = null;
  private weightRotation: Map<string, number> = new Map();

  constructor(config: LoadBalancerConfig) {
    this.config = config;
  }

  /**
   * Select an upstream server based on the configured strategy
   */
  selectServer(servers: ProxyConfig[]): ProxyConfig | null {
    if (servers.length === 0) {
      return null;
    }

    const now = Date.now();
    const enabledServers = servers.filter(server => server.enabled !== false);
    const basePool = enabledServers.length > 0 ? enabledServers : servers;

    const availableServers = basePool.filter(server => !this.isServerFrozen(server, now));
    const selectableServers = availableServers.length > 0 ? availableServers : basePool;

    if (this.config.strategy !== 'weighted') {
      const server = this.selectRoundRobin(selectableServers);
      this.currentServerName = server?.name ?? null;
      return server;
    }

    if (this.currentServerName && !servers.some(s => s.name === this.currentServerName)) {
      this.currentServerName = null;
    }

    if (this.currentServerName) {
      const current = selectableServers.find(s => s.name === this.currentServerName);
      if (current && !this.hasExceededFailureThreshold(current.name)) {
        return current;
      }
      this.currentServerName = null;
    }

    const next = this.selectByDescendingWeight(selectableServers);
    if (next) {
      this.currentServerName = next.name;
      return next;
    }

    const fallback = this.selectFallback(selectableServers);
    if (fallback && !this.hasExceededFailureThreshold(fallback.name)) {
      this.currentServerName = fallback.name;
    } else {
      this.currentServerName = null;
    }
    return fallback;
  }

  /**
   * Weighted random selection based on server weights
   */
  private selectWeighted(servers: ProxyConfig[]): ProxyConfig {
    const totalWeight = servers.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight <= 0) {
      return servers[0];
    }
    let random = Math.random() * totalWeight;

    for (const server of servers) {
      random -= server.weight;
      if (random <= 0) {
        return server;
      }
    }

    return servers[0];
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(servers: ProxyConfig[]): ProxyConfig {
    const server = servers[this.roundRobinIndex % servers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % servers.length;
    return server;
  }

  /**
   * Expose the most recently selected server for observability
   */
  getCurrentServerName(): string | null {
    return this.currentServerName;
  }

  /**
   * Mark a server as healthy after successful request
   */
  markSuccess(serverName: string): void {
    const health = this.getOrCreateHealth(serverName);
    health.consecutiveFailures = 0;
    health.consecutiveSuccesses++;

    if (health.consecutiveSuccesses >= this.config.healthCheck.successThreshold) {
      health.isHealthy = true;
    }

    health.lastChecked = Date.now();
    this.currentServerName = serverName;
  }

  /**
   * Mark a server as unhealthy after failed request
   */
  markFailure(serverName: string): void {
    const health = this.getOrCreateHealth(serverName);
    health.consecutiveSuccesses = 0;
    health.consecutiveFailures++;

    if (health.consecutiveFailures >= this.config.healthCheck.failureThreshold) {
      health.isHealthy = false;
      if (this.currentServerName === serverName) {
        this.currentServerName = null;
      }
    }

    health.lastChecked = Date.now();
  }

  /**
   * Determine whether a server has exceeded the configured failure threshold
   */
  hasExceededFailureThreshold(serverName: string): boolean {
    const health = this.getOrCreateHealth(serverName);
    return health.consecutiveFailures >= this.config.healthCheck.failureThreshold;
  }

  /**
   * Check if a server is considered healthy
   */
  isServerHealthy(serverName: string): boolean {
    const health = this.healthStatus.get(serverName);
    return health?.isHealthy !== false; // Default to healthy if not tracked
  }

  /**
   * Get health status for a server
   */
  getServerHealth(serverName: string): ServerHealth {
    return this.getOrCreateHealth(serverName);
  }

  /**
   * Get or create health status entry for a server
   */
  private getOrCreateHealth(serverName: string): ServerHealth {
    let health = this.healthStatus.get(serverName);

    if (!health) {
      health = {
        isHealthy: true,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastChecked: Date.now(),
      };
      this.healthStatus.set(serverName, health);
    }

    return health;
  }

  /**
   * Perform active health check on a server
   */
  async performHealthCheck(server: ProxyConfig): Promise<boolean> {
    if (!this.config.healthCheck.enabled) {
      return true;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.healthCheck.timeout
      );

      const response = await fetch(server.baseUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: this.buildAuthHeaders(server),
      });

      clearTimeout(timeout);

      if (response.ok) {
        this.markSuccess(server.name);
        return true;
      } else {
        this.markFailure(server.name);
        return false;
      }
    } catch (error) {
      this.markFailure(server.name);
      return false;
    }
  }

  /**
   * Start periodic health checks for all servers
   */
  startHealthChecks(servers: ProxyConfig[]): () => void {
    if (!this.config.healthCheck.enabled) {
      return () => {};
    }

    const interval = setInterval(() => {
      servers.forEach(server => {
        if (server.enabled) {
          this.performHealthCheck(server);
        }
      });
    }, this.config.healthCheck.interval);

    // Return cleanup function
    return () => clearInterval(interval);
  }

  /**
   * Build authentication headers for health check
   */
  private buildAuthHeaders(server: ProxyConfig): HeadersInit {
    const headers: HeadersInit = {};

    if (server.authToken) {
      headers['Authorization'] = `Bearer ${server.authToken}`;
    } else if (server.apiKey) {
      headers['x-api-key'] = server.apiKey;
    }

    return headers;
  }

  /**
   * Get all server health statuses
   */
  getAllHealthStatuses(): Map<string, ServerHealth> {
    return new Map(this.healthStatus);
  }

  /**
   * Reset health status for a server
   */
  resetServerHealth(serverName: string): void {
    this.healthStatus.delete(serverName);
    if (this.currentServerName === serverName) {
      this.currentServerName = null;
    }
  }

  /**
   * Update load balancer configuration
   */
  updateConfig(config: LoadBalancerConfig): void {
    this.config = config;
    this.weightRotation.clear();
    if (this.currentServerName && this.hasExceededFailureThreshold(this.currentServerName)) {
      this.currentServerName = null;
    }
  }

  private isServerFrozen(server: ProxyConfig, now: number): boolean {
    return typeof server.freezeUntil === 'number' && server.freezeUntil > now;
  }

  private selectFallback(servers: ProxyConfig[]): ProxyConfig | null {
    if (servers.length === 0) {
      return null;
    }

    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(servers);
      case 'weighted':
      default:
        return this.selectWeighted(servers);
    }
  }

  private selectByDescendingWeight(servers: ProxyConfig[]): ProxyConfig | null {
    if (servers.length === 0) {
      return null;
    }

    const groups = this.groupServersByWeight(servers);
    for (const group of groups) {
      const candidate = this.selectFromWeightGroup(group.weight, group.servers);
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  private groupServersByWeight(servers: ProxyConfig[]): Array<{ weight: number; servers: ProxyConfig[] }> {
    const grouped = new Map<number, ProxyConfig[]>();

    for (const server of servers) {
      const list = grouped.get(server.weight);
      if (list) {
        list.push(server);
      } else {
        grouped.set(server.weight, [server]);
      }
    }

    return Array.from(grouped.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([weight, list]) => ({
        weight,
        servers: list,
      }));
  }

  private selectFromWeightGroup(weight: number, servers: ProxyConfig[]): ProxyConfig | null {
    const eligible = servers
      .filter(server => !this.hasExceededFailureThreshold(server.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (eligible.length === 0) {
      return null;
    }

    const key = this.weightKey(weight);
    let pointer = this.weightRotation.get(key) ?? 0;
    if (pointer >= eligible.length) {
      pointer = 0;
    }

    const server = eligible[pointer];
    this.weightRotation.set(key, (pointer + 1) % eligible.length);
    return server;
  }

  private weightKey(weight: number): string {
    return Number.isInteger(weight) ? weight.toString() : weight.toString();
  }
}
