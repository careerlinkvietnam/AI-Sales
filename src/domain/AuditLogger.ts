/**
 * Audit Logger for Pipeline Operations
 *
 * Logs pipeline operations to logs/audit.ndjson for compliance and debugging.
 *
 * 注意:
 * - PIIは含めない（本文、careerSummaryは入れない）
 * - logs/はgitignoreに追加すること
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CandidateExclusionResult } from './ContentGuards';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  /** Timestamp in ISO format */
  timestamp: string;
  /** Event type */
  eventType: 'pipeline_run' | 'draft_created' | 'validation_failed';
  /** Search tag used */
  tag: string;
  /** Company ID */
  companyId: string;
  /** Company name hash (for privacy) */
  companyNameHash?: string;
  /** Selected candidates info (no PII) */
  selectedCandidates: CandidateExclusionResult[];
  /** Whether draft was created */
  draftCreated: boolean;
  /** Gmail draft ID if created */
  gmailDraftId?: string;
  /** Operation mode */
  mode: 'stub' | 'real';
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Default log directory
 */
const DEFAULT_LOG_DIR = 'logs';
const DEFAULT_LOG_FILE = 'audit.ndjson';

/**
 * Audit Logger class
 */
export class AuditLogger {
  private readonly logDir: string;
  private readonly logFile: string;
  private readonly logPath: string;
  private readonly enabled: boolean;

  constructor(options?: {
    logDir?: string;
    logFile?: string;
    enabled?: boolean;
  }) {
    this.logDir = options?.logDir || DEFAULT_LOG_DIR;
    this.logFile = options?.logFile || DEFAULT_LOG_FILE;
    this.logPath = path.join(this.logDir, this.logFile);
    this.enabled = options?.enabled !== false;

    // Ensure log directory exists
    if (this.enabled) {
      this.ensureLogDir();
    }
  }

  /**
   * Log a pipeline run
   */
  logPipelineRun(data: {
    tag: string;
    companyId: string;
    companyName?: string;
    selectedCandidates: CandidateExclusionResult[];
    draftCreated: boolean;
    gmailDraftId?: string;
    mode: 'stub' | 'real';
    metadata?: Record<string, unknown>;
  }): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'pipeline_run',
      tag: data.tag,
      companyId: data.companyId,
      companyNameHash: data.companyName ? this.hashName(data.companyName) : undefined,
      selectedCandidates: data.selectedCandidates,
      draftCreated: data.draftCreated,
      gmailDraftId: data.gmailDraftId,
      mode: data.mode,
      metadata: data.metadata,
    };

    this.writeEntry(entry);
  }

  /**
   * Log a draft creation
   */
  logDraftCreated(data: {
    tag: string;
    companyId: string;
    gmailDraftId: string;
    candidateCount: number;
    mode: 'stub' | 'real';
  }): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'draft_created',
      tag: data.tag,
      companyId: data.companyId,
      selectedCandidates: [],
      draftCreated: true,
      gmailDraftId: data.gmailDraftId,
      mode: data.mode,
      metadata: {
        candidateCount: data.candidateCount,
      },
    };

    this.writeEntry(entry);
  }

  /**
   * Log a validation failure
   */
  logValidationFailed(data: {
    tag: string;
    companyId: string;
    violations: string[];
    mode: 'stub' | 'real';
  }): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'validation_failed',
      tag: data.tag,
      companyId: data.companyId,
      selectedCandidates: [],
      draftCreated: false,
      mode: data.mode,
      metadata: {
        violations: data.violations,
      },
    };

    this.writeEntry(entry);
  }

  /**
   * Get the log file path
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Read recent log entries (for testing/debugging)
   */
  readRecentEntries(limit: number = 10): AuditLogEntry[] {
    if (!this.enabled || !fs.existsSync(this.logPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries = lines
        .slice(-limit)
        .map(line => JSON.parse(line) as AuditLogEntry);
      return entries;
    } catch {
      return [];
    }
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private writeEntry(entry: AuditLogEntry): void {
    if (!this.enabled) {
      return;
    }

    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logPath, line, 'utf-8');
    } catch (error) {
      // Log to console as fallback (without PII)
      console.error(
        `[AuditLogger] Failed to write log: ${error instanceof Error ? error.message : 'Unknown'}`
      );
    }
  }

  /**
   * Hash company name for privacy
   */
  private hashName(name: string): string {
    return crypto.createHash('sha256').update(name).digest('hex').substring(0, 16);
  }
}

/**
 * Singleton instance for convenience
 */
let defaultLogger: AuditLogger | null = null;

/**
 * Get or create the default audit logger
 */
export function getAuditLogger(): AuditLogger {
  if (!defaultLogger) {
    defaultLogger = new AuditLogger();
  }
  return defaultLogger;
}

/**
 * Create audit logger for testing (disabled by default)
 */
export function createTestAuditLogger(enabled: boolean = false): AuditLogger {
  return new AuditLogger({
    logDir: 'logs/test',
    enabled,
  });
}

export default AuditLogger;
