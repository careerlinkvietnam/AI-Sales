/**
 * NotificationRouter Tests
 *
 * Tests for notification routing and rate limiting.
 */

import {
  NotificationRouter,
  createTestNotificationRouter,
  resetNotificationRouter,
} from '../src/notifications/NotificationRouter';
import { INotifier, NotificationEvent, NoopNotifier } from '../src/notifications/Notifier';

// Mock notifier for testing
class MockNotifier implements INotifier {
  public events: NotificationEvent[] = [];
  public enabled: boolean = true;
  public shouldFail: boolean = false;

  async notify(event: NotificationEvent): Promise<void> {
    if (this.shouldFail) {
      throw new Error('Mock failure');
    }
    this.events.push(event);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    this.events = [];
  }
}

describe('NotificationRouter', () => {
  let mockNotifier: MockNotifier;
  let router: NotificationRouter;

  beforeEach(() => {
    resetNotificationRouter();
    mockNotifier = new MockNotifier();
    router = createTestNotificationRouter({
      notifiers: [mockNotifier],
      rateLimitConfig: {
        windowMs: 1000, // 1 second for testing
      },
    });
  });

  describe('notify', () => {
    it('should send event to notifier', async () => {
      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
        reason: 'Test reason',
      };

      const result = await router.notify(event);

      expect(result).toBe(true);
      expect(mockNotifier.events).toHaveLength(1);
      expect(mockNotifier.events[0].type).toBe('AUTO_STOP_EXECUTED');
    });

    it('should return true if at least one notifier succeeds', async () => {
      const failingNotifier = new MockNotifier();
      failingNotifier.shouldFail = true;

      const multiRouter = createTestNotificationRouter({
        notifiers: [failingNotifier, mockNotifier],
      });

      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
      };

      const result = await multiRouter.notify(event);

      expect(result).toBe(true);
      expect(mockNotifier.events).toHaveLength(1);
    });

    it('should return false if all notifiers fail', async () => {
      mockNotifier.shouldFail = true;

      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
      };

      const result = await router.notify(event);

      expect(result).toBe(false);
    });
  });

  describe('rate limiting', () => {
    it('should not rate limit different event types', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        companyId: 'comp-1',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'AUTO_SEND_BLOCKED',
        severity: 'warn',
        companyId: 'comp-1',
      };

      await router.notify(event1);
      await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });

    it('should rate limit same type+reason within window', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        reason: 'Same reason',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        reason: 'Same reason',
      };

      await router.notify(event1);
      const result2 = await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(1);
      expect(result2).toBe(false);
    });

    it('should not rate limit same type with different reason', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_SEND_BLOCKED',
        severity: 'warn',
        reason: 'Reason A',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'AUTO_SEND_BLOCKED',
        severity: 'warn',
        reason: 'Reason B',
      };

      await router.notify(event1);
      await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });

    it('should not rate limit same type+reason for different companies', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        reason: 'Same reason',
        companyId: 'comp-1',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        reason: 'Same reason',
        companyId: 'comp-2',
      };

      await router.notify(event1);
      await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });

    it('should never rate limit critical events (AUTO_STOP_EXECUTED)', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
        reason: 'Same reason',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
        reason: 'Same reason',
      };

      await router.notify(event1);
      await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });

    it('should never rate limit OPS_STOP_SEND', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'OPS_STOP_SEND',
        severity: 'warn',
        reason: 'Same reason',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'OPS_STOP_SEND',
        severity: 'warn',
        reason: 'Same reason',
      };

      await router.notify(event1);
      await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });

    it('should never rate limit OPS_RESUME_SEND', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'OPS_RESUME_SEND',
        severity: 'info',
        reason: 'Same reason',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'OPS_RESUME_SEND',
        severity: 'info',
        reason: 'Same reason',
      };

      await router.notify(event1);
      await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });

    it('should never rate limit OPS_ROLLBACK', async () => {
      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'OPS_ROLLBACK',
        severity: 'error',
        experimentId: 'exp-1',
      };

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'OPS_ROLLBACK',
        severity: 'error',
        experimentId: 'exp-1',
      };

      await router.notify(event1);
      await router.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });

    it('should allow events after window expires', async () => {
      const shortWindowRouter = createTestNotificationRouter({
        notifiers: [mockNotifier],
        rateLimitConfig: {
          windowMs: 50, // 50ms window
        },
      });

      const event1: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        reason: 'Same reason',
      };

      await shortWindowRouter.notify(event1);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      const event2: NotificationEvent = {
        timestamp: '2026-01-26T10:00:01Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        reason: 'Same reason',
      };

      await shortWindowRouter.notify(event2);

      expect(mockNotifier.events).toHaveLength(2);
    });
  });

  describe('sendNotification', () => {
    it('should create and send notification event', async () => {
      await router.sendNotification({
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        trackingId: 'trk-123',
        companyId: 'comp-456',
      });

      expect(mockNotifier.events).toHaveLength(1);
      const event = mockNotifier.events[0];
      expect(event.type).toBe('AUTO_SEND_SUCCESS');
      expect(event.severity).toBe('info');
      expect(event.trackingId).toBe('trk-123');
      expect(event.companyId).toBe('comp-456');
      expect(event.timestamp).toBeDefined();
    });

    it('should include all optional fields', async () => {
      await router.sendNotification({
        type: 'AUTO_SEND_BLOCKED',
        severity: 'warn',
        reason: 'Test reason',
        experimentId: 'exp-001',
        templateId: 'tpl-002',
        abVariant: 'A',
        trackingId: 'trk-003',
        companyId: 'comp-004',
        counters: {
          sent_3d: 50,
          reply_3d: 5,
        },
        meta: { custom: 'value' },
      });

      const event = mockNotifier.events[0];
      expect(event.reason).toBe('Test reason');
      expect(event.experimentId).toBe('exp-001');
      expect(event.templateId).toBe('tpl-002');
      expect(event.abVariant).toBe('A');
      expect(event.counters?.sent_3d).toBe(50);
      expect(event.meta?.custom).toBe('value');
    });
  });

  describe('isEnabled', () => {
    it('should return true if any notifier is enabled', () => {
      expect(router.isEnabled()).toBe(true);
    });

    it('should return false if all notifiers are disabled', () => {
      mockNotifier.enabled = false;

      const disabledRouter = createTestNotificationRouter({
        notifiers: [mockNotifier],
      });

      expect(disabledRouter.isEnabled()).toBe(false);
    });
  });

  describe('clearRateLimitCache', () => {
    it('should clear rate limit cache', async () => {
      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_SEND_SUCCESS',
        severity: 'info',
        reason: 'Same reason',
      };

      await router.notify(event);

      // Second event should be rate limited
      const result1 = await router.notify(event);
      expect(result1).toBe(false);

      // Clear cache
      router.clearRateLimitCache();

      // Now it should work
      const result2 = await router.notify(event);
      expect(result2).toBe(true);
      expect(mockNotifier.events).toHaveLength(2);
    });
  });

  describe('getNotifierCount', () => {
    it('should return correct notifier count', () => {
      expect(router.getNotifierCount()).toBe(1);

      const multiRouter = createTestNotificationRouter({
        notifiers: [mockNotifier, new NoopNotifier()],
      });

      expect(multiRouter.getNotifierCount()).toBe(2);
    });
  });
});
