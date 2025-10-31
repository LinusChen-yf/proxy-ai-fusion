// Main server entry point - Bun fullstack application

import { serve } from 'bun';
import { ConfigManager } from './config/manager';
import { LoadBalancer } from './routing/loadbalancer';
import { RequestLogger } from './logging/logger';
import { ProxyService } from './proxy/service';

// Initialize services
const configManager = new ConfigManager();
await configManager.initialize();

const systemConfig = configManager.getSystemConfig();
const logger = new RequestLogger(systemConfig.dataDir);

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
  }
);

// Initialize proxy services
const claudeProxy = new ProxyService({
  loadBalancer: claudeLoadBalancer,
  logger,
  serviceName: 'claude',
});

const codexProxy = new ProxyService({
  loadBalancer: codexLoadBalancer,
  logger,
  serviceName: 'codex',
});

console.log('Starting Proxy AI Fusion server...');
console.log(`Web UI: http://localhost:${systemConfig.webPort}`);
console.log(`Claude proxy: http://localhost:${systemConfig.proxyPorts.claude}`);
console.log(`Codex proxy: http://localhost:${systemConfig.proxyPorts.codex}`);

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
      return new Response(Bun.file('public/index.html'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Serve static files from public directory
    const publicPath = `public${path}`;
    const file = Bun.file(publicPath);

    if (await file.exists()) {
      return new Response(file);
    }

    // Try serving from root (for src/ during development)
    const rootPath = path.substring(1);
    const rootFile = Bun.file(rootPath);

    if (await rootFile.exists()) {
      return new Response(rootFile);
    }

    // Fallback to index.html for SPA routing
    return new Response(Bun.file('public/index.html'), {
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

    // Get all configs separated by service
    if (path === '/api/configs/separated' && req.method === 'GET') {
      const claudeConfig = configManager.getServiceConfig('claude');
      const codexConfig = configManager.getServiceConfig('codex');

      return Response.json({
        claude: {
          configs: claudeConfig?.configs || [],
          active: claudeConfig?.active,
          mode: claudeConfig?.mode || 'manual',
        },
        codex: {
          configs: codexConfig?.configs || [],
          active: codexConfig?.active,
          mode: codexConfig?.mode || 'manual',
        },
      }, { headers: corsHeaders });
    }

    // Get all configs
    if (path === '/api/configs' && req.method === 'GET') {
      const serviceName = url.searchParams.get('service') || 'claude';
      const serviceConfig = configManager.getServiceConfig(serviceName);

      return Response.json({
        configs: serviceConfig?.configs || [],
        active: serviceConfig?.active,
        mode: serviceConfig?.mode || 'manual',
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
    if (path.match(/^\/api\/configs\/[^/]+\/test$/) && req.method === 'POST') {
      const configName = path.split('/')[3];
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

      // Test the API connection
      const testStartTime = Date.now();
      const logId = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      let testUrl: string | null = null;

      try {
        // Build test request based on service type
        let testBody: any;
        let testHeaders: HeadersInit = {
          'Content-Type': 'application/json',
        };

        const normalizedBase =
          config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`;

        const authHeaders: Record<string, string> = {};
        if (config.apiKey) {
          authHeaders['x-api-key'] = config.apiKey;
        }
        if (config.authToken) {
          authHeaders['Authorization'] = `Bearer ${config.authToken}`;
          if (serviceName === 'claude' && !authHeaders['x-api-key']) {
            authHeaders['x-api-key'] = config.authToken;
          }
        }

        // Remove Accept-Encoding to prevent Brotli compression issues
        authHeaders['Accept-Encoding'] = 'identity';

        if (serviceName === 'claude') {
          authHeaders['anthropic-version'] = authHeaders['anthropic-version'] || '2023-06-01';

          let selectedModel = 'claude-3-haiku-20240307';
          try {
            const modelsUrl = new URL('v1/models', normalizedBase).toString();
            const modelResponse = await fetch(modelsUrl, {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                ...authHeaders,
              },
            });

            if (modelResponse.ok) {
              const modelJson = await modelResponse.json();
              const candidates: string[] = Array.isArray(modelJson?.data)
                ? modelJson.data
                    .map((item: any) => item?.id ?? item?.model ?? item)
                    .filter((id: any) => typeof id === 'string')
                : [];

              const haikuModel =
                candidates.find(id => /haiku/i.test(id)) ?? candidates[0];
              if (haikuModel) {
                selectedModel = haikuModel;
              }
            } else {
              console.warn(
                `[proxy:${serviceName}] Model list request failed with ${modelResponse.status} ${modelResponse.statusText}`
              );
            }
          } catch (error) {
            console.warn(`[proxy:${serviceName}] Failed to fetch model list`, error);
          }

          testUrl = new URL('v1/messages', normalizedBase).toString();
          testBody = {
            model: selectedModel,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'hi' }],
          };
        } else {
          // OpenAI-compatible API test
          testUrl = new URL('v1/chat/completions', normalizedBase).toString();
          testBody = {
            model: 'gpt-3.5-turbo',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'hi' }],
          };
        }

        testHeaders = {
          ...testHeaders,
          ...authHeaders,
        };

        if (!testUrl) {
          throw new Error('Test URL not configured');
        }

        const testResponse = await fetch(testUrl, {
          method: 'POST',
          headers: testHeaders,
          body: JSON.stringify(testBody),
        });

        const duration = Date.now() - testStartTime;
        const responseText = await testResponse.text();
        let responsePreview = '';
        let responseJson: any = null;

        try {
          responseJson = JSON.parse(responseText);
          // Get first content block for preview
          if (serviceName === 'claude' && responseJson.content?.[0]?.text) {
            responsePreview = responseJson.content[0].text;
          } else if (responseJson.choices?.[0]?.message?.content) {
            responsePreview = responseJson.choices[0].message.content;
          } else if (responseJson.error) {
            responsePreview = `Error: ${responseJson.error.message || JSON.stringify(responseJson.error)}`;
          }
        } catch {
          responsePreview = responseText.substring(0, 100);
        }

        // Parse usage information
        const usage = logger.parseUsage(responseJson);

        // Collect response headers
        const responseHeaders: Record<string, string> = {};
        testResponse.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const testUrlObj = new URL(testUrl);
        const testPathWithQuery = `${testUrlObj.pathname}${testUrlObj.search}`;

        // Log the test request
        await logger.logRequest({
          id: logId,
          timestamp: testStartTime,
          service: serviceName,
          method: 'POST',
          path: testPathWithQuery,
          targetUrl: testUrl,
          configName: configName,
          statusCode: testResponse.status,
          duration: duration,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          model: usage.model,
          error: testResponse.ok ? undefined : `HTTP ${testResponse.status}: ${responsePreview}`,
          requestHeaders: testHeaders as Record<string, string>,
          responseHeaders: responseHeaders,
          requestBody: JSON.stringify(testBody),
          responsePreview: responsePreview,
        });



        return Response.json({
          success: testResponse.ok,
          status_code: testResponse.status,
          duration_ms: duration,
          message: testResponse.ok ? 'Connection successful' : `HTTP ${testResponse.status}`,
          response_preview: responsePreview,
        }, { headers: corsHeaders });
      } catch (error) {
        const duration = Date.now() - testStartTime;
        const errorMessage = error instanceof Error ? error.message : 'Connection failed';

        // Log failed test request
        const failedPathWithQuery = (() => {
          if (!testUrl) {
            return '/test';
          }
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
          path: failedPathWithQuery,
          targetUrl: testUrl ?? undefined,
          configName: configName,
          statusCode: 0,
          duration: duration,
          error: errorMessage,
        });



        return Response.json({
          success: false,
          status_code: 0,
          duration_ms: duration,
          message: errorMessage,
          response_preview: '',
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

console.log(`✓ Server running on http://localhost:${systemConfig.webPort}`);

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
