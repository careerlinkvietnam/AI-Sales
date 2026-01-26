/**
 * Metrics Store for Email Campaign Analytics
 *
 * Stores tracking events in data/metrics.ndjson (append-only).
 *
 * 制約:
 * - PIIを保存しない（メールアドレス、本文、careerSummary禁止）
 * - tracking_idをキーにした計測データのみ
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Event types for metrics tracking
 */
export type MetricEventType =
  | 'DRAFT_CREATED'
  | 'SENT_DETECTED'
  | 'REPLY_DETECTED'
  | 'AUTO_SEND_ATTEMPT'
  | 'AUTO_SEND_SUCCESS'
  | 'AUTO_SEND_BLOCKED'
  | 'SEND_APPROVED'
  | 'OPS_STOP_SEND'
  | 'OPS_RESUME_SEND'
  | 'OPS_ROLLBACK';

/**
 * Blocked reason types (for AUTO_SEND_BLOCKED events)
 */
export type SendBlockedReason =
  | 'not_enabled'
  | 'kill_switch'
  | 'runtime_kill_switch'
  | 'allowlist'
  | 'rate_limit'
  | 'ramp_limited'
  | 'gate_failed'
  | 'invalid_token'
  | 'no_allowlist_configured'
  | 'not_in_registry'
  | 'token_draft_mismatch';

/**
 * Metrics event structure
 */
export interface MetricsEvent {
  /** Event timestamp in ISO format */
  timestamp: string;
  /** Tracking ID from email */
  trackingId: string;
  /** Company ID */
  companyId: string;
  /** Template ID used */
  templateId: string;
  /** A/B variant */
  abVariant: 'A' | 'B' | null;
  /** Event type */
  eventType: MetricEventType;
  /** Gmail thread ID (if available) */
  gmailThreadId: string | null;
  /** Hours between sent and reply (REPLY_DETECTED only) */
  replyLatencyHours: number | null;
  /** Additional metadata */
  meta: Record<string, unknown>;
}

/**
 * Default data directory
 */
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_METRICS_FILE = 'metrics.ndjson';

/**
 * Metrics Store class
 */
export class MetricsStore {
  private readonly dataDir: string;
  private readonly metricsFile: string;
  private readonly metricsPath: string;
  private readonly enabled: boolean;

  constructor(options?: {
    dataDir?: string;
    metricsFile?: string;
    enabled?: boolean;
  }) {
    this.dataDir = options?.dataDir || DEFAULT_DATA_DIR;
    this.metricsFile = options?.metricsFile || DEFAULT_METRICS_FILE;
    this.metricsPath = path.join(this.dataDir, this.metricsFile);
    this.enabled = options?.enabled !== false;

    // Ensure data directory exists
    if (this.enabled) {
      this.ensureDataDir();
    }
  }

  /**
   * Append a metrics event
   */
  appendEvent(event: Omit<MetricsEvent, 'timestamp'>): void {
    if (!this.enabled) return;

    const fullEvent: MetricsEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.writeEvent(fullEvent);
  }

  /**
   * Record DRAFT_CREATED event
   */
  recordDraftCreated(data: {
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    gmailDraftId?: string;
  }): void {
    this.appendEvent({
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      eventType: 'DRAFT_CREATED',
      gmailThreadId: null,
      replyLatencyHours: null,
      meta: {
        source: 'pipeline',
        gmailDraftId: data.gmailDraftId,
      },
    });
  }

  /**
   * Record SENT_DETECTED event
   */
  recordSentDetected(data: {
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    gmailThreadId: string;
    sentDate: string;
  }): void {
    this.appendEvent({
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      eventType: 'SENT_DETECTED',
      gmailThreadId: data.gmailThreadId,
      replyLatencyHours: null,
      meta: {
        source: 'gmail_scan_v1',
        sentDate: data.sentDate,
      },
    });
  }

  /**
   * Record REPLY_DETECTED event
   */
  recordReplyDetected(data: {
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    gmailThreadId: string;
    replyDate: string;
    sentDate: string;
  }): void {
    // Calculate reply latency in hours
    const sentTime = new Date(data.sentDate).getTime();
    const replyTime = new Date(data.replyDate).getTime();
    const replyLatencyHours = Math.max(0, (replyTime - sentTime) / (1000 * 60 * 60));

    this.appendEvent({
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      eventType: 'REPLY_DETECTED',
      gmailThreadId: data.gmailThreadId,
      replyLatencyHours: Math.round(replyLatencyHours * 10) / 10, // 1 decimal place
      meta: {
        source: 'gmail_scan_v1',
        replyDate: data.replyDate,
        sentDate: data.sentDate,
      },
    });
  }

  /**
   * Record AUTO_SEND_ATTEMPT event
   */
  recordAutoSendAttempt(data: {
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    draftId: string;
    recipientDomain?: string; // Domain only, not full email (no PII)
  }): void {
    this.appendEvent({
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      eventType: 'AUTO_SEND_ATTEMPT',
      gmailThreadId: null,
      replyLatencyHours: null,
      meta: {
        source: 'auto_send',
        draftId: data.draftId,
        recipientDomain: data.recipientDomain,
      },
    });
  }

  /**
   * Record AUTO_SEND_SUCCESS event
   */
  recordAutoSendSuccess(data: {
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    draftId: string;
    messageId: string;
    threadId: string;
    recipientDomain?: string;
  }): void {
    this.appendEvent({
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      eventType: 'AUTO_SEND_SUCCESS',
      gmailThreadId: data.threadId,
      replyLatencyHours: null,
      meta: {
        source: 'auto_send',
        draftId: data.draftId,
        messageId: data.messageId,
        recipientDomain: data.recipientDomain,
      },
    });
  }

  /**
   * Record AUTO_SEND_BLOCKED event
   */
  recordAutoSendBlocked(data: {
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    draftId: string;
    reason: SendBlockedReason;
    details?: string;
    recipientDomain?: string;
  }): void {
    this.appendEvent({
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      eventType: 'AUTO_SEND_BLOCKED',
      gmailThreadId: null,
      replyLatencyHours: null,
      meta: {
        source: 'auto_send',
        draftId: data.draftId,
        reason: data.reason,
        details: data.details,
        recipientDomain: data.recipientDomain,
      },
    });
  }

  /**
   * Record SEND_APPROVED event (approve_send CLI success)
   */
  recordSendApproved(data: {
    trackingId: string;
    companyId: string;
    templateId: string;
    abVariant: 'A' | 'B' | null;
    draftId: string;
    approvedBy: string;
    tokenFingerprint: string;
  }): void {
    this.appendEvent({
      trackingId: data.trackingId,
      companyId: data.companyId,
      templateId: data.templateId,
      abVariant: data.abVariant,
      eventType: 'SEND_APPROVED',
      gmailThreadId: null,
      replyLatencyHours: null,
      meta: {
        source: 'approve_send',
        draftId: data.draftId,
        approvedBy: data.approvedBy,
        tokenFingerprint: data.tokenFingerprint,
      },
    });
  }

  /**
   * Record OPS_STOP_SEND event (stop-send CLI)
   */
  recordOpsStopSend(data: {
    reason: string;
    setBy: string;
  }): void {
    this.appendEvent({
      trackingId: 'ops',
      companyId: 'ops',
      templateId: 'ops',
      abVariant: null,
      eventType: 'OPS_STOP_SEND',
      gmailThreadId: null,
      replyLatencyHours: null,
      meta: {
        source: 'run_ops',
        reason: data.reason,
        setBy: data.setBy,
      },
    });
  }

  /**
   * Record OPS_RESUME_SEND event (resume-send CLI)
   */
  recordOpsResumeSend(data: {
    reason: string;
    setBy: string;
  }): void {
    this.appendEvent({
      trackingId: 'ops',
      companyId: 'ops',
      templateId: 'ops',
      abVariant: null,
      eventType: 'OPS_RESUME_SEND',
      gmailThreadId: null,
      replyLatencyHours: null,
      meta: {
        source: 'run_ops',
        reason: data.reason,
        setBy: data.setBy,
      },
    });
  }

  /**
   * Record OPS_ROLLBACK event (rollback_experiment CLI)
   */
  recordOpsRollback(data: {
    experimentId: string;
    reason: string;
    setBy: string;
    stoppedSending: boolean;
  }): void {
    this.appendEvent({
      trackingId: 'ops',
      companyId: 'ops',
      templateId: data.experimentId,
      abVariant: null,
      eventType: 'OPS_ROLLBACK',
      gmailThreadId: null,
      replyLatencyHours: null,
      meta: {
        source: 'rollback_experiment',
        experimentId: data.experimentId,
        reason: data.reason,
        setBy: data.setBy,
        stoppedSending: data.stoppedSending,
      },
    });
  }

  /**
   * Count AUTO_SEND_SUCCESS events for today (UTC)
   */
  countTodaySends(): number {
    // Use UTC date directly to match ISO timestamps stored in the file
    const todayStr = new Date().toISOString().split('T')[0];

    const events = this.readAllEvents();
    return events.filter(
      (e) =>
        e.eventType === 'AUTO_SEND_SUCCESS' &&
        e.timestamp.startsWith(todayStr)
    ).length;
  }

  /**
   * Check if event already exists
   */
  hasEvent(trackingId: string, eventType: MetricEventType): boolean {
    const events = this.readAllEvents();
    return events.some(e => e.trackingId === trackingId && e.eventType === eventType);
  }

  /**
   * Get sent event for a tracking ID
   */
  getSentEvent(trackingId: string): MetricsEvent | null {
    const events = this.readAllEvents();
    return events.find(e => e.trackingId === trackingId && e.eventType === 'SENT_DETECTED') || null;
  }

  /**
   * Read all events
   */
  readAllEvents(): MetricsEvent[] {
    if (!this.enabled || !fs.existsSync(this.metricsPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.metricsPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map(line => JSON.parse(line) as MetricsEvent);
    } catch {
      return [];
    }
  }

  /**
   * Read events since a date
   */
  readEventsSince(sinceDate: string): MetricsEvent[] {
    const events = this.readAllEvents();
    const since = new Date(sinceDate);
    return events.filter(e => new Date(e.timestamp) >= since);
  }

  /**
   * Get the metrics file path
   */
  getMetricsPath(): string {
    return this.metricsPath;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private writeEvent(event: MetricsEvent): void {
    if (!this.enabled) return;

    try {
      const line = JSON.stringify(event) + '\n';
      fs.appendFileSync(this.metricsPath, line, 'utf-8');
    } catch (error) {
      console.error(
        `[MetricsStore] Failed to write event: ${error instanceof Error ? error.message : 'Unknown'}`
      );
    }
  }
}

/**
 * Singleton instance
 */
let defaultStore: MetricsStore | null = null;

/**
 * Get or create the default metrics store
 * Respects METRICS_STORE_PATH environment variable
 */
export function getMetricsStore(): MetricsStore {
  if (!defaultStore) {
    const envPath = process.env.METRICS_STORE_PATH;
    if (envPath) {
      const dir = path.dirname(envPath);
      const file = path.basename(envPath);
      defaultStore = new MetricsStore({ dataDir: dir, metricsFile: file });
    } else {
      defaultStore = new MetricsStore();
    }
  }
  return defaultStore;
}

/**
 * Reset the singleton for testing
 */
export function resetMetricsStore(): void {
  defaultStore = null;
}

/**
 * Create metrics store for testing
 */
export function createTestMetricsStore(enabled: boolean = false): MetricsStore {
  return new MetricsStore({
    dataDir: 'data/test',
    enabled,
  });
}

export default MetricsStore;
