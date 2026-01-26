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
export type MetricEventType = 'DRAFT_CREATED' | 'SENT_DETECTED' | 'REPLY_DETECTED';

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
 */
export function getMetricsStore(): MetricsStore {
  if (!defaultStore) {
    defaultStore = new MetricsStore();
  }
  return defaultStore;
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
