export interface UsageMetrics {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
}

export interface RequestLog {
  id: string;
  timestamp: string;
  service: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  error_message?: string;
  channel?: string;
  target_url?: string;
  error_stack?: string;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  request_body?: string;
  response_body?: string;
  usage?: UsageMetrics;
}
