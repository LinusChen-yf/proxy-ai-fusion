export interface LoadBalancerConfig {
  strategy: 'weighted' | 'round-robin';
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
    failureThreshold: number;
    successThreshold: number;
  };
  freezeDuration: number;
}

export const DEFAULT_LOAD_BALANCER_CONFIG: LoadBalancerConfig = {
  strategy: 'weighted',
  healthCheck: {
    enabled: true,
    interval: 30_000,
    timeout: 5_000,
    failureThreshold: 3,
    successThreshold: 2,
  },
  freezeDuration: 300_000,
};
