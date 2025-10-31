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

  constructor(config: LoadBalancerConfig) {
    this.config = config;
  }

  /**
   * Select an upstream server based on the configured strategy
   */
  selectServer(servers: ProxyConfig[]): ProxyConfig | null {
    const healthyServers = servers.filter(s => this.isServerHealthy(s.name));
    const now = Date.now();

    // Filter out frozen servers
    const availableServers = healthyServers.filter(s => {
      if (!s.freezeUntil) return true;
      return now >= s.freezeUntil;
    });

    if (availableServers.length === 0) {
      // Fallback: try any server if all marked unhealthy or frozen
      const fallbackServers = healthyServers.filter(s => !s.freezeUntil || now >= s.freezeUntil);
      if (fallbackServers.length === 0) {
        return healthyServers[0] || null;
      }
      // Choose based on strategy from available servers
      switch (this.config.strategy) {
        case 'weighted':
          return this.selectWeighted(fallbackServers);
        case 'round-robin':
          return this.selectRoundRobin(fallbackServers);
        default:
          return fallbackServers[0];
      }
    }

    switch (this.config.strategy) {
      case 'weighted':
        return this.selectWeighted(availableServers);
      case 'round-robin':
        return this.selectRoundRobin(availableServers);
      default:
        return availableServers[0];
    }
  }

  /**
   * Weighted random selection based on server weights
   */
  private selectWeighted(servers: ProxyConfig[]): ProxyConfig {
    const totalWeight = servers.reduce((sum, s) => sum + s.weight, 0);
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
    }

    health.lastChecked = Date.now();
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
  }

  /**
   * Update load balancer configuration
   */
  updateConfig(config: LoadBalancerConfig): void {
    this.config = config;
  }
}
