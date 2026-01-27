/**
 * Retry Policy Tests
 */

import { RetryPolicy, createTestRetryPolicy } from '../src/domain/RetryPolicy';

describe('RetryPolicy', () => {
  describe('classifyError', () => {
    let policy: RetryPolicy;

    beforeEach(() => {
      policy = createTestRetryPolicy();
    });

    it('classifies 429 errors as retryable', () => {
      const result = policy.classifyError('Rate limit exceeded', 429);
      expect(result.code).toBe('gmail_429');
      expect(result.retryable).toBe(true);
      expect(result.deadLetterOnMaxAttempts).toBe(true);
    });

    it('classifies 429 from message as retryable', () => {
      const result = policy.classifyError('Error 429: Too many requests');
      expect(result.code).toBe('gmail_429');
      expect(result.retryable).toBe(true);
    });

    it('classifies rate limit messages as 429', () => {
      const result = policy.classifyError('Rate limit exceeded');
      expect(result.code).toBe('gmail_429');
      expect(result.retryable).toBe(true);
    });

    it('classifies 5xx errors as retryable', () => {
      const result = policy.classifyError('Server error', 500);
      expect(result.code).toBe('gmail_5xx');
      expect(result.retryable).toBe(true);
      expect(result.deadLetterOnMaxAttempts).toBe(true);
    });

    it('classifies 503 as retryable', () => {
      const result = policy.classifyError('Service unavailable', 503);
      expect(result.code).toBe('gmail_5xx');
      expect(result.retryable).toBe(true);
    });

    it('classifies server error messages as 5xx', () => {
      const result = policy.classifyError('Internal server error');
      expect(result.code).toBe('gmail_5xx');
      expect(result.retryable).toBe(true);
    });

    it('classifies 400 errors as non-retryable', () => {
      const result = policy.classifyError('Bad request', 400);
      expect(result.code).toBe('gmail_400');
      expect(result.retryable).toBe(false);
      expect(result.deadLetterOnMaxAttempts).toBe(false);
    });

    it('classifies auth errors as non-retryable', () => {
      const result = policy.classifyError('Unauthorized', 401);
      expect(result.code).toBe('auth');
      expect(result.retryable).toBe(false);
      expect(result.deadLetterOnMaxAttempts).toBe(true);
    });

    it('classifies invalid_grant as auth error', () => {
      const result = policy.classifyError('invalid_grant: Token has been expired');
      expect(result.code).toBe('auth');
      expect(result.retryable).toBe(false);
    });

    it('classifies policy errors as non-retryable without dead letter', () => {
      const result = policy.classifyError('kill_switch active');
      expect(result.code).toBe('policy');
      expect(result.retryable).toBe(false);
      expect(result.deadLetterOnMaxAttempts).toBe(false);
    });

    it('classifies allowlist errors as policy', () => {
      const result = policy.classifyError('Recipient not in allowlist');
      expect(result.code).toBe('policy');
      expect(result.retryable).toBe(false);
    });

    it('classifies gate errors as non-retryable without dead letter', () => {
      const result = policy.classifyError('PreSendGate violation: PII detected');
      expect(result.code).toBe('gate');
      expect(result.retryable).toBe(false);
      expect(result.deadLetterOnMaxAttempts).toBe(false);
    });

    it('classifies not found errors as non-retryable with dead letter', () => {
      const result = policy.classifyError('Draft not found', 404);
      expect(result.code).toBe('not_found');
      expect(result.retryable).toBe(false);
      expect(result.deadLetterOnMaxAttempts).toBe(true);
    });

    it('classifies unknown errors as retryable', () => {
      const result = policy.classifyError('Some unknown error happened');
      expect(result.code).toBe('unknown');
      expect(result.retryable).toBe(true);
      expect(result.deadLetterOnMaxAttempts).toBe(true);
    });
  });

  describe('calculateBackoff', () => {
    it('calculates exponential backoff', () => {
      const policy = createTestRetryPolicy({
        baseBackoffSeconds: 60,
        backoffMultiplier: 3,
        maxAttempts: 5,
        jitterFactor: 0, // Disable jitter for deterministic tests
      });

      // First attempt: 60 * 3^0 = 60s
      const result0 = policy.calculateBackoff(0);
      expect(result0.shouldRetry).toBe(true);
      expect(result0.backoffSeconds).toBe(60);

      // Second attempt: 60 * 3^1 = 180s
      const result1 = policy.calculateBackoff(1);
      expect(result1.shouldRetry).toBe(true);
      expect(result1.backoffSeconds).toBe(180);

      // Third attempt: 60 * 3^2 = 540s
      const result2 = policy.calculateBackoff(2);
      expect(result2.shouldRetry).toBe(true);
      expect(result2.backoffSeconds).toBe(540);

      // Fourth attempt: 60 * 3^3 = 1620s
      const result3 = policy.calculateBackoff(3);
      expect(result3.shouldRetry).toBe(true);
      expect(result3.backoffSeconds).toBe(1620);
    });

    it('respects max backoff cap', () => {
      const policy = createTestRetryPolicy({
        baseBackoffSeconds: 60,
        backoffMultiplier: 10,
        maxBackoffSeconds: 300, // 5 minutes
        maxAttempts: 5,
        jitterFactor: 0,
      });

      // First attempt: 60 * 10^0 = 60s (under cap)
      const result0 = policy.calculateBackoff(0);
      expect(result0.backoffSeconds).toBe(60);

      // Second attempt: 60 * 10^1 = 600s -> capped to 300s
      const result1 = policy.calculateBackoff(1);
      expect(result1.backoffSeconds).toBe(300);

      // Third attempt: would be 6000s -> capped to 300s
      const result2 = policy.calculateBackoff(2);
      expect(result2.backoffSeconds).toBe(300);
    });

    it('stops retrying at max attempts', () => {
      const policy = createTestRetryPolicy({
        maxAttempts: 3,
        jitterFactor: 0,
      });

      // Attempts 0, 1, 2 should retry
      expect(policy.calculateBackoff(0).shouldRetry).toBe(true);
      expect(policy.calculateBackoff(1).shouldRetry).toBe(true);
      expect(policy.calculateBackoff(2).shouldRetry).toBe(true);

      // Attempt 3 (4th total) should NOT retry
      const result3 = policy.calculateBackoff(3);
      expect(result3.shouldRetry).toBe(false);
      expect(result3.reason).toContain('Max attempts');
    });

    it('applies jitter within expected range', () => {
      const policy = createTestRetryPolicy({
        baseBackoffSeconds: 100,
        backoffMultiplier: 1,
        jitterFactor: 0.2, // ±20%
        maxAttempts: 5,
      });

      // With 20% jitter, 100s should become 80-120s
      // Run multiple times to check range
      for (let i = 0; i < 10; i++) {
        const result = policy.calculateBackoff(0);
        expect(result.backoffSeconds).toBeGreaterThanOrEqual(80);
        expect(result.backoffSeconds).toBeLessThanOrEqual(120);
      }
    });

    it('sets nextAttemptAt to future time', () => {
      const policy = createTestRetryPolicy({ jitterFactor: 0 });
      const now = Date.now();

      const result = policy.calculateBackoff(0);

      expect(result.nextAttemptAt.getTime()).toBeGreaterThan(now);
    });
  });

  describe('handleFailure', () => {
    let policy: RetryPolicy;

    beforeEach(() => {
      policy = createTestRetryPolicy({
        maxAttempts: 3,
        jitterFactor: 0,
      });
    });

    it('returns retry for retryable errors under max attempts', () => {
      const result = policy.handleFailure(1, 'Rate limit', 429);

      expect(result.classification.code).toBe('gmail_429');
      expect(result.action).toBe('retry');
      expect(result.backoff.shouldRetry).toBe(true);
    });

    it('returns dead_letter for retryable errors at max attempts', () => {
      const result = policy.handleFailure(3, 'Rate limit', 429);

      expect(result.classification.code).toBe('gmail_429');
      expect(result.action).toBe('dead_letter');
      expect(result.backoff.shouldRetry).toBe(false);
    });

    it('returns fail for non-retryable errors without dead letter', () => {
      const result = policy.handleFailure(1, 'Policy: kill_switch active');

      expect(result.classification.code).toBe('policy');
      expect(result.action).toBe('fail');
    });

    it('returns dead_letter for non-retryable auth errors', () => {
      const result = policy.handleFailure(1, 'invalid_grant', 401);

      expect(result.classification.code).toBe('auth');
      expect(result.action).toBe('dead_letter');
    });

    it('returns dead_letter for 5xx errors at max attempts', () => {
      const result = policy.handleFailure(3, 'Internal server error', 500);

      expect(result.classification.code).toBe('gmail_5xx');
      expect(result.action).toBe('dead_letter');
    });

    it('returns retry for unknown errors under max attempts', () => {
      const result = policy.handleFailure(1, 'Something weird happened');

      expect(result.classification.code).toBe('unknown');
      expect(result.action).toBe('retry');
    });
  });

  describe('getConfig', () => {
    it('returns current configuration', () => {
      const policy = createTestRetryPolicy({
        maxAttempts: 7,
        baseBackoffSeconds: 30,
      });

      const config = policy.getConfig();

      expect(config.maxAttempts).toBe(7);
      expect(config.baseBackoffSeconds).toBe(30);
    });

    it('returns default values when not overridden', () => {
      const policy = createTestRetryPolicy();
      const config = policy.getConfig();

      expect(config.maxAttempts).toBe(5);
      expect(config.baseBackoffSeconds).toBe(60);
      expect(config.maxBackoffSeconds).toBe(3600);
      expect(config.backoffMultiplier).toBe(3);
      expect(config.jitterFactor).toBe(0.2);
    });
  });
});
