/**
 * Notifications Module
 *
 * Provides notification capabilities for operational events.
 * All notifications are PII-free.
 */

export {
  INotifier,
  NotificationEvent,
  NotificationEventType,
  NotificationSeverity,
  NotificationCounters,
  NoopNotifier,
  formatNotificationEvent,
} from './Notifier';

export {
  WebhookNotifier,
  WebhookNotifierOptions,
  getWebhookNotifier,
  resetWebhookNotifier,
  createTestWebhookNotifier,
} from './WebhookNotifier';

export {
  NotificationRouter,
  RateLimitConfig,
  getNotificationRouter,
  resetNotificationRouter,
  createTestNotificationRouter,
  // Convenience functions
  notifyAutoStopExecuted,
  notifyOpsStopSend,
  notifyOpsResumeSend,
  notifyOpsRollback,
  notifyAutoSendSuccess,
  notifyAutoSendBlocked,
  notifySendApproved,
  notifyRampLimited,
  notifyFixProposalAccepted,
  notifyFixProposalRejected,
  notifyFixProposalImplemented,
  notifySendQueueDeadLetter,
  notifySendQueueBackoff,
  notifySendQueueReaped,
  // Summary notifications
  notifyOpsDailySummary,
  notifyOpsWeeklySummary,
  notifyOpsHealthSummary,
} from './NotificationRouter';
