import type { BaseProxyOptions } from './baseProxyService';
import { BaseProxyService } from './baseProxyService';

export class ClaudeProxyService extends BaseProxyService {
  constructor(options: Omit<BaseProxyOptions, 'serviceName'>) {
    super({ ...options, serviceName: 'claude' });
  }

  protected override adjustForwardHeaders(headers: Record<string, string>): void {
    // Anthropic expects the API key in x-api-key; fall back to Authorization header if present
    if (!headers['x-api-key']) {
      const authHeader = headers['authorization'];
      const bearerPrefix = 'bearer ';
      if (authHeader?.toLowerCase().startsWith(bearerPrefix)) {
        headers['x-api-key'] = authHeader.slice(bearerPrefix.length).trim();
      }
    }

    if (!headers['anthropic-version']) {
      headers['anthropic-version'] = '2023-06-01';
    }
  }
}
