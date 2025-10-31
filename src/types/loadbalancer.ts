export type LoadBalancerMode = 'weight_selection' | 'round_robin';

export interface LoadBalancerConfig {
  mode: LoadBalancerMode;
  health_check_interval_secs: number;
  failure_threshold: number;
  success_threshold: number;
  freeze_duration_secs: number; // Freeze duration in seconds, default 300 (5 minutes)
}
