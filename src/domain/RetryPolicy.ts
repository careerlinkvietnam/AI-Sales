/**
 * Retry Policy
 *
 * Classifies errors and calculates exponential backoff for retries.
 *
 * 重要:
 * - 429/5xx は retryable（一時的なエラー）
 * - auth/policy/gate は non-retryable（設定問題）
 * - dead_letter に落ちたら自動送信しない
 */

import { SendErrorCode } from '../data/SendQueueStore';

/**
 * Retry policy configuration
 */
export interface RetryPolicyConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base backoff in seconds */
  baseBackoffSeconds: number;
  /** Maximum backoff in seconds */
  maxBackoffSeconds: number;
  /** Backoff multiplier (for exponential growth) */
  backoffMultiplier: number;
  /** Add jitter to prevent thundering herd */
  jitterFactor: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RetryPolicyConfig = {
  maxAttempts: 5,
  baseBackoffSeconds: 60, // 1 minute
  maxBackoffSeconds: 3600, // 1 hour
  backoffMultiplier: 3,
  jitterFactor: 0.2,
};

/**
 * Error classification result
 */
export interface ErrorClassification {
  code: SendErrorCode;
  retryable: boolean;
  deadLetterOnMaxAttempts: boolean;
  reason: string;
}

/**
 * Backoff calculation result
 */
export interface BackoffResult {
  shouldRetry: boolean;
  backoffSeconds: number;
  nextAttemptAt: Date;
  reason: string;
}

/**
 * Retry Policy class
 */
export class RetryPolicy {
  private readonly config: RetryPolicyConfig;

  constructor(config?: Partial<RetryPolicyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Classify an error from Gmail API or other sources
   */
  classifyError(error: Error | string, httpStatus?: number): ErrorClassification {
    const message = typeof error === 'string' ? error : error.message;
    const lowerMessage = message.toLowerCase();

    // HTTP 429 - Rate limited
    if (httpStatus === 429 || lowerMessage.includes('429') || lowerMessage.includes('rate limit')) {
      return {
        code: 'gmail_429',
        retryable: true,
        deadLetterOnMaxAttempts: true,
        reason: 'Rate limited by Gmail API',
      };
    }

    // HTTP 5xx - Server error
    if (httpStatus && httpStatus >= 500 && httpStatus < 600) {
      return {
        code: 'gmail_5xx',
        retryable: true,
        deadLetterOnMaxAttempts: true,
        reason: `Gmail server error (${httpStatus})`,
      };
    }
    if (lowerMessage.includes('5') && lowerMessage.includes('internal') ||
        lowerMessage.includes('server error') ||
        lowerMessage.includes('service unavailable')) {
      return {
        code: 'gmail_5xx',
        retryable: true,
        deadLetterOnMaxAttempts: true,
        reason: 'Gmail server error',
      };
    }

    // HTTP 400 - Bad request (not retryable)
    if (httpStatus === 400 || lowerMessage.includes('bad request')) {
      return {
        code: 'gmail_400',
        retryable: false,
        deadLetterOnMaxAttempts: false,
        reason: 'Bad request - invalid draft or parameters',
      };
    }

    // Auth errors - Not retryable
    if (lowerMessage.includes('auth') ||
        lowerMessage.includes('invalid_grant') ||
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('401') ||
        lowerMessage.includes('403') ||
        lowerMessage.includes('token')) {
      return {
        code: 'auth',
        retryable: false,
        deadLetterOnMaxAttempts: true,
        reason: 'Authentication error - check credentials',
      };
    }

    // Policy errors - Not retryable
    if (lowerMessage.includes('policy') ||
        lowerMessage.includes('kill_switch') ||
        lowerMessage.includes('allowlist') ||
        lowerMessage.includes('not_enabled')) {
      return {
        code: 'policy',
        retryable: false,
        deadLetterOnMaxAttempts: false,
        reason: 'Policy check failed - sending not allowed',
      };
    }

    // Gate errors - Not retryable
    if (lowerMessage.includes('gate') ||
        lowerMessage.includes('presend') ||
        lowerMessage.includes('violation')) {
      return {
        code: 'gate',
        retryable: false,
        deadLetterOnMaxAttempts: false,
        reason: 'PreSendGate check failed',
      };
    }

    // Not found - Not retryable
    if (lowerMessage.includes('not found') ||
        lowerMessage.includes('404') ||
        lowerMessage.includes('draft') && lowerMessage.includes('missing')) {
      return {
        code: 'not_found',
        retryable: false,
        deadLetterOnMaxAttempts: true,
        reason: 'Draft not found',
      };
    }

    // Unknown error - Retry with caution
    return {
      code: 'unknown',
      retryable: true,
      deadLetterOnMaxAttempts: true,
      reason: 'Unknown error - will retry',
    };
  }

  /**
   * Calculate backoff for next retry
   */
  calculateBackoff(attemptNumber: number): BackoffResult {
    // Check if we've exceeded max attempts
    if (attemptNumber >= this.config.maxAttempts) {
      return {
        shouldRetry: false,
        backoffSeconds: 0,
        nextAttemptAt: new Date(),
        reason: `Max attempts (${this.config.maxAttempts}) exceeded`,
      };
    }

    // Calculate exponential backoff
    // backoff = base * multiplier^(attempt-1)
    let backoffSeconds = this.config.baseBackoffSeconds *
      Math.pow(this.config.backoffMultiplier, attemptNumber);

    // Apply max cap
    backoffSeconds = Math.min(backoffSeconds, this.config.maxBackoffSeconds);

    // Apply jitter (±jitterFactor)
    const jitter = 1 + (Math.random() * 2 - 1) * this.config.jitterFactor;
    backoffSeconds = Math.round(backoffSeconds * jitter);

    const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

    return {
      shouldRetry: true,
      backoffSeconds,
      nextAttemptAt,
      reason: `Retry in ${backoffSeconds}s (attempt ${attemptNumber + 1}/${this.config.maxAttempts})`,
    };
  }

  /**
   * Decide what to do after a failed attempt
   */
  handleFailure(
    attemptNumber: number,
    error: Error | string,
    httpStatus?: number
  ): {
    classification: ErrorClassification;
    backoff: BackoffResult;
    action: 'retry' | 'fail' | 'dead_letter';
  } {
    const classification = this.classifyError(error, httpStatus);
    const backoff = this.calculateBackoff(attemptNumber);

    // Non-retryable errors
    if (!classification.retryable) {
      return {
        classification,
        backoff: { shouldRetry: false, backoffSeconds: 0, nextAttemptAt: new Date(), reason: 'Not retryable' },
        action: classification.deadLetterOnMaxAttempts ? 'dead_letter' : 'fail',
      };
    }

    // Retryable but max attempts exceeded
    if (!backoff.shouldRetry) {
      return {
        classification,
        backoff,
        action: classification.deadLetterOnMaxAttempts ? 'dead_letter' : 'fail',
      };
    }

    // Will retry
    return {
      classification,
      backoff,
      action: 'retry',
    };
  }

  /**
   * Get configuration (for display)
   */
  getConfig(): RetryPolicyConfig {
    return { ...this.config };
  }
}

/**
 * Singleton instance
 */
let defaultPolicy: RetryPolicy | null = null;

/**
 * Get or create default policy
 */
export function getRetryPolicy(): RetryPolicy {
  if (!defaultPolicy) {
    defaultPolicy = new RetryPolicy();
  }
  return defaultPolicy;
}

/**
 * Reset singleton (for testing)
 */
export function resetRetryPolicy(): void {
  defaultPolicy = null;
}

/**
 * Create policy for testing
 */
export function createTestRetryPolicy(config?: Partial<RetryPolicyConfig>): RetryPolicy {
  return new RetryPolicy(config);
}

export default RetryPolicy;
