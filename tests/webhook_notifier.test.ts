/**
 * WebhookNotifier Tests
 *
 * Tests for webhook notification sending.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  WebhookNotifier,
  createTestWebhookNotifier,
  resetWebhookNotifier,
} from '../src/notifications/WebhookNotifier';
import { NotificationEvent } from '../src/notifications/Notifier';

describe('WebhookNotifier', () => {
  const testFailureLogPath = path.join('data', 'test_notify_failures.ndjson');

  beforeEach(() => {
    jest.clearAllMocks();
    resetWebhookNotifier();

    // Clean up test failure log
    if (fs.existsSync(testFailureLogPath)) {
      fs.unlinkSync(testFailureLogPath);
    }
  });

  afterEach(() => {
    // Clean up test failure log
    if (fs.existsSync(testFailureLogPath)) {
      fs.unlinkSync(testFailureLogPath);
    }
  });

  describe('isEnabled', () => {
    it('should return false when no webhook URL', () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: undefined,
      });

      expect(notifier.isEnabled()).toBe(false);
    });

    it('should return false when webhook URL is empty', () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: '',
      });

      expect(notifier.isEnabled()).toBe(false);
    });

    it('should return true when webhook URL is configured', () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: 'https://hooks.slack.com/test',
      });

      expect(notifier.isEnabled()).toBe(true);
    });
  });

  describe('getWebhookUrlMasked', () => {
    it('should return not configured message when no URL', () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: undefined,
      });

      expect(notifier.getWebhookUrlMasked()).toBe('(not configured)');
    });

    it('should mask the URL path', () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxxx',
      });

      expect(notifier.getWebhookUrlMasked()).toBe('https://hooks.slack.com/***');
    });

    it('should handle invalid URLs', () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: 'not-a-valid-url',
      });

      expect(notifier.getWebhookUrlMasked()).toBe('(invalid URL)');
    });
  });

  describe('notify', () => {
    it('should not send when not enabled', async () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: undefined,
      });

      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
      };

      // Should complete without error
      await expect(notifier.notify(event)).resolves.toBeUndefined();
    });

    it('should log failure when webhook fails', async () => {
      // Create a notifier with an invalid URL that will fail
      const notifier = createTestWebhookNotifier({
        webhookUrl: 'https://invalid-url-that-does-not-exist.example.com/webhook',
        failureLogPath: testFailureLogPath,
      });

      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
      };

      // Should not throw, but log the failure
      await expect(notifier.notify(event)).resolves.toBeUndefined();

      // Wait a bit for async file write
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check failure was logged
      expect(fs.existsSync(testFailureLogPath)).toBe(true);
      const logContent = fs.readFileSync(testFailureLogPath, 'utf-8');
      const logEntry = JSON.parse(logContent.trim());
      expect(logEntry.eventType).toBe('AUTO_STOP_EXECUTED');
      expect(logEntry.errorMessage).toBeDefined();
    });

    it('should handle invalid webhook URL gracefully', async () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: 'not-a-valid-url',
        failureLogPath: testFailureLogPath,
      });

      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
      };

      // Should not throw
      await expect(notifier.notify(event)).resolves.toBeUndefined();

      // Check failure was logged
      expect(fs.existsSync(testFailureLogPath)).toBe(true);
      const logContent = fs.readFileSync(testFailureLogPath, 'utf-8');
      const logEntry = JSON.parse(logContent.trim());
      expect(logEntry.errorMessage).toContain('Invalid webhook URL');
    });
  });

  describe('failure log format', () => {
    it('should record attempt ID in failure log', async () => {
      const notifier = createTestWebhookNotifier({
        webhookUrl: 'invalid-url',
        failureLogPath: testFailureLogPath,
      });

      const event: NotificationEvent = {
        timestamp: '2026-01-26T10:00:00Z',
        type: 'AUTO_STOP_EXECUTED',
        severity: 'error',
      };

      await notifier.notify(event);

      const logContent = fs.readFileSync(testFailureLogPath, 'utf-8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.attemptId).toBeDefined();
      expect(logEntry.timestamp).toBeDefined();
      expect(logEntry.eventType).toBe('AUTO_STOP_EXECUTED');
    });
  });
});
