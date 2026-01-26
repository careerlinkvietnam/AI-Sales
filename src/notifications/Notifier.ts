/**
 * Notifier Interface
 *
 * Abstraction for sending notifications about operational events.
 *
 * 重要:
 * - PIIを含めない（メールアドレス、本文、candidate summary等は禁止）
 * - 通知は "集計/状態" と "識別子" のみ
 */

/**
 * Notification event types
 */
export type NotificationEventType =
  | 'AUTO_STOP_EXECUTED'
  | 'OPS_STOP_SEND'
  | 'OPS_RESUME_SEND'
  | 'OPS_ROLLBACK'
  | 'AUTO_SEND_SUCCESS'
  | 'AUTO_SEND_BLOCKED'
  | 'SEND_APPROVED'
  | 'RAMP_LIMITED';

/**
 * Notification severity levels
 */
export type NotificationSeverity = 'info' | 'warn' | 'error';

/**
 * Counter metrics (PII-free aggregates)
 */
export interface NotificationCounters {
  sent_3d?: number;
  reply_3d?: number;
  blocked_3d?: number;
  reply_rate_3d?: number;
  today_sent?: number;
  today_cap?: number;
}

/**
 * Notification event (PII-free)
 *
 * 制約:
 * - メールアドレス、本文、候補者情報は含めない
 * - 識別子（tracking_id, company_id等）とメタ情報のみ
 */
export interface NotificationEvent {
  /** Event timestamp */
  timestamp: string;
  /** Event type */
  type: NotificationEventType;
  /** Severity level */
  severity: NotificationSeverity;
  /** Experiment ID (optional) */
  experimentId?: string;
  /** Template ID (optional) */
  templateId?: string;
  /** A/B variant (optional) */
  abVariant?: 'A' | 'B';
  /** Tracking ID (optional) */
  trackingId?: string;
  /** Company ID (optional) */
  companyId?: string;
  /** Reason (PII-free, e.g., blocked reason) */
  reason?: string;
  /** Aggregate counters */
  counters?: NotificationCounters;
  /** Additional metadata (PII-free) */
  meta?: Record<string, unknown>;
}

/**
 * Notifier interface
 */
export interface INotifier {
  /**
   * Send a notification
   *
   * @param event - Notification event to send
   * @throws Should not throw - failures should be handled internally
   */
  notify(event: NotificationEvent): Promise<void>;

  /**
   * Check if notifier is configured/enabled
   */
  isEnabled(): boolean;
}

/**
 * Noop notifier (does nothing)
 */
export class NoopNotifier implements INotifier {
  async notify(_event: NotificationEvent): Promise<void> {
    // Do nothing
  }

  isEnabled(): boolean {
    return false;
  }
}

/**
 * Format notification event for display
 */
export function formatNotificationEvent(event: NotificationEvent): string {
  const parts: string[] = [];

  // Header with severity emoji
  const severityEmoji = {
    info: 'ℹ️',
    warn: '⚠️',
    error: '🚨',
  };
  parts.push(`${severityEmoji[event.severity]} [${event.type}]`);

  // Reason if present
  if (event.reason) {
    parts.push(`Reason: ${event.reason}`);
  }

  // Identifiers
  const ids: string[] = [];
  if (event.experimentId) ids.push(`experiment=${event.experimentId}`);
  if (event.templateId) ids.push(`template=${event.templateId}`);
  if (event.abVariant) ids.push(`variant=${event.abVariant}`);
  if (event.trackingId) ids.push(`tracking=${event.trackingId}`);
  if (event.companyId) ids.push(`company=${event.companyId}`);
  if (ids.length > 0) {
    parts.push(`IDs: ${ids.join(', ')}`);
  }

  // Counters
  if (event.counters) {
    const counters: string[] = [];
    if (event.counters.sent_3d !== undefined) counters.push(`sent_3d=${event.counters.sent_3d}`);
    if (event.counters.reply_3d !== undefined) counters.push(`reply_3d=${event.counters.reply_3d}`);
    if (event.counters.blocked_3d !== undefined) counters.push(`blocked_3d=${event.counters.blocked_3d}`);
    if (event.counters.reply_rate_3d !== undefined) {
      counters.push(`reply_rate_3d=${(event.counters.reply_rate_3d * 100).toFixed(1)}%`);
    }
    if (event.counters.today_sent !== undefined) counters.push(`today_sent=${event.counters.today_sent}`);
    if (event.counters.today_cap !== undefined) counters.push(`today_cap=${event.counters.today_cap}`);
    if (counters.length > 0) {
      parts.push(`Metrics: ${counters.join(', ')}`);
    }
  }

  // Timestamp
  parts.push(`Time: ${event.timestamp}`);

  return parts.join('\n');
}

export default { NoopNotifier, formatNotificationEvent };
