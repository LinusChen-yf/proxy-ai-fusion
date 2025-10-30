// Database manager using Bun's built-in SQLite

import { Database } from 'bun:sqlite';
import { join } from 'path';

export interface RequestLog {
  id: string;
  timestamp: number;
  service?: string;             // Service name (claude, codex, etc.)
  method: string;
  path: string;
  targetUrl?: string;
  configName: string;
  statusCode?: number;
  duration?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  error?: string;
  requestModel?: string;       // Model requested in the API call
  requestBody?: string;         // Truncated request body (first 500 chars)
  responsePreview?: string;     // Truncated response preview (first 500 chars)
  requestHeaders?: Record<string, string>;   // Request headers
  responseHeaders?: Record<string, string>;  // Response headers
}

export class LogDatabase {
  private db: Database;

  constructor(dataDir: string) {
    const dbPath = join(dataDir, 'requests.db');
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Create requests table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        service TEXT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        target_url TEXT,
        config_name TEXT NOT NULL,
        status_code INTEGER,
        duration INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        model TEXT,
        error TEXT,
        request_model TEXT,
        request_body TEXT,
        response_preview TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add new columns if they don't exist (for migration)
    const addColumnIfNotExists = (column: string, type: string) => {
      try {
        this.db.run(`ALTER TABLE requests ADD COLUMN ${column} ${type}`);
      } catch (e) {
        // Column already exists, ignore
      }
    };

    addColumnIfNotExists('service', 'TEXT');
    addColumnIfNotExists('request_model', 'TEXT');
    addColumnIfNotExists('request_body', 'TEXT');
    addColumnIfNotExists('response_preview', 'TEXT');
    addColumnIfNotExists('request_headers', 'TEXT');
    addColumnIfNotExists('response_headers', 'TEXT');
    addColumnIfNotExists('target_url', 'TEXT');

    // Create indices for common queries
    this.db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_config_name ON requests(config_name)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_status_code ON requests(status_code)');
  }

  /**
   * Insert a new request log
   */
  insertLog(log: RequestLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO requests (
        id, timestamp, service, method, path, target_url, config_name,
        status_code, duration, input_tokens, output_tokens, model, error,
        request_model, request_body, response_preview,
        request_headers, response_headers
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      log.id,
      log.timestamp,
      log.service ?? null,
      log.method,
      log.path,
      log.targetUrl ?? null,
      log.configName,
      log.statusCode ?? null,
      log.duration ?? null,
      log.inputTokens ?? null,
      log.outputTokens ?? null,
      log.model ?? null,
      log.error ?? null,
      log.requestModel ?? null,
      log.requestBody ?? null,
      log.responsePreview ?? null,
      log.requestHeaders ? JSON.stringify(log.requestHeaders) : null,
      log.responseHeaders ? JSON.stringify(log.responseHeaders) : null
    );
  }

  /**
   * Get recent logs with pagination
   */
  getRecentLogs(limit = 100, offset = 0): RequestLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM requests
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(limit, offset) as any[];
    return rows.map(this.rowToLog);
  }

  /**
   * Get log by ID
   */
  getLogById(id: string): RequestLog | null {
    const stmt = this.db.prepare('SELECT * FROM requests WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.rowToLog(row) : null;
  }

  /**
   * Get logs by config name
   */
  getLogsByConfig(configName: string, limit = 100): RequestLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM requests
      WHERE config_name = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(configName, limit) as any[];
    return rows.map(this.rowToLog);
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful_requests,
        SUM(CASE WHEN status_code >= 400 OR error IS NOT NULL THEN 1 ELSE 0 END) as failed_requests,
        SUM(COALESCE(input_tokens, 0)) as total_input_tokens,
        SUM(COALESCE(output_tokens, 0)) as total_output_tokens
      FROM requests
    `);

    const row = stmt.get() as any;

    return {
      totalRequests: row.total_requests || 0,
      successfulRequests: row.successful_requests || 0,
      failedRequests: row.failed_requests || 0,
      totalInputTokens: row.total_input_tokens || 0,
      totalOutputTokens: row.total_output_tokens || 0,
    };
  }

  /**
   * Get usage stats by config
   */
  getUsageStatsByConfig(configName: string): {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgDuration: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_requests,
        SUM(COALESCE(input_tokens, 0)) as total_input_tokens,
        SUM(COALESCE(output_tokens, 0)) as total_output_tokens,
        AVG(COALESCE(duration, 0)) as avg_duration
      FROM requests
      WHERE config_name = ?
    `);

    const row = stmt.get(configName) as any;

    return {
      totalRequests: row.total_requests || 0,
      totalInputTokens: row.total_input_tokens || 0,
      totalOutputTokens: row.total_output_tokens || 0,
      avgDuration: row.avg_duration || 0,
    };
  }

  /**
   * Delete old logs (retention policy)
   */
  deleteOldLogs(daysToKeep = 30): number {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare('DELETE FROM requests WHERE timestamp < ?');
    const result = stmt.run(cutoffTime);
    return result.changes;
  }

  /**
   * Clear all logs
   */
  clearAllLogs(): number {
    const stmt = this.db.prepare('DELETE FROM requests');
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Convert database row to RequestLog
   */
  private rowToLog(row: any): RequestLog {
    return {
      id: row.id,
      timestamp: row.timestamp,
      service: row.service,
      method: row.method,
      path: row.path,
      targetUrl: row.target_url ?? undefined,
      configName: row.config_name,
      statusCode: row.status_code,
      duration: row.duration,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      model: row.model,
      error: row.error,
      requestModel: row.request_model,
      requestBody: row.request_body,
      responsePreview: row.response_preview,
      requestHeaders: row.request_headers ? JSON.parse(row.request_headers) : undefined,
      responseHeaders: row.response_headers ? JSON.parse(row.response_headers) : undefined,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
