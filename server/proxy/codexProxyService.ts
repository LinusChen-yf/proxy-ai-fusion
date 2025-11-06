import type { BaseProxyOptions } from './baseProxyService';
import { BaseProxyService } from './baseProxyService';

export class CodexProxyService extends BaseProxyService {
  constructor(options: Omit<BaseProxyOptions, 'serviceName'>) {
    super({ ...options, serviceName: 'codex' });
  }
}
