/**
 * Notifier Tests
 *
 * Tests for notification interfaces and formatting.
 */

import {
  NotificationEvent,
  NoopNotifier,
  formatNotificationEvent,
} from '../src/notifications/Notifier';

describe('NoopNotifier', () => {
  let notifier: NoopNotifier;

  beforeEach(() => {
    notifier = new NoopNotifier();
  });

  it('should return false for isEnabled', () => {
    expect(notifier.isEnabled()).toBe(false);
  });

  it('should not throw on notify', async () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'AUTO_STOP_EXECUTED',
      severity: 'error',
      reason: 'Test reason',
    };

    await expect(notifier.notify(event)).resolves.toBeUndefined();
  });
});

describe('formatNotificationEvent', () => {
  it('should format event with severity emoji', () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'AUTO_STOP_EXECUTED',
      severity: 'error',
      reason: 'Low reply rate',
    };

    const result = formatNotificationEvent(event);
    expect(result).toContain('🚨');
    expect(result).toContain('[AUTO_STOP_EXECUTED]');
    expect(result).toContain('Reason: Low reply rate');
  });

  it('should format info severity', () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'AUTO_SEND_SUCCESS',
      severity: 'info',
      trackingId: 'trk-123',
      companyId: 'comp-456',
    };

    const result = formatNotificationEvent(event);
    expect(result).toContain('ℹ️');
    expect(result).toContain('[AUTO_SEND_SUCCESS]');
    expect(result).toContain('tracking=trk-123');
    expect(result).toContain('company=comp-456');
  });

  it('should format warn severity', () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'OPS_STOP_SEND',
      severity: 'warn',
    };

    const result = formatNotificationEvent(event);
    expect(result).toContain('⚠️');
    expect(result).toContain('[OPS_STOP_SEND]');
  });

  it('should format all identifiers', () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'AUTO_SEND_SUCCESS',
      severity: 'info',
      experimentId: 'exp-001',
      templateId: 'tpl-002',
      abVariant: 'A',
      trackingId: 'trk-003',
      companyId: 'comp-004',
    };

    const result = formatNotificationEvent(event);
    expect(result).toContain('experiment=exp-001');
    expect(result).toContain('template=tpl-002');
    expect(result).toContain('variant=A');
    expect(result).toContain('tracking=trk-003');
    expect(result).toContain('company=comp-004');
  });

  it('should format counters', () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'AUTO_STOP_EXECUTED',
      severity: 'error',
      counters: {
        sent_3d: 50,
        reply_3d: 2,
        blocked_3d: 5,
        reply_rate_3d: 0.04,
      },
    };

    const result = formatNotificationEvent(event);
    expect(result).toContain('sent_3d=50');
    expect(result).toContain('reply_3d=2');
    expect(result).toContain('blocked_3d=5');
    expect(result).toContain('reply_rate_3d=4.0%');
  });

  it('should format today counters', () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'RAMP_LIMITED',
      severity: 'info',
      counters: {
        today_sent: 10,
        today_cap: 10,
      },
    };

    const result = formatNotificationEvent(event);
    expect(result).toContain('today_sent=10');
    expect(result).toContain('today_cap=10');
  });

  it('should include timestamp', () => {
    const event: NotificationEvent = {
      timestamp: '2026-01-26T10:00:00Z',
      type: 'AUTO_SEND_SUCCESS',
      severity: 'info',
    };

    const result = formatNotificationEvent(event);
    expect(result).toContain('Time: 2026-01-26T10:00:00Z');
  });
});
