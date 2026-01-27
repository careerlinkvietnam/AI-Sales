/**
 * Notification Router
 *
 * Routes notification events to configured notifiers with spam prevention.
 *
 * 機能:
 * - 通知イベントをNotifierへルーティング
 * - spam防止の簡易レート制限（同一type+reasonの連続通知を抑制）
 * - 主処理を落とさない（best effort）
 */

import {
  INotifier,
  NotificationEvent,
  NotificationEventType,
  NotificationSeverity,
  NotificationCounters,
  NoopNotifier,
} from './Notifier';
import { getWebhookNotifier } from './WebhookNotifier';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Suppression window in milliseconds (default: 10 minutes) */
  windowMs: number;
  /** Event types that should NOT be rate limited */
  neverSuppress: NotificationEventType[];
}

/**
 * Default rate limit config
 */
const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  neverSuppress: [
    'AUTO_STOP_EXECUTED',
    'OPS_STOP_SEND',
    'OPS_RESUME_SEND',
    'OPS_ROLLBACK',
    'OPS_DAILY_SUMMARY',
    'OPS_WEEKLY_SUMMARY',
    'OPS_HEALTH_SUMMARY',
    'OPS_WEEKLY_REVIEW_PACK',
  ],
};

/**
 * Rate limit entry
 */
interface RateLimitEntry {
  lastSent: number;
  count: number;
}

/**
 * Notification Router class
 */
export class NotificationRouter {
  private readonly notifiers: INotifier[];
  private readonly rateLimitConfig: RateLimitConfig;
  private readonly rateLimitCache: Map<string, RateLimitEntry>;

  constructor(options?: {
    notifiers?: INotifier[];
    rateLimitConfig?: Partial<RateLimitConfig>;
  }) {
    this.notifiers = options?.notifiers || [getWebhookNotifier()];
    this.rateLimitConfig = {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...options?.rateLimitConfig,
    };
    this.rateLimitCache = new Map();
  }

  /**
   * Route a notification event to all configured notifiers
   *
   * Best effort - never throws
   */
  async notify(event: NotificationEvent): Promise<boolean> {
    // Check rate limit
    if (this.isRateLimited(event)) {
      return false;
    }

    // Record this notification for rate limiting
    this.recordNotification(event);

    // Send to all notifiers (best effort)
    const results = await Promise.allSettled(
      this.notifiers.map((notifier) => notifier.notify(event))
    );

    // Check if at least one succeeded
    return results.some((r) => r.status === 'fulfilled');
  }

  /**
   * Create and send a notification event
   *
   * Helper method for common notification patterns
   */
  async sendNotification(params: {
    type: NotificationEventType;
    severity: NotificationSeverity;
    reason?: string;
    experimentId?: string;
    templateId?: string;
    abVariant?: 'A' | 'B';
    trackingId?: string;
    companyId?: string;
    counters?: NotificationCounters;
    meta?: Record<string, unknown>;
  }): Promise<boolean> {
    const event: NotificationEvent = {
      timestamp: new Date().toISOString(),
      type: params.type,
      severity: params.severity,
      reason: params.reason,
      experimentId: params.experimentId,
      templateId: params.templateId,
      abVariant: params.abVariant,
      trackingId: params.trackingId,
      companyId: params.companyId,
      counters: params.counters,
      meta: params.meta,
    };

    return this.notify(event);
  }

  /**
   * Check if event should be rate limited
   */
  private isRateLimited(event: NotificationEvent): boolean {
    // Never suppress critical events
    if (this.rateLimitConfig.neverSuppress.includes(event.type)) {
      return false;
    }

    const key = this.getRateLimitKey(event);
    const entry = this.rateLimitCache.get(key);

    if (!entry) {
      return false;
    }

    const now = Date.now();
    const elapsed = now - entry.lastSent;

    return elapsed < this.rateLimitConfig.windowMs;
  }

  /**
   * Record notification for rate limiting
   */
  private recordNotification(event: NotificationEvent): void {
    const key = this.getRateLimitKey(event);
    const now = Date.now();
    const entry = this.rateLimitCache.get(key);

    this.rateLimitCache.set(key, {
      lastSent: now,
      count: (entry?.count || 0) + 1,
    });

    // Clean up old entries periodically
    if (this.rateLimitCache.size > 1000) {
      this.cleanupRateLimitCache();
    }
  }

  /**
   * Generate rate limit key
   */
  private getRateLimitKey(event: NotificationEvent): string {
    // Key by type + reason (if present) + company (if present)
    const parts: string[] = [event.type];
    if (event.reason) parts.push(event.reason);
    if (event.companyId) parts.push(event.companyId);
    return parts.join(':');
  }

  /**
   * Clean up old rate limit entries
   */
  private cleanupRateLimitCache(): void {
    const now = Date.now();
    const threshold = now - this.rateLimitConfig.windowMs * 2;

    for (const [key, entry] of this.rateLimitCache.entries()) {
      if (entry.lastSent < threshold) {
        this.rateLimitCache.delete(key);
      }
    }
  }

  /**
   * Clear rate limit cache (for testing)
   */
  clearRateLimitCache(): void {
    this.rateLimitCache.clear();
  }

  /**
   * Check if any notifier is enabled
   */
  isEnabled(): boolean {
    return this.notifiers.some((n) => n.isEnabled());
  }

  /**
   * Get notifier count (for testing)
   */
  getNotifierCount(): number {
    return this.notifiers.length;
  }
}

/**
 * Singleton instance
 */
let defaultRouter: NotificationRouter | null = null;

/**
 * Get or create default notification router
 */
export function getNotificationRouter(): NotificationRouter {
  if (!defaultRouter) {
    defaultRouter = new NotificationRouter();
  }
  return defaultRouter;
}

/**
 * Reset singleton (for testing)
 */
export function resetNotificationRouter(): void {
  defaultRouter = null;
}

/**
 * Create notification router for testing
 */
export function createTestNotificationRouter(options?: {
  notifiers?: INotifier[];
  rateLimitConfig?: Partial<RateLimitConfig>;
}): NotificationRouter {
  return new NotificationRouter(options);
}

// ============================================================
// Convenience functions for common notification patterns
// ============================================================

/**
 * Notify auto-stop executed
 */
export async function notifyAutoStopExecuted(params: {
  reason: string;
  counters?: NotificationCounters;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'AUTO_STOP_EXECUTED',
    severity: 'error',
    reason: params.reason,
    counters: params.counters,
  });
}

/**
 * Notify ops stop send
 */
export async function notifyOpsStopSend(params: {
  reason: string;
  setBy: string;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'OPS_STOP_SEND',
    severity: 'warn',
    reason: `${params.reason} (by ${params.setBy})`,
  });
}

/**
 * Notify ops resume send
 */
export async function notifyOpsResumeSend(params: {
  reason: string;
  setBy: string;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'OPS_RESUME_SEND',
    severity: 'info',
    reason: `${params.reason} (by ${params.setBy})`,
  });
}

/**
 * Notify ops rollback
 */
export async function notifyOpsRollback(params: {
  experimentId: string;
  reason: string;
  setBy: string;
  stoppedSending: boolean;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'OPS_ROLLBACK',
    severity: 'error',
    experimentId: params.experimentId,
    reason: `${params.reason} (by ${params.setBy})${params.stoppedSending ? ' [SENDING STOPPED]' : ''}`,
  });
}

/**
 * Notify auto send success
 */
export async function notifyAutoSendSuccess(params: {
  trackingId: string;
  companyId: string;
  templateId?: string;
  abVariant?: 'A' | 'B';
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'AUTO_SEND_SUCCESS',
    severity: 'info',
    trackingId: params.trackingId,
    companyId: params.companyId,
    templateId: params.templateId,
    abVariant: params.abVariant,
  });
}

/**
 * Notify auto send blocked
 */
export async function notifyAutoSendBlocked(params: {
  trackingId: string;
  companyId: string;
  reason: string;
  templateId?: string;
  abVariant?: 'A' | 'B';
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'AUTO_SEND_BLOCKED',
    severity: 'warn',
    trackingId: params.trackingId,
    companyId: params.companyId,
    reason: params.reason,
    templateId: params.templateId,
    abVariant: params.abVariant,
  });
}

/**
 * Notify send approved
 */
export async function notifySendApproved(params: {
  trackingId: string;
  companyId: string;
  approvedBy: string;
  templateId?: string;
  abVariant?: 'A' | 'B';
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'SEND_APPROVED',
    severity: 'info',
    trackingId: params.trackingId,
    companyId: params.companyId,
    reason: `Approved by ${params.approvedBy}`,
    templateId: params.templateId,
    abVariant: params.abVariant,
  });
}

/**
 * Notify ramp limited
 */
export async function notifyRampLimited(params: {
  trackingId: string;
  companyId: string;
  reason: string;
  counters?: NotificationCounters;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'RAMP_LIMITED',
    severity: 'info',
    trackingId: params.trackingId,
    companyId: params.companyId,
    reason: params.reason,
    counters: params.counters,
  });
}

/**
 * Notify fix proposal accepted
 */
export async function notifyFixProposalAccepted(params: {
  proposalId: string;
  categoryId: string;
  priority: string;
  title: string;
  actor: string;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'FIX_PROPOSAL_ACCEPTED',
    severity: 'info',
    reason: `[${params.priority}] ${params.title}`,
    meta: {
      proposal_id: params.proposalId,
      category_id: params.categoryId,
      priority: params.priority,
      actor: params.actor,
    },
  });
}

/**
 * Notify fix proposal rejected
 */
export async function notifyFixProposalRejected(params: {
  proposalId: string;
  categoryId: string;
  priority: string;
  title: string;
  actor: string;
  reason: string;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'FIX_PROPOSAL_REJECTED',
    severity: 'warn',
    reason: `[${params.priority}] ${params.title} - ${params.reason}`,
    meta: {
      proposal_id: params.proposalId,
      category_id: params.categoryId,
      priority: params.priority,
      actor: params.actor,
    },
  });
}

/**
 * Notify fix proposal implemented
 */
export async function notifyFixProposalImplemented(params: {
  proposalId: string;
  categoryId: string;
  priority: string;
  title: string;
  actor: string;
  links?: { ticket?: string; pr?: string; commit?: string };
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'FIX_PROPOSAL_IMPLEMENTED',
    severity: 'info',
    reason: `[${params.priority}] ${params.title}`,
    meta: {
      proposal_id: params.proposalId,
      category_id: params.categoryId,
      priority: params.priority,
      actor: params.actor,
      links: params.links,
    },
  });
}

/**
 * Notify send queue dead letter
 */
export async function notifySendQueueDeadLetter(params: {
  jobId: string;
  errorCode: string;
  attempts: number;
  toDomain: string;
  templateId?: string;
  trackingId?: string;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'SEND_QUEUE_DEAD_LETTER',
    severity: 'error',
    reason: `Job ${params.jobId} moved to dead letter after ${params.attempts} attempts`,
    templateId: params.templateId,
    trackingId: params.trackingId,
    meta: {
      job_id: params.jobId,
      error_code: params.errorCode,
      attempts: params.attempts,
      to_domain: params.toDomain,
    },
  });
}

/**
 * Notify send queue backoff
 */
export async function notifySendQueueBackoff(params: {
  jobId: string;
  errorCode: string;
  nextAttemptAt: string;
  attempts: number;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'SEND_QUEUE_BACKOFF',
    severity: 'warn',
    reason: `Job ${params.jobId} backed off (attempt ${params.attempts})`,
    meta: {
      job_id: params.jobId,
      error_code: params.errorCode,
      next_attempt_at: params.nextAttemptAt,
      attempts: params.attempts,
    },
  });
}

/**
 * Notify send queue reaped (stale jobs recovered)
 */
export async function notifySendQueueReaped(params: {
  requeued: number;
  deadLettered: number;
  sampleJobIds: string[];
}): Promise<void> {
  const total = params.requeued + params.deadLettered;
  await getNotificationRouter().sendNotification({
    type: 'SEND_QUEUE_REAPED',
    severity: 'warn',
    reason: `Reaped ${total} stale job(s): ${params.requeued} requeued, ${params.deadLettered} dead_lettered`,
    meta: {
      requeued: params.requeued,
      dead_lettered: params.deadLettered,
      sample_job_ids: params.sampleJobIds,
    },
  });
}

/**
 * Notify ops daily summary
 */
export async function notifyOpsDailySummary(params: {
  severity: NotificationSeverity;
  text: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'OPS_DAILY_SUMMARY',
    severity: params.severity,
    reason: params.text,
    meta: params.meta,
  });
}

/**
 * Notify ops weekly summary
 */
export async function notifyOpsWeeklySummary(params: {
  severity: NotificationSeverity;
  text: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'OPS_WEEKLY_SUMMARY',
    severity: params.severity,
    reason: params.text,
    meta: params.meta,
  });
}

/**
 * Notify ops health summary
 */
export async function notifyOpsHealthSummary(params: {
  severity: NotificationSeverity;
  text: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await getNotificationRouter().sendNotification({
    type: 'OPS_HEALTH_SUMMARY',
    severity: params.severity,
    reason: params.text,
    meta: params.meta,
  });
}

/**
 * Notify ops weekly review pack
 */
export async function notifyOpsWeeklyReviewPack(params: {
  severity: NotificationSeverity;
  outputPath: string;
  kpiSummary: string;
  topActions: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const actionList = params.topActions.slice(0, 3).map(a => `- ${a}`).join('\n');
  const text = `Weekly Review Pack generated\n\nOutput: ${params.outputPath}\n\nKPI: ${params.kpiSummary}\n\nTop Actions:\n${actionList}`;
  await getNotificationRouter().sendNotification({
    type: 'OPS_WEEKLY_REVIEW_PACK',
    severity: params.severity,
    reason: text,
    meta: params.meta,
  });
}

export default NotificationRouter;
