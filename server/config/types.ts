// Configuration type definitions

export interface ProxyConfig {
  name: string;
  baseUrl: string;
  authToken?: string;
  apiKey?: string;
  weight: number;
  enabled: boolean;
  freezeUntil?: number; // Unix timestamp in milliseconds
}

export interface LoadBalancerConfig {
  strategy: 'weighted' | 'round-robin';
  healthCheck: {
    enabled: boolean;
    interval: number; // milliseconds
    timeout: number;
    failureThreshold: number;
    successThreshold: number;
  };
  freezeDuration: number; // milliseconds, default 5 minutes (300000)
}

export interface ServiceConfig {
  configs: ProxyConfig[];
  active: string;
  mode: 'manual' | 'load_balance';
  loadBalancer: LoadBalancerConfig;
}

export interface SystemConfig {
  webPort: number;
  proxyPorts: {
    claude: number;
    codex: number;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  dataDir: string;
}
