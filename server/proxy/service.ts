// Proxy service - handles forwarding requests to upstream APIs

import type { ProxyConfig } from '../config/types';
import type { LoadBalancer } from '../routing/loadbalancer';
import type { RequestLogger } from '../logging/logger';

export interface ProxyOptions {
  loadBalancer: LoadBalancer;
  logger: RequestLogger;
  serviceName: string;
}

export class ProxyService {
  private loadBalancer: LoadBalancer;
  private logger: RequestLogger;
  private serviceName: string;

  constructor(options: ProxyOptions) {
    this.loadBalancer = options.loadBalancer;
    this.logger = options.logger;
    this.serviceName = options.serviceName;
  }

  /**
   * Handle incoming proxy request
   */
  async handleRequest(
    request: Request,
    servers: ProxyConfig[]
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let upstreamUrl: string | null = null;

    // Select upstream server
    const server = this.loadBalancer.selectServer(servers);

    if (!server) {
      return new Response('No upstream server available', { status: 503 });
    }



    // Clone and read request body for logging
    let requestBodyJson: any = null;
    let requestBodyForUpstream: BodyInit | null = null;

    if (request.body) {
      try {
        const requestClone = request.clone();
        const requestText = await requestClone.text();
        if (requestText) {
          requestBodyJson = JSON.parse(requestText);
          requestBodyForUpstream = requestText;
        }
      } catch (error) {
        console.error('Failed to read request body:', error);
        requestBodyForUpstream = request.body;
      }
    }

    try {
      // Build upstream URL
      const url = new URL(request.url);
      const base = server.baseUrl.replace(/\/+$/, '');
      const path = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
      upstreamUrl = `${base}${path}${url.search}`;

      // Build headers
      const headers = this.buildHeaders(request, server);

      // Use the request body
      const body = requestBodyForUpstream;

      // Check if streaming response is expected
      const acceptHeader = request.headers.get('accept') || '';
      const isStreaming = acceptHeader.includes('text/event-stream');

      // Remove Accept-Encoding to get uncompressed responses from upstream
      // This prevents Brotli compression issues
      delete headers['accept-encoding'];

      // Make upstream request
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body,
      });

      // Mark server health based on response
      if (upstreamResponse.ok) {
        this.loadBalancer.markSuccess(server.name);
      } else {
        this.loadBalancer.markFailure(server.name);
      }

      // Handle response
      if (isStreaming && upstreamResponse.body) {
        if (!upstreamResponse.ok) {
          console.warn(`[proxy:${this.serviceName}] streaming upstream ${upstreamResponse.status} for ${server.name} -> ${upstreamUrl}`);
        }
        return this.handleStreamingResponse(
          upstreamResponse,
          requestId,
          server,
          startTime,
          request,
          requestBodyJson,
          upstreamUrl
        );
      } else {
        if (!upstreamResponse.ok) {
          console.warn(`[proxy:${this.serviceName}] upstream ${upstreamResponse.status} for ${server.name} -> ${upstreamUrl}`);
        }
        return this.handleRegularResponse(
          upstreamResponse,
          requestId,
          server,
          startTime,
          request,
          requestBodyJson,
          upstreamUrl
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Mark server as failed
      this.loadBalancer.markFailure(server.name);



      // Extract request info
      const requestInfo = this.logger.extractRequestInfo(requestBodyJson);

      // Collect request headers
      const requestHeaders: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });

      const originalUrl = new URL(request.url);
      const pathWithQuery = `${originalUrl.pathname}${originalUrl.search}`;

      // Log error
      await this.logger.logRequest({
        id: requestId,
        timestamp: startTime,
        service: this.serviceName,
        method: request.method,
        path: pathWithQuery,
        targetUrl: upstreamUrl ?? undefined,
        configName: server.name,
        error: errorMessage,
        duration: Date.now() - startTime,
        requestModel: requestInfo.model,
        requestBody: requestInfo.preview,
        requestHeaders,
      });

      return new Response(
        JSON.stringify({ error: errorMessage }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  /**
   * Handle regular (non-streaming) response
   */
  private async handleRegularResponse(
    upstreamResponse: Response,
    requestId: string,
    server: ProxyConfig,
    startTime: number,
    originalRequest: Request,
    requestBodyJson: any,
    targetUrl: string
  ): Promise<Response> {
    const duration = Date.now() - startTime;
    const originalUrl = new URL(originalRequest.url);
    const pathWithQuery = `${originalUrl.pathname}${originalUrl.search}`;

    // Clone response to read body
    const responseClone = upstreamResponse.clone();
    let responseBody: any;

    try {
      const contentType = upstreamResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseBody = await responseClone.json();
      } else {
        responseBody = await responseClone.text();
      }
    } catch (error) {
      console.error('Failed to read response body:', error);
    }

    // Parse usage information
    const usage = this.logger.parseUsage(responseBody);

    // Extract request and response info
    const requestInfo = this.logger.extractRequestInfo(requestBodyJson);
    const responsePreview = this.logger.extractResponsePreview(responseBody);

    // Collect request headers
    const requestHeaders: Record<string, string> = {};
    originalRequest.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // Collect response headers for logging
    const headersForLogging: Record<string, string> = {};
    upstreamResponse.headers.forEach((value, key) => {
      headersForLogging[key] = value;
    });

    // Log request
    await this.logger.logRequest({
      id: requestId,
      timestamp: startTime,
      service: this.serviceName,
      method: originalRequest.method,
      path: pathWithQuery,
      targetUrl,
      configName: server.name,
      statusCode: upstreamResponse.status,
      duration,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: usage.model,
      requestModel: requestInfo.model,
      requestBody: requestInfo.preview,
      responsePreview,
      requestHeaders,
      responseHeaders: headersForLogging,
    });

    // Clone response and remove content-encoding header to prevent decompression errors
    // This ensures the client receives uncompressed data
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length'); // Content-Length may be invalid after decompression

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  /**
   * Handle streaming response (SSE)
   */
  private handleStreamingResponse(
    upstreamResponse: Response,
    requestId: string,
    server: ProxyConfig,
    startTime: number,
    originalRequest: Request,
    requestBodyJson: any,
    targetUrl: string
  ): Response {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = upstreamResponse.body!.getReader();
    const decoder = new TextDecoder();
    const originalUrl = new URL(originalRequest.url);
    const pathWithQuery = `${originalUrl.pathname}${originalUrl.search}`;

    // Collect headers early
    const requestHeaders: Record<string, string> = {};
    originalRequest.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    const headersForLogging: Record<string, string> = {};
    upstreamResponse.headers.forEach((value, key) => {
      headersForLogging[key] = value;
    });

    // Stream response chunks
    (async () => {
      try {
        let chunks: string[] = [];

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Write chunk to output stream
          await writer.write(value);

          // Decode chunk
          const chunk = decoder.decode(value, { stream: true });
          chunks.push(chunk);
        }

        // Complete the stream
        await writer.close();

        // Parse final usage from collected chunks
        const fullResponse = chunks.join('');
        const usage = this.parseStreamingUsage(fullResponse);

        // Extract request and response info
        const requestInfo = this.logger.extractRequestInfo(requestBodyJson);
        const responsePreview = fullResponse.substring(0, 500);

        // Log request
        const duration = Date.now() - startTime;
        await this.logger.logRequest({
          id: requestId,
          timestamp: startTime,
          service: this.serviceName,
          method: originalRequest.method,
          path: pathWithQuery,
          targetUrl,
          configName: server.name,
          statusCode: upstreamResponse.status,
          duration,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          model: usage.model,
          requestModel: requestInfo.model,
          requestBody: requestInfo.preview,
          responsePreview,
          requestHeaders,
          responseHeaders: headersForLogging,
        });


      } catch (error) {
        console.error('Streaming error:', error);
        await writer.abort(error);


      }
    })();

    // Return streaming response
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new Response(readable, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  /**
   * Build headers for upstream request
   */
  private buildHeaders(request: Request, server: ProxyConfig): HeadersInit {
    const headers: Record<string, string> = {};

    // Forward almost all original headers to mimic legacy proxy behaviour.
    const excluded = new Set(['host', 'content-length', 'authorization', 'x-api-key']);
    request.headers.forEach((value, key) => {
      if (!excluded.has(key)) {
        headers[key] = value;
      }
    });

    try {
      headers['host'] = new URL(server.baseUrl).host;
    } catch {
      // Fallback: let fetch compute the host header if baseUrl is invalid.
      delete headers['host'];
    }
    headers['connection'] = headers['connection'] || 'keep-alive';

    if (server.apiKey) {
      headers['x-api-key'] = server.apiKey;
    }

    if (server.authToken) {
      headers['authorization'] = `Bearer ${server.authToken}`;

      // Legacy CLI treated Claude auth tokens as API keys when no explicit key was set.
      if (this.serviceName === 'claude' && !headers['x-api-key']) {
        headers['x-api-key'] = server.authToken;
      }
    }

    if (this.serviceName === 'claude' && !headers['anthropic-version']) {
      headers['anthropic-version'] = '2023-06-01';
    }

    return headers;
  }

  /**
   * Parse usage from streaming response
   */
  private parseStreamingUsage(fullResponse: string): {
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
  } {
    try {
      // Extract SSE events
      const events = fullResponse.split('\n\n');

      for (const event of events) {
        if (event.includes('message_stop') || event.includes('[DONE]')) {
          continue;
        }

        const dataMatch = event.match(/data: (.+)/);
        if (dataMatch) {
          const data = JSON.parse(dataMatch[1]);

          // Anthropic format
          if (data.type === 'message_stop' && data.message?.usage) {
            return {
              inputTokens: data.message.usage.input_tokens,
              outputTokens: data.message.usage.output_tokens,
              model: data.message.model,
            };
          }

          // OpenAI format
          if (data.usage) {
            return {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
              model: data.model,
            };
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse streaming usage:', error);
    }

    return {};
  }
}
