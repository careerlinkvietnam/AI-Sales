/**
 * AutoStopPolicy Tests
 *
 * Tests for automatic stop evaluation based on metrics thresholds.
 */

import {
  AutoStopPolicy,
  createTestAutoStopPolicy,
  resetAutoStopPolicy,
  AutoStopMetrics,
  DailyMetrics,
} from '../src/domain/AutoStopPolicy';

describe('AutoStopPolicy', () => {
  afterEach(() => {
    resetAutoStopPolicy();
  });

  function createDailyMetrics(overrides: Partial<DailyMetrics> = {}): DailyMetrics {
    return {
      date: '2026-01-26',
      attempts: 10,
      success: 10,
      blocked: 0,
      replies: 1,
      ...overrides,
    };
  }

  function createMetrics(overrides: Partial<AutoStopMetrics> = {}): AutoStopMetrics {
    return {
      totalAttempts: 100,
      totalSuccess: 100,
      totalBlocked: 0,
      totalReplies: 5,
      dailyMetrics: [],
      ...overrides,
    };
  }

  describe('minimum sent threshold', () => {
    it('should not stop if below min_sent_total', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.05, // 5%
      });

      const metrics = createMetrics({
        totalSuccess: 10, // Below 30
        totalReplies: 0,  // 0% reply rate - would normally trigger
      });

      const result = policy.evaluate(metrics);
      expect(result.should_stop).toBe(false);
      expect(result.reasons[0]).toContain('Insufficient data');
    });

    it('should evaluate if at or above min_sent_total', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.05,
        consecutive_days: 1,
      });

      const metrics = createMetrics({
        totalSuccess: 30,
        totalReplies: 0,
        dailyMetrics: [
          createDailyMetrics({ date: '2026-01-26', success: 30, replies: 0 }),
        ],
      });

      const result = policy.evaluate(metrics);
      // Should evaluate (not skip due to min_sent)
      expect(result.reasons[0]).not.toContain('Insufficient data');
    });
  });

  describe('reply rate check', () => {
    it('should flag low reply rate', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.015, // 1.5%
        consecutive_days: 2,
      });

      const metrics = createMetrics({
        totalSuccess: 100,
        totalReplies: 1, // 1% - below 1.5%
        dailyMetrics: [
          createDailyMetrics({ date: '2026-01-26', success: 50, replies: 0 }),
          createDailyMetrics({ date: '2026-01-25', success: 50, replies: 1 }),
        ],
      });

      const result = policy.evaluate(metrics);
      expect(result.reasons.some(r => r.includes('Reply rate too low'))).toBe(true);
    });

    it('should not flag acceptable reply rate', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.015,
        consecutive_days: 2,
      });

      const metrics = createMetrics({
        totalSuccess: 100,
        totalReplies: 5, // 5% - above 1.5%
        dailyMetrics: [],
      });

      const result = policy.evaluate(metrics);
      expect(result.reasons.some(r => r.includes('Reply rate too low'))).toBe(false);
    });
  });

  describe('blocked rate check', () => {
    it('should flag high blocked rate', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        blocked_rate_max: 0.30, // 30%
        consecutive_days: 2,
      });

      const metrics = createMetrics({
        totalAttempts: 100,
        totalSuccess: 60,
        totalBlocked: 40, // 40% blocked - above 30%
        totalReplies: 10,
        dailyMetrics: [
          createDailyMetrics({ date: '2026-01-26', attempts: 50, success: 30, blocked: 20, replies: 5 }),
          createDailyMetrics({ date: '2026-01-25', attempts: 50, success: 30, blocked: 20, replies: 5 }),
        ],
      });

      const result = policy.evaluate(metrics);
      expect(result.reasons.some(r => r.includes('Blocked rate too high'))).toBe(true);
    });

    it('should not flag acceptable blocked rate', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        blocked_rate_max: 0.30,
        consecutive_days: 2,
      });

      const metrics = createMetrics({
        totalAttempts: 100,
        totalSuccess: 80,
        totalBlocked: 10, // 10% blocked - below 30%
        totalReplies: 10,
        dailyMetrics: [],
      });

      const result = policy.evaluate(metrics);
      expect(result.reasons.some(r => r.includes('Blocked rate too high'))).toBe(false);
    });
  });

  describe('consecutive days check', () => {
    it('should stop when consecutive bad days threshold is met', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.02, // 2%
        blocked_rate_max: 0.30,
        consecutive_days: 2,
      });

      // Two consecutive bad days (0% reply rate)
      const metrics = createMetrics({
        totalSuccess: 100,
        totalReplies: 0,
        dailyMetrics: [
          createDailyMetrics({ date: '2026-01-26', success: 50, replies: 0 }),
          createDailyMetrics({ date: '2026-01-25', success: 50, replies: 0 }),
        ],
      });

      const result = policy.evaluate(metrics);
      expect(result.should_stop).toBe(true);
      expect(result.metrics.consecutiveBadDays).toBe(2);
    });

    it('should not stop when consecutive days not met', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.02,
        blocked_rate_max: 0.30,
        consecutive_days: 3, // Requires 3 days
      });

      // Only two consecutive bad days
      const metrics = createMetrics({
        totalSuccess: 100,
        totalReplies: 0,
        dailyMetrics: [
          createDailyMetrics({ date: '2026-01-26', success: 50, replies: 0 }),
          createDailyMetrics({ date: '2026-01-25', success: 50, replies: 0 }),
          createDailyMetrics({ date: '2026-01-24', success: 50, replies: 5 }), // Good day
        ],
      });

      const result = policy.evaluate(metrics);
      expect(result.should_stop).toBe(false);
      expect(result.reasons.some(r => r.includes('Waiting for'))).toBe(true);
    });

    it('should count consecutive bad days from most recent', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.02,
        consecutive_days: 2,
      });

      // Pattern: bad, good, bad, bad (should count only 1 from most recent)
      const metrics = createMetrics({
        totalSuccess: 200,
        totalReplies: 10,
        dailyMetrics: [
          createDailyMetrics({ date: '2026-01-26', success: 50, replies: 0 }), // bad
          createDailyMetrics({ date: '2026-01-25', success: 50, replies: 5 }), // good - breaks chain
          createDailyMetrics({ date: '2026-01-24', success: 50, replies: 0 }), // bad
          createDailyMetrics({ date: '2026-01-23', success: 50, replies: 0 }), // bad
        ],
      });

      const result = policy.evaluate(metrics);
      expect(result.metrics.consecutiveBadDays).toBe(1);
      expect(result.should_stop).toBe(false);
    });
  });

  describe('combined checks', () => {
    it('should only stop when both metric issue and consecutive days are met', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
        reply_rate_min: 0.02,
        blocked_rate_max: 0.30,
        consecutive_days: 2,
      });

      // Good overall reply rate but issues in recent consecutive days
      const metrics = createMetrics({
        totalSuccess: 200,
        totalReplies: 10, // 5% overall - good
        dailyMetrics: [
          createDailyMetrics({ date: '2026-01-26', success: 50, replies: 0 }), // bad
          createDailyMetrics({ date: '2026-01-25', success: 50, replies: 0 }), // bad
          createDailyMetrics({ date: '2026-01-24', success: 50, replies: 5 }), // good
          createDailyMetrics({ date: '2026-01-23', success: 50, replies: 5 }), // good
        ],
      });

      const result = policy.evaluate(metrics);
      // Overall rate is good, but consecutive days trigger
      expect(result.should_stop).toBe(true);
    });
  });

  describe('metrics calculation', () => {
    it('should correctly calculate reply rate', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 10,
      });

      const metrics = createMetrics({
        totalSuccess: 100,
        totalReplies: 3,
      });

      const result = policy.evaluate(metrics);
      expect(result.metrics.replyRate).toBe(0.03); // 3%
    });

    it('should correctly calculate blocked rate', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 10,
      });

      const metrics = createMetrics({
        totalAttempts: 100,
        totalSuccess: 75,
        totalBlocked: 25,
        totalReplies: 10,
      });

      const result = policy.evaluate(metrics);
      expect(result.metrics.blockedRate).toBe(0.25); // 25%
    });

    it('should handle zero sends gracefully', () => {
      const policy = createTestAutoStopPolicy({
        min_sent_total: 30,
      });

      const metrics = createMetrics({
        totalAttempts: 0,
        totalSuccess: 0,
        totalBlocked: 0,
        totalReplies: 0,
      });

      const result = policy.evaluate(metrics);
      expect(result.should_stop).toBe(false);
      expect(result.metrics.replyRate).toBe(null);
    });
  });
});
