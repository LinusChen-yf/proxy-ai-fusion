// Configuration type definitions

export interface ProxyConfig {
  name: string;
  baseUrl: string;
  authToken?: string;
  apiKey?: string;
  weight: number;
  enabled: boolean;
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
