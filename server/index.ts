// Main server entry point - Bun fullstack application

import { serve } from 'bun';
import { ConfigManager } from './config/manager';
import { LoadBalancer } from './routing/loadbalancer';
import { RequestLogger, type LastRequestSnapshot } from './logging/logger';
import { ClaudeProxyService } from './proxy/claudeProxyService';
import { CodexProxyService } from './proxy/codexProxyService';
import type { ProxyService } from './proxy/baseProxyService';
import type { ProxyConfig, ServiceConfig } from './config/types';
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { existsSync, mkdirSync, mkdtempSync, rmSync, renameSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(moduleDir, '..');
const publicDir = join(rootDir, 'public');

// Initialize services
const configManager = new ConfigManager();
await configManager.initialize();

const systemConfig = configManager.getSystemConfig();
const logger = new RequestLogger(systemConfig.dataDir);

const autoRetestLocks: Record<'claude' | 'codex', Set<string>> = {
  claude: new Set(),
  codex: new Set(),
};

const AUTO_RETEST_INTERVAL_MS = 60 * 1000;

// Load service configurations
await configManager.loadServiceConfig('claude').catch(async () => {
  console.log('Claude config not found, creating default...');
  // Create default config if not exists
  await configManager.saveServiceConfig('claude', {
    configs: [],
    active: '',
    mode: 'manual',
    loadBalancer: {
      strategy: 'weighted',
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        failureThreshold: 3,
        successThreshold: 2,
      },
      freezeDuration: 5 * 60 * 1000, // 5 minutes
    },
  });
});

await configManager.loadServiceConfig('codex').catch(async () => {
  console.log('Codex config not found, creating default...');
  // Create default config if not exists
  await configManager.saveServiceConfig('codex', {
    configs: [],
    active: '',
    mode: 'manual',
    loadBalancer: {
      strategy: 'weighted',
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        failureThreshold: 3,
        successThreshold: 2,
      },
      freezeDuration: 5 * 60 * 1000, // 5 minutes
    },
  });
});

// Initialize load balancers
const claudeConfig = configManager.getServiceConfig('claude');
const claudeLoadBalancer = new LoadBalancer(
  claudeConfig?.loadBalancer || {
    strategy: 'weighted',
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 5000,
      failureThreshold: 3,
      successThreshold: 2,
    },
    freezeDuration: 5 * 60 * 1000,
  }
);

const codexConfig = configManager.getServiceConfig('codex');
const codexLoadBalancer = new LoadBalancer(
  codexConfig?.loadBalancer || {
    strategy: 'weighted',
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 5000,
      failureThreshold: 3,
      successThreshold: 2,
    },
    freezeDuration: 5 * 60 * 1000,
  }
);

// Initialize proxy services
const claudeProxy = new ClaudeProxyService({
  loadBalancer: claudeLoadBalancer,
  logger,
  configManager,
});

const codexProxy = new CodexProxyService({
  loadBalancer: codexLoadBalancer,
  logger,
  configManager,
});

setTimeout(() => {
  void autoRetestFrozenConfigs('claude');
  void autoRetestFrozenConfigs('codex');
}, 0);

setInterval(() => {
  void autoRetestFrozenConfigs('claude');
}, AUTO_RETEST_INTERVAL_MS);

setInterval(() => {
  void autoRetestFrozenConfigs('codex');
}, AUTO_RETEST_INTERVAL_MS);

const pkg = await Bun.file(join(rootDir, 'package.json')).json();
const version = typeof pkg?.version === 'string' ? pkg.version : 'unknown';

console.log(`Starting Proxy AI Fusion server (v${version})...`);
console.log(`Web UI: http://localhost:${systemConfig.webPort}`);
console.log(`Claude proxy: http://localhost:${systemConfig.proxyPorts.claude}`);
console.log(`Codex proxy: http://localhost:${systemConfig.proxyPorts.codex}`);
console.log('Proxy AI Fusion server ready.');

// Start Bun fullstack server for dashboard + API
serve({
  port: systemConfig.webPort,
  development: process.env.NODE_ENV !== 'production',

  // HTTP request handler
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // API Routes
    if (path.startsWith('/api/')) {
      return handleApiRequest(req, path);
    }

    // Claude Proxy (port from legacy API)
    if (path.startsWith('/v1/')) {
      const servers = configManager.getAllConfigs('claude');
      if (servers.length === 0) {
        return Response.json({ error: 'No claude configs available' }, { status: 503 });
      }
      return claudeProxy.handleRequest(req, servers);
    }

    // Codex Proxy
    if (path.startsWith('/codex/v1/')) {
      const servers = configManager.getAllConfigs('codex');
      if (servers.length === 0) {
        return Response.json({ error: 'No codex configs available' }, { status: 503 });
      }
      // Remove /codex prefix before forwarding
      const modifiedUrl = new URL(req.url);
      modifiedUrl.pathname = path.replace('/codex', '');
      const modifiedReq = new Request(modifiedUrl, req);
      return codexProxy.handleRequest(modifiedReq, servers);
    }

    // Serve frontend
    if (path === '/') {
      return new Response(Bun.file(join(publicDir, 'index.html')), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Serve static files from public directory
    const sanitizedPath = path.replace(/^\/+/, '');

    if (sanitizedPath.includes('..')) {
      return new Response('Not found', { status: 404 });
    }
    const publicPath = join(publicDir, sanitizedPath);
    const file = Bun.file(publicPath);

    if (await file.exists()) {
      return new Response(file);
    }

    // Try serving from root (for src/ during development)
    const rootPath = join(rootDir, sanitizedPath);
    const rootFile = Bun.file(rootPath);

    if (await rootFile.exists()) {
      return new Response(rootFile);
    }

    // Fallback to index.html for SPA routing
    return new Response(Bun.file(join(publicDir, 'index.html')), {
      headers: { 'Content-Type': 'text/html' },
    });
  },
});

// Start dedicated proxy servers to mirror legacy CLI behaviour
serve({
  port: systemConfig.proxyPorts.claude,
  development: process.env.NODE_ENV !== 'production',
  async fetch(req) {
    return handleDirectProxyRequest(req, 'claude', claudeProxy);
  },
});

serve({
  port: systemConfig.proxyPorts.codex,
  development: process.env.NODE_ENV !== 'production',
  async fetch(req) {
    return handleDirectProxyRequest(req, 'codex', codexProxy);
  },
});

/**
 * Convert RequestLog from backend format to frontend format
 */
function convertLogToFrontendFormat(log: any): any {
  return {
    id: log.id,
    timestamp: log.timestamp,
    service: log.service || 'claude', // Use actual service field or default to claude
    method: log.method,
    path: log.path,
    target_url: log.targetUrl,
    status_code: log.statusCode,
    duration_ms: log.duration,
    error_message: log.error,
    channel: log.configName,
    request_body: log.requestBody,
    response_body: log.responsePreview,
    request_headers: log.requestHeaders,
    response_headers: log.responseHeaders,
    // Build usage object if we have token data
    usage: (log.inputTokens || log.outputTokens || log.model || log.requestModel) ? {
      model: log.model || log.requestModel,
      prompt_tokens: log.inputTokens || 0,
      completion_tokens: log.outputTokens || 0,
      total_tokens: (log.inputTokens || 0) + (log.outputTokens || 0),
    } : undefined,
  };
}

function serializeLastResult(result: LastRequestSnapshot) {
  return {
    success: result.success,
    status_code: result.statusCode,
    message: result.message,
    duration_ms: result.durationMs,
    response_preview: result.responsePreview,
    completed_at: result.completedAt,
    source: result.source,
    method: result.method,
    path: result.path,
  };
}

function buildLastResults(serviceName: string) {
  const snapshots = logger.getLastResultsByService(serviceName);
  const payload: Record<string, ReturnType<typeof serializeLastResult>> = {};
  for (const [configName, snapshot] of Object.entries(snapshots)) {
    payload[configName] = serializeLastResult(snapshot);
  }
  return payload;
}

async function applyConfigFreeze(
  serviceName: 'claude' | 'codex',
  serviceConfig: ServiceConfig,
  configName: string,
  freezeUntil?: number
): Promise<ProxyConfig | undefined> {
  const index = serviceConfig.configs.findIndex(c => c.name === configName);
  if (index === -1) {
    return undefined;
  }

  const nextConfig = { ...serviceConfig.configs[index] };
  if (freezeUntil && Number.isFinite(freezeUntil)) {
    nextConfig.freezeUntil = freezeUntil;
  } else {
    delete nextConfig.freezeUntil;
  }

  serviceConfig.configs[index] = nextConfig;
  await configManager.saveServiceConfig(serviceName, serviceConfig);

  const refreshed = configManager.getServiceConfig(serviceName);
  if (!refreshed) {
    return undefined;
  }

  serviceConfig.configs = refreshed.configs;
  serviceConfig.active = refreshed.active;
  serviceConfig.mode = refreshed.mode;
  serviceConfig.loadBalancer = refreshed.loadBalancer;

  const updated = refreshed.configs.find(c => c.name === configName);
  return updated ? { ...updated } : undefined;
}

/**
 * Handle API requests
 */
async function handleApiRequest(req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Health check
    if (path === '/api/status') {
      return Response.json({
        status: 'ok',
        uptime: process.uptime(),
      }, { headers: corsHeaders });
    }

    if (path === '/api/docs/claude/setup' && req.method === 'POST') {
      const claudeDir = join(homedir(), '.claude');
      const settingsPath = join(claudeDir, 'settings.json');
      const backupPath = `${settingsPath}.backup`;
      const settingsContent = {
        env: {
          ANTHROPIC_AUTH_TOKEN: '-',
          ANTHROPIC_BASE_URL: 'http://localhost:8801',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000',
          MAX_THINKING_TOKENS: '30000',
          DISABLE_AUTOUPDATER: '1',
        },
        permissions: {
          allow: [],
          deny: [],
        },
        alwaysThinkingEnabled: true,
      };

      let backupCreated = false;

      try {
        mkdirSync(claudeDir, { recursive: true });

        if (existsSync(settingsPath)) {
          if (existsSync(backupPath)) {
            const timestampedBackup = `${backupPath}.${Date.now()}`;
            renameSync(backupPath, timestampedBackup);
          }
          renameSync(settingsPath, backupPath);
          backupCreated = true;
        }

        writeFileSync(settingsPath, `${JSON.stringify(settingsContent, null, 2)}\n`, 'utf8');

        return Response.json(
          {
            success: true,
            settingsPath,
            backupCreated,
            backupPath: backupCreated ? backupPath : null,
          },
          { headers: corsHeaders },
        );
      } catch (error) {
        console.error('Failed to setup Claude Code settings:', error);
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : String(error) },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    // Get all configs separated by service
    if (path === '/api/configs/separated' && req.method === 'GET') {
      const claudeConfig = configManager.getServiceConfig('claude');
      const codexConfig = configManager.getServiceConfig('codex');

      // For load_balance mode, simulate selecting a config to display as "current"
      const getCurrentConfig = (serviceName: 'claude' | 'codex', config: ServiceConfig | undefined) => {
        const loadBalancerInstance = serviceName === 'claude' ? claudeLoadBalancer : codexLoadBalancer;
        const currentFromBalancer = loadBalancerInstance.getCurrentServerName();
        const configs = config?.configs ?? [];

        if (currentFromBalancer && configs.some(c => c.name === currentFromBalancer)) {
          return currentFromBalancer;
        }

        if (!config) {
          return null;
        }

        if (config.mode !== 'load_balance') {
          return config.active || null;
        }

        const now = Date.now();
        const enabled = configs.filter(c => c.enabled !== false);
        if (enabled.length === 0) {
          return config.active || null;
        }

        const eligible = enabled.filter(c => !c.freezeUntil || now >= c.freezeUntil);
        const pool = eligible.length > 0 ? eligible : enabled;

        const sorted = pool
          .slice()
          .sort((a, b) => {
            if ((b.weight ?? 0) !== (a.weight ?? 0)) {
              return (b.weight ?? 0) - (a.weight ?? 0);
            }
            return a.name.localeCompare(b.name);
          });

        return sorted[0]?.name ?? null;
      };

      return Response.json({
        claude: {
          configs: claudeConfig?.configs || [],
          active: claudeConfig?.active,
          mode: claudeConfig?.mode || 'manual',
          current: getCurrentConfig('claude', claudeConfig),
          last_results: buildLastResults('claude'),
        },
        codex: {
          configs: codexConfig?.configs || [],
          active: codexConfig?.active,
          mode: codexConfig?.mode || 'manual',
          current: getCurrentConfig('codex', codexConfig),
          last_results: buildLastResults('codex'),
        },
      }, { headers: corsHeaders });
    }

    // Get all configs
    if (path === '/api/configs' && req.method === 'GET') {
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);
      const lastResults = buildLastResults(serviceName);

      return Response.json({
        configs: serviceConfig?.configs || [],
        active: serviceConfig?.active,
        mode: serviceConfig?.mode || 'manual',
        last_results: lastResults,
      }, { headers: corsHeaders });
    }

    // Create new config
    if (path === '/api/configs' && req.method === 'POST') {
      const body = await req.json();
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      // Convert snake_case to camelCase
      const config = {
        name: body.name,
        baseUrl: body.base_url || body.baseUrl,
        authToken: body.auth_token || body.authToken,
        apiKey: body.api_key || body.apiKey,
        weight: body.weight || 1,
        enabled: body.enabled !== false,
      };

      // Add new config
      serviceConfig.configs.push(config);
      await configManager.saveServiceConfig(serviceName, serviceConfig);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // Update service mode (must be before dynamic routes)
    if (path === '/api/configs/mode' && req.method === 'PUT') {
      const body = await req.json();
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      if (!body.mode || (body.mode !== 'manual' && body.mode !== 'load_balance')) {
        return Response.json({ error: 'Invalid mode. Must be "manual" or "load_balance"' }, { status: 400, headers: corsHeaders });
      }

      // Set mode
      serviceConfig.mode = body.mode;

      // If switching to load_balance mode, clear the active config
      // The load balancer will dynamically select servers based on weights
      if (body.mode === 'load_balance') {
        serviceConfig.active = '';
      }

      await configManager.saveServiceConfig(serviceName, serviceConfig);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // Update config
    if (path.match(/^\/api\/configs\/[^/]+$/) && req.method === 'PUT') {
      const configName = path.split('/').pop()!;
      const body = await req.json();
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      // Update config
      const index = serviceConfig.configs.findIndex(c => c.name === configName);
      if (index === -1) {
        return Response.json({ error: 'Config not found' }, { status: 404, headers: corsHeaders });
      }

      // Convert snake_case to camelCase
      const updates: any = {};
      if (body.base_url !== undefined) updates.baseUrl = body.base_url;
      if (body.baseUrl !== undefined) updates.baseUrl = body.baseUrl;
      if (body.auth_token !== undefined) updates.authToken = body.auth_token;
      if (body.authToken !== undefined) updates.authToken = body.authToken;
      if (body.api_key !== undefined) updates.apiKey = body.api_key;
      if (body.apiKey !== undefined) updates.apiKey = body.apiKey;
      if (body.weight !== undefined) updates.weight = body.weight;
      if (body.enabled !== undefined) updates.enabled = body.enabled;

      serviceConfig.configs[index] = { ...serviceConfig.configs[index], ...updates };
      await configManager.saveServiceConfig(serviceName, serviceConfig);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // Delete config
    if (path.match(/^\/api\/configs\/[^/]+$/) && req.method === 'DELETE') {
      const configName = path.split('/').pop()!;
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      // Remove config
      serviceConfig.configs = serviceConfig.configs.filter(c => c.name !== configName);
      await configManager.saveServiceConfig(serviceName, serviceConfig);
      logger.clearLastResult(serviceName, configName);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // Freeze/unfreeze config
    if (path.match(/^\/api\/configs\/[^/]+\/freeze$/) && req.method === 'PUT') {
      const configName = path.split('/')[3];
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      const body = await req.json();
      const freezeUntil = body.freezeUntil || null;

      // Update config
      const index = serviceConfig.configs.findIndex(c => c.name === configName);
      if (index === -1) {
        return Response.json({ error: 'Config not found' }, { status: 404, headers: corsHeaders });
      }

      serviceConfig.configs[index] = {
        ...serviceConfig.configs[index],
        freezeUntil,
      };
      await configManager.saveServiceConfig(serviceName, serviceConfig);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // Activate config
    if (path.match(/^\/api\/configs\/[^/]+\/activate$/) && req.method === 'POST') {
      const configName = path.split('/')[3];
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      const exists = serviceConfig.configs.some(c => c.name === configName);
      if (!exists) {
        return Response.json({ error: 'Config not found' }, { status: 404, headers: corsHeaders });
      }

      // Set active config
      serviceConfig.active = configName;
      await configManager.saveServiceConfig(serviceName, serviceConfig);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // Get load balancer config
    if (path === '/api/loadbalancer' && req.method === 'GET') {
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      return Response.json({
        loadBalancer: serviceConfig?.loadBalancer || null,
      }, { headers: corsHeaders });
    }

    // Update load balancer config
    if (path === '/api/loadbalancer' && req.method === 'PUT') {
      const body = await req.json();
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      serviceConfig.loadBalancer = body;
      await configManager.saveServiceConfig(serviceName, serviceConfig);

      // Update load balancer based on service
      if (serviceName === 'claude') {
        claudeLoadBalancer.updateConfig(body);
      } else if (serviceName === 'codex') {
        codexLoadBalancer.updateConfig(body);
      }

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // Get logs
    if (path === '/api/logs' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const logs = logger.getRecentLogs(limit, offset);

      // Convert logs to frontend format
      const convertedLogs = logs.map(convertLogToFrontendFormat);

      return Response.json({ logs: convertedLogs }, { headers: corsHeaders });
    }

    // Clear all logs
    if (path === '/api/logs' && req.method === 'DELETE') {
      const deletedCount = logger.clearAllLogs();
      return Response.json({ success: true, deletedCount }, { headers: corsHeaders });
    }

    // Get log by ID
    if (path.match(/^\/api\/logs\/[^/]+$/) && req.method === 'GET') {
      const logId = path.split('/').pop()!;
      const log = logger.getLogById(logId);

      if (!log) {
        return Response.json({ error: 'Log not found' }, { status: 404, headers: corsHeaders });
      }

      // Convert log to frontend format
      const convertedLog = convertLogToFrontendFormat(log);

      return Response.json({ log: convertedLog }, { headers: corsHeaders });
    }

    // Get usage stats
    if (path === '/api/stats' && req.method === 'GET') {
      const stats = logger.getUsageStats();
      return Response.json({ stats }, { headers: corsHeaders });
    }

    // Test API connection
    // Test API connection
    if (path.match(/^\/api\/configs\/[^/]+\/test$/) && req.method === 'POST') {
      const segments = path.split('/');
      const configName = decodeURIComponent(segments[3] || '');

      if (!configName) {
        return Response.json({ error: 'Config name missing' }, { status: 400, headers: corsHeaders });
      }
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      if (!serviceConfig) {
        return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders });
      }

      const config = serviceConfig.configs.find(c => c.name === configName);
      if (!config) {
        return Response.json({ error: 'Config not found' }, { status: 404, headers: corsHeaders });
      }

      if (!config.enabled) {
        return Response.json({
          success: false,
          message: 'Configuration disabled. Enable it before running tests.',
        }, { status: 400, headers: corsHeaders });
      }

      try {
        if (serviceName === 'claude') {
          const result = await runClaudeConfigTest({
            configName,
            config,
            serviceConfig,
          });
          return Response.json(result, { headers: corsHeaders });
        }

        const result = await runOpenAICompatTest({
          serviceName: serviceName as 'claude' | 'codex',
          configName,
          config,
          serviceConfig,
        });

        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        console.error(`[proxy:${serviceName}] Test execution failed:`, error);
        return Response.json({
          success: false,
          status_code: 0,
          duration_ms: 0,
          message: error instanceof Error ? error.message : 'Test execution failed',
          response_preview: '',
          completed_at: Date.now(),
          source: serviceName === 'claude' ? 'cli' : 'proxy',
          method: serviceName === 'claude' ? 'CLI' : 'POST',
          path: '/test',
        }, { headers: corsHeaders });
      }
    }


    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  } catch (error) {
    console.error('API error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

const CLAUDE_CLI_TIMEOUT_MS = 10000;

interface ConfigTestExecutionResult {
  success: boolean;
  status_code: number;
  duration_ms: number;
  message: string;
  response_preview: string;
  completed_at: number;
  source: 'cli' | 'proxy';
  method: string;
  path: string;
}

interface ClaudeConfigTestParams {
  configName: string;
  config: ProxyConfig;
  serviceConfig: ServiceConfig;
}

interface OpenAICompatTestParams {
  serviceName: 'claude' | 'codex';
  configName: string;
  config: ProxyConfig;
  serviceConfig: ServiceConfig;
}

async function runClaudeConfigTest({
  configName,
  config,
  serviceConfig,
}: ClaudeConfigTestParams): Promise<ConfigTestExecutionResult> {
  const testStartTime = Date.now();
  const logId = `test-${testStartTime}-${Math.random().toString(36).substring(7)}`;

  let success = false;
  let statusCode = 500;
  let message = '';
  let responsePreview = '';
  let errorDetail = '';
  let shouldFreeze = false;

  const baseUrl = config.baseUrl;
  const token = config.authToken || config.apiKey;

  let sandboxHome: string | null = null;
  let controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let stdoutPromise: Promise<string> | null = null;
  let stderrPromise: Promise<string> | null = null;
  let stdout = '';
  let stderr = '';

  const finalize = async (): Promise<ConfigTestExecutionResult> => {
    const durationMs = Date.now() - testStartTime;
    const completedAt = testStartTime + durationMs;

    if (!responsePreview && message) {
      responsePreview = trimPreview(message);
    }

    await logger.logRequest({
      id: logId,
      timestamp: testStartTime,
      service: 'claude',
      method: 'CLI',
      path: '/cli/test',
      targetUrl: baseUrl,
      configName,
      statusCode,
      duration: durationMs,
      error: success ? undefined : errorDetail || message,
      requestBody: 'claude "hi"',
      responsePreview,
      requestHeaders: {
        'anthropic-base-url': baseUrl ?? '',
        'auth-strategy': config.authToken ? 'auth_token' : (config.apiKey ? 'api_key' : 'none'),
      },
    }).catch(error => {
      console.error('[proxy:claude] Failed to log CLI test request:', error);
    });

    if (shouldFreeze && !success) {
      const freezeDuration = serviceConfig.loadBalancer.freezeDuration || 5 * 60 * 1000;
      const updatedConfig = await applyConfigFreeze('claude', serviceConfig, configName, Date.now() + freezeDuration);
      if (updatedConfig) {
        Object.assign(config, updatedConfig);
      }
    } else if (success && config.freezeUntil !== undefined) {
      const updatedConfig = await applyConfigFreeze('claude', serviceConfig, configName, undefined);
      if (updatedConfig) {
        delete config.freezeUntil;
        Object.assign(config, updatedConfig);
      } else {
        delete config.freezeUntil;
      }
    }

    return {
      success,
      status_code: statusCode,
      duration_ms: durationMs,
      message,
      response_preview: responsePreview,
      completed_at: completedAt,
      source: 'cli',
      method: 'CLI',
      path: '/cli/test',
    };
  };

  try {
    if (!baseUrl) {
      statusCode = 400;
      message = 'Claude configuration is missing a base URL';
      errorDetail = message;
      responsePreview = trimPreview(message);
      return finalize();
    }

    if (!token) {
      statusCode = 400;
      message = 'Claude configuration requires an auth token or API key';
      errorDetail = message;
      responsePreview = trimPreview(message);
      return finalize();
    }

    const claudeCli = Bun.which('claude');
    if (!claudeCli) {
      message = 'Claude CLI not found on PATH. Install `claude` to run connection tests.';
      errorDetail = message;
      return finalize();
    }

    const env: Record<string, string> = {};
    for (const key of Object.keys(process.env)) {
      const value = process.env[key];
      if (typeof value === 'string') {
        env[key] = value;
      }
    }

    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_DIR;

    sandboxHome = createClaudeSandbox();

    env.ANTHROPIC_BASE_URL = baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = token;
    env.ANTHROPIC_API_KEY = token;
    env.NO_COLOR = '1';
    env.HOME = sandboxHome;
    env.XDG_CONFIG_HOME = sandboxHome;
    env.CLAUDE_DIR = sandboxHome;
    env.PWD = sandboxHome;

    controller = new AbortController();
    timeout = setTimeout(() => controller?.abort(), CLAUDE_CLI_TIMEOUT_MS);

    const proc = Bun.spawn([claudeCli, '--dangerously-skip-permissions', 'hi'], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      env,
      cwd: sandboxHome,
      signal: controller.signal,
    });

    stdoutPromise = readStream(proc.stdout);
    stderrPromise = readStream(proc.stderr);

    const exitCode = await proc.exited;

    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    stdout = await (stdoutPromise ?? Promise.resolve(''));
    stderr = await (stderrPromise ?? Promise.resolve(''));

    success = exitCode === 0;
    shouldFreeze = !success;

    if (!success && (controller?.signal.aborted || exitCode === 143)) {
      statusCode = 504;
      message = `Claude CLI test timed out after ${CLAUDE_CLI_TIMEOUT_MS}ms`;
    } else {
      statusCode = success ? 200 : 500;
    }

    const previewSource = success ? stdout : (stderr || stdout);
    responsePreview = trimPreview(previewSource || '');

    if (success) {
      message = 'Claude CLI connection verified';
      errorDetail = '';
    } else if (!message) {
      const trimmed = stderr.trim() || stdout.trim();
      message = trimmed || `Claude CLI exited with status ${exitCode}`;
      errorDetail = message;
    }

    return finalize();
  } catch (error) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }

    shouldFreeze = true;

    if (stdoutPromise && !stdout) {
      try {
        stdout = await stdoutPromise;
      } catch {
        stdout = '';
      }
    }

    if (stderrPromise && !stderr) {
      try {
        stderr = await stderrPromise;
      } catch {
        stderr = '';
      }
    }

    if (controller?.signal.aborted && statusCode === 500) {
      statusCode = 504;
    }

    const errMessage = error instanceof Error ? error.message : String(error);
    if (!message) {
      message = errMessage;
    }
    if (!errorDetail) {
      errorDetail = errMessage;
    }
    if (!responsePreview) {
      responsePreview = trimPreview(stderr || stdout || errMessage);
    }

    console.error(`[proxy:claude] CLI test failed for config ${configName}:`, error);

    return finalize();
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    cleanupClaudeSandbox(sandboxHome);
  }
}

async function runOpenAICompatTest({
  serviceName,
  configName,
  config,
  serviceConfig,
}: OpenAICompatTestParams): Promise<ConfigTestExecutionResult> {
  const testStartTime = Date.now();
  const logId = `test-${testStartTime}-${Math.random().toString(36).substring(7)}`;

  if (!config.baseUrl) {
    const message = 'Configuration is missing a base URL';
    await logger.logRequest({
      id: logId,
      timestamp: testStartTime,
      service: serviceName,
      method: 'POST',
      path: '/test',
      configName,
      statusCode: 0,
      duration: 0,
      error: message,
    });

    return {
      success: false,
      status_code: 0,
      duration_ms: 0,
      message,
      response_preview: '',
      completed_at: testStartTime,
      source: 'proxy',
      method: 'POST',
      path: '/test',
    };
  }

  const normalizedBase =
    config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`;

  const testUrl = new URL('v1/chat/completions', normalizedBase).toString();

  const authHeaders: Record<string, string> = {
    'Accept-Encoding': 'identity',
  };

  if (config.apiKey) {
    authHeaders['x-api-key'] = config.apiKey;
  }
  if (config.authToken) {
    authHeaders['Authorization'] = `Bearer ${config.authToken}`;
  }

  const testHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...authHeaders,
  };

  const testBody = {
    model: 'gpt-3.5-turbo',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'hi' }],
  };

  const freezeDuration = serviceConfig.loadBalancer.freezeDuration || 5 * 60 * 1000;

  try {
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: testHeaders,
      body: JSON.stringify(testBody),
    });

    const duration = Date.now() - testStartTime;
    const responseText = await response.text();
    let responseJson: any = null;
    let responsePreview = '';

    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responsePreview = responseText.substring(0, 100);
    }

    if (!responsePreview && responseJson) {
      if (responseJson.error) {
        responsePreview = `Error: ${responseJson.error.message || JSON.stringify(responseJson.error)}`;
      } else if (responseJson.choices?.[0]?.message?.content) {
        responsePreview = responseJson.choices[0].message.content;
      }
    }

    responsePreview = trimPreview(responsePreview);

    const usage = logger.parseUsage(responseJson);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const testUrlObj = new URL(testUrl);
    const pathWithQuery = `${testUrlObj.pathname}${testUrlObj.search}`;

    await logger.logRequest({
      id: logId,
      timestamp: testStartTime,
      service: serviceName,
      method: 'POST',
      path: pathWithQuery,
      targetUrl: testUrl,
      configName,
      statusCode: response.status,
      duration,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: usage.model,
      error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      requestBody: JSON.stringify(testBody),
      responsePreview,
      requestHeaders: testHeaders as Record<string, string>,
      responseHeaders,
    });

    if (!response.ok) {
      const updated = await applyConfigFreeze(
        serviceName,
        serviceConfig,
        configName,
        Date.now() + freezeDuration
      );
      if (updated) {
        Object.assign(config, updated);
      }
    } else if (config.freezeUntil !== undefined) {
      const updated = await applyConfigFreeze(serviceName, serviceConfig, configName, undefined);
      if (updated) {
        delete config.freezeUntil;
        Object.assign(config, updated);
      } else {
        delete config.freezeUntil;
      }
    }

    return {
      success: response.ok,
      status_code: response.status,
      duration_ms: duration,
      message: response.ok ? 'Connection successful' : `HTTP ${response.status}`,
      response_preview: responsePreview,
      completed_at: testStartTime + duration,
      source: 'proxy',
      method: 'POST',
      path: pathWithQuery,
    };
  } catch (error) {
    const duration = Date.now() - testStartTime;
    const errorMessage = error instanceof Error ? error.message : 'Connection failed';

    const pathWithQuery = (() => {
      try {
        const url = new URL(testUrl);
        return `${url.pathname}${url.search}`;
      } catch {
        return '/test';
      }
    })();

    await logger.logRequest({
      id: logId,
      timestamp: testStartTime,
      service: serviceName,
      method: 'POST',
      path: pathWithQuery,
      targetUrl: testUrl,
      configName,
      statusCode: 0,
      duration,
      error: errorMessage,
      requestBody: JSON.stringify(testBody),
      requestHeaders: testHeaders as Record<string, string>,
    });

    const updated = await applyConfigFreeze(
      serviceName,
      serviceConfig,
      configName,
      Date.now() + freezeDuration
    );
    if (updated) {
      Object.assign(config, updated);
    }

    return {
      success: false,
      status_code: 0,
      duration_ms: duration,
      message: errorMessage,
      response_preview: '',
      completed_at: testStartTime + duration,
      source: 'proxy',
      method: 'POST',
      path: pathWithQuery,
    };
  }
}

async function autoRetestFrozenConfigs(serviceName: 'claude' | 'codex'): Promise<void> {
  const serviceConfig = configManager.getServiceConfig(serviceName);
  if (!serviceConfig) {
    return;
  }

  const now = Date.now();
  const pending = serviceConfig.configs.filter(c => typeof c.freezeUntil === 'number' && now >= (c.freezeUntil ?? 0));

  if (pending.length === 0) {
    return;
  }

  const lock = autoRetestLocks[serviceName];

  for (const frozenConfig of pending) {
    if (lock.has(frozenConfig.name)) {
      continue;
    }

    lock.add(frozenConfig.name);

    (async () => {
      try {
        if (serviceName === 'claude') {
          await runClaudeConfigTest({
            configName: frozenConfig.name,
            config: frozenConfig,
            serviceConfig,
          });
        } else {
          await runOpenAICompatTest({
            serviceName,
            configName: frozenConfig.name,
            config: frozenConfig,
            serviceConfig,
          });
        }
      } catch (error) {
        console.error(`[proxy:${serviceName}] Auto retest failed for ${frozenConfig.name}:`, error);
      } finally {
        lock.delete(frozenConfig.name);
      }
    })();
  }
}

async function readStream(stream?: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return '';
  }
  try {
    return await new Response(stream).text();
  } catch {
    return '';
  }
}

function trimPreview(value: string, limit = 200): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}...`;
}

function createClaudeSandbox(): string {
  const baseDir = join(tmpdir(), 'paf_claude_cli_tests');
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }
  return mkdtempSync(join(baseDir, 'run-'));
}

function cleanupClaudeSandbox(dir: string | null): void {
  if (!dir) {
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[proxy:claude] Failed to clean Claude CLI sandbox ${dir}:`, error);
  }
}

/**
 * Handle direct proxy traffic on dedicated service ports (e.g. 8801/8802)
 */
async function handleDirectProxyRequest(
  req: Request,
  serviceName: 'claude' | 'codex',
  proxy: ProxyService
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') || '*',
      },
    });
  }

  const servers = configManager.getAllConfigs(serviceName);

  if (servers.length === 0) {
    console.warn(`[proxy:${serviceName}] No configs available when handling ${req.method} ${req.url}`);
    return Response.json(
      { error: `No ${serviceName} configs available` },
      { status: 503 }
    );
  }

  try {
    return await proxy.handleRequest(req, servers);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Proxy error';
    console.error(`[proxy:${serviceName}] Request failed: ${msg}`);
    return Response.json({ error: msg }, { status: 502 });
  }
}
