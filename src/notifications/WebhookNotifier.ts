/**
 * Webhook Notifier
 *
 * Sends notifications to a webhook URL (Slack Incoming Webhook compatible).
 *
 * 設計:
 * - NOTIFY_WEBHOOK_URL が設定されている時のみ送信
 * - 送信失敗は例外を握りつぶし、通知失敗ログに記録
 * - PIIは一切含めない
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import {
  INotifier,
  NotificationEvent,
  formatNotificationEvent,
} from './Notifier';

/**
 * Notification failure record
 */
interface NotifyFailureRecord {
  timestamp: string;
  eventType: string;
  errorMessage: string;
  attemptId: string;
}

/**
 * Default failure log path
 */
const DEFAULT_FAILURE_LOG_PATH = path.join('data', 'notify_failures.ndjson');

/**
 * Webhook Notifier Options
 */
export interface WebhookNotifierOptions {
  /** Webhook URL (overrides env) */
  webhookUrl?: string;
  /** Failure log path (overrides default) */
  failureLogPath?: string;
  /** Custom HTTP client (for testing) */
  httpClient?: typeof https | typeof http;
}

/**
 * Webhook Notifier class
 */
export class WebhookNotifier implements INotifier {
  private readonly webhookUrl: string | null;
  private readonly failureLogPath: string;
  private readonly httpClient: typeof https | typeof http;

  constructor(options?: WebhookNotifierOptions) {
    this.webhookUrl =
      options?.webhookUrl || process.env.NOTIFY_WEBHOOK_URL || null;
    this.failureLogPath = options?.failureLogPath || DEFAULT_FAILURE_LOG_PATH;
    this.httpClient = options?.httpClient || https;
  }

  /**
   * Check if notifier is enabled
   */
  isEnabled(): boolean {
    return this.webhookUrl !== null && this.webhookUrl.length > 0;
  }

  /**
   * Get webhook URL (for testing/debugging, masked)
   */
  getWebhookUrlMasked(): string {
    if (!this.webhookUrl) return '(not configured)';
    try {
      const url = new URL(this.webhookUrl);
      return `${url.protocol}//${url.host}/***`;
    } catch {
      return '(invalid URL)';
    }
  }

  /**
   * Send notification
   *
   * Best effort - never throws, logs failures locally
   */
  async notify(event: NotificationEvent): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const attemptId = this.generateAttemptId();

    try {
      const payload = this.buildPayload(event);
      await this.sendWebhook(payload);
    } catch (error) {
      // Log failure but don't throw
      this.recordFailure(event, error, attemptId);
    }
  }

  /**
   * Build webhook payload (Slack compatible)
   */
  private buildPayload(event: NotificationEvent): object {
    // Format as Slack-compatible message
    const text = formatNotificationEvent(event);

    // Also include structured data for other webhook consumers
    return {
      text,
      event: {
        timestamp: event.timestamp,
        type: event.type,
        severity: event.severity,
        experimentId: event.experimentId,
        templateId: event.templateId,
        abVariant: event.abVariant,
        trackingId: event.trackingId,
        companyId: event.companyId,
        reason: event.reason,
        counters: event.counters,
      },
    };
  }

  /**
   * Send webhook request
   */
  private sendWebhook(payload: object): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.webhookUrl) {
        resolve();
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(this.webhookUrl);
      } catch {
        reject(new Error('Invalid webhook URL'));
        return;
      }

      const data = JSON.stringify(payload);

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 10000, // 10 second timeout
      };

      const client = parsedUrl.protocol === 'https:' ? https : http;
      const req = client.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `Webhook returned status ${res.statusCode}: ${responseBody.substring(0, 100)}`
              )
            );
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Webhook request failed: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook request timed out'));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Record notification failure
   */
  private recordFailure(
    event: NotificationEvent,
    error: unknown,
    attemptId: string
  ): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.failureLogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Mask any potential secrets in error message
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errorMessage = this.maskSecrets(errorMessage);

      const record: NotifyFailureRecord = {
        timestamp: new Date().toISOString(),
        eventType: event.type,
        errorMessage,
        attemptId,
      };

      fs.appendFileSync(
        this.failureLogPath,
        JSON.stringify(record) + '\n',
        'utf-8'
      );
    } catch {
      // If we can't even log the failure, just console.error
      console.error('[WebhookNotifier] Failed to record notification failure');
    }
  }

  /**
   * Mask potential secrets in error messages
   */
  private maskSecrets(message: string): string {
    // Mask URLs that might contain tokens
    return message.replace(
      /https?:\/\/[^\s]+/g,
      (url) => {
        try {
          const parsed = new URL(url);
          return `${parsed.protocol}//${parsed.host}/***`;
        } catch {
          return '***URL***';
        }
      }
    );
  }

  /**
   * Generate unique attempt ID
   */
  private generateAttemptId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}

/**
 * Singleton instance
 */
let defaultWebhookNotifier: WebhookNotifier | null = null;

/**
 * Get or create default webhook notifier
 */
export function getWebhookNotifier(): WebhookNotifier {
  if (!defaultWebhookNotifier) {
    defaultWebhookNotifier = new WebhookNotifier();
  }
  return defaultWebhookNotifier;
}

/**
 * Reset singleton (for testing)
 */
export function resetWebhookNotifier(): void {
  defaultWebhookNotifier = null;
}

/**
 * Create webhook notifier for testing
 */
export function createTestWebhookNotifier(
  options?: WebhookNotifierOptions
): WebhookNotifier {
  return new WebhookNotifier(options);
}

export default WebhookNotifier;
