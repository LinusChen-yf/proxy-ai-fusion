// Request logger - handles logging of proxy requests

import { LogDatabase, type RequestLog } from './database';

export class RequestLogger {
  private db: LogDatabase;

  constructor(dataDir: string) {
    this.db = new LogDatabase(dataDir);
  }

  /**
   * Log a request
   */
  async logRequest(log: RequestLog): Promise<void> {
    // Insert asynchronously to avoid blocking
    queueMicrotask(() => {
      try {
        this.db.insertLog(log);
      } catch (error) {
        console.error('Failed to log request:', error);
      }
    });
  }

  /**
   * Parse usage information from response
   */
  parseUsage(responseBody: any): {
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
  } {
    try {
      if (!responseBody || typeof responseBody !== 'object') {
        return {};
      }

      // Handle Anthropic format (has input_tokens/output_tokens)
      if (responseBody?.usage?.input_tokens !== undefined) {
        return {
          inputTokens: responseBody.usage.input_tokens,
          outputTokens: responseBody.usage.output_tokens,
          model: responseBody.model,
        };
      }

      // Handle OpenAI format (has prompt_tokens/completion_tokens)
      if (responseBody?.usage?.prompt_tokens !== undefined) {
        return {
          inputTokens: responseBody.usage.prompt_tokens,
          outputTokens: responseBody.usage.completion_tokens,
          model: responseBody.model,
        };
      }

      return {};
    } catch (error) {
      console.error('Failed to parse usage:', error);
      return {};
    }
  }

  /**
   * Extract request information from request body
   */
  extractRequestInfo(requestBody: any): {
    model?: string;
    preview?: string;
  } {
    try {
      if (!requestBody || typeof requestBody !== 'object') {
        return {};
      }

      const model = requestBody.model;

      // Create a preview of the request (truncated)
      const preview = JSON.stringify(requestBody).substring(0, 500);

      return { model, preview };
    } catch (error) {
      console.error('Failed to extract request info:', error);
      return {};
    }
  }

  /**
   * Extract response preview
   */
  extractResponsePreview(responseBody: any): string {
    try {
      if (!responseBody) {
        return '';
      }

      // Handle string responses
      if (typeof responseBody === 'string') {
        return responseBody.substring(0, 500);
      }

      // Handle Anthropic format - get first content block
      if (responseBody.content && Array.isArray(responseBody.content) && responseBody.content[0]?.text) {
        return responseBody.content[0].text.substring(0, 500);
      }

      // Handle OpenAI format - get message content
      if (responseBody.choices?.[0]?.message?.content) {
        return responseBody.choices[0].message.content.substring(0, 500);
      }

      // Handle error responses
      if (responseBody.error) {
        const errorMsg = typeof responseBody.error === 'object'
          ? responseBody.error.message || JSON.stringify(responseBody.error)
          : responseBody.error;
        return `Error: ${errorMsg}`;
      }

      // Fallback: stringify the whole object
      return JSON.stringify(responseBody).substring(0, 500);
    } catch (error) {
      console.error('Failed to extract response preview:', error);
      return '';
    }
  }

  /**
   * Get recent logs
   */
  getRecentLogs(limit = 100, offset = 0): RequestLog[] {
    return this.db.getRecentLogs(limit, offset);
  }

  /**
   * Get log by ID
   */
  getLogById(id: string): RequestLog | null {
    return this.db.getLogById(id);
  }

  /**
   * Get logs by config
   */
  getLogsByConfig(configName: string, limit = 100): RequestLog[] {
    return this.db.getLogsByConfig(configName, limit);
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return this.db.getUsageStats();
  }

  /**
   * Get usage statistics by config
   */
  getUsageStatsByConfig(configName: string) {
    return this.db.getUsageStatsByConfig(configName);
  }

  /**
   * Clean up old logs
   */
  cleanupOldLogs(daysToKeep = 30): number {
    return this.db.deleteOldLogs(daysToKeep);
  }

  /**
   * Clear all logs
   */
  clearAllLogs(): number {
    return this.db.clearAllLogs();
  }

  /**
   * Close the logger
   */
  close(): void {
    this.db.close();
  }
}
