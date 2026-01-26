/**
 * RampPolicy Tests
 *
 * Tests for gradual rollout policy (daily_cap and percentage modes).
 */

import { RampPolicy, resetRampPolicy } from '../src/domain/RampPolicy';

// Helper to create test policy with specific date
function createPolicyWithDate(date: string, config: Partial<{
  enabled: boolean;
  mode: 'daily_cap' | 'percentage';
  daily_cap_schedule: { date: string; cap: number }[];
  percentage: number;
  min_sent_before_increase: number;
}>): RampPolicy {
  return new RampPolicy({
    config,
    now: new Date(`${date}T12:00:00Z`),
  });
}

describe('RampPolicy', () => {
  afterEach(() => {
    resetRampPolicy();
  });

  describe('daily_cap mode', () => {
    it('should allow sending when under daily cap', () => {
      const today = '2026-01-26';
      const policy = createPolicyWithDate(today, {
        enabled: true,
        mode: 'daily_cap',
        daily_cap_schedule: [
          { date: today, cap: 5 },
        ],
      });

      const result = policy.canAutoSendToday(3);
      expect(result.ok).toBe(true);
    });

    it('should block sending when at daily cap', () => {
      const today = '2026-01-26';
      const policy = createPolicyWithDate(today, {
        enabled: true,
        mode: 'daily_cap',
        daily_cap_schedule: [
          { date: today, cap: 5 },
        ],
      });

      const result = policy.canAutoSendToday(5);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('cap');
    });

    it('should block sending when over daily cap', () => {
      const today = '2026-01-26';
      const policy = createPolicyWithDate(today, {
        enabled: true,
        mode: 'daily_cap',
        daily_cap_schedule: [
          { date: today, cap: 5 },
        ],
      });

      const result = policy.canAutoSendToday(10);
      expect(result.ok).toBe(false);
    });

    it('should use most recent past date when today not in schedule', () => {
      const today = '2026-01-30';
      const policy = createPolicyWithDate(today, {
        enabled: true,
        mode: 'daily_cap',
        daily_cap_schedule: [
          { date: '2026-01-26', cap: 1 },
          { date: '2026-01-27', cap: 3 },
          { date: '2026-01-28', cap: 5 },
        ],
      });

      // Jan 30 is past the schedule, so should use Jan 28's cap (5)
      const result = policy.canAutoSendToday(4);
      expect(result.ok).toBe(true);

      const result2 = policy.canAutoSendToday(5);
      expect(result2.ok).toBe(false);
    });

    it('should block if schedule has not started yet', () => {
      const today = '2026-01-20';
      const policy = createPolicyWithDate(today, {
        enabled: true,
        mode: 'daily_cap',
        daily_cap_schedule: [
          { date: '2026-01-26', cap: 5 },
        ],
      });

      // Jan 20 is before schedule starts
      const result = policy.canAutoSendToday(0);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('No daily cap schedule');
    });

    it('should return correct todayCap', () => {
      const today = '2026-01-27';
      const policy = createPolicyWithDate(today, {
        enabled: true,
        mode: 'daily_cap',
        daily_cap_schedule: [
          { date: '2026-01-26', cap: 1 },
          { date: '2026-01-27', cap: 3 },
          { date: '2026-01-28', cap: 5 },
        ],
      });

      const cap = policy.getTodayCap();
      expect(cap).toBe(3);
    });
  });

  describe('percentage mode', () => {
    it('should allow if not enabled', () => {
      const policy = createPolicyWithDate('2026-01-26', {
        enabled: false,
        mode: 'percentage',
        percentage: 0.1,
      });

      // When disabled, canAutoSendToday returns false (not ok)
      const result = policy.canAutoSendToday(100);
      expect(result.ok).toBe(false);
    });

    it('should provide stable assignment for same company_id', () => {
      const policy = createPolicyWithDate('2026-01-26', {
        enabled: true,
        mode: 'percentage',
        percentage: 0.5, // 50%
      });

      const companyId = 'test-company-123';
      const result1 = policy.shouldAutoSendForCompany(companyId);
      const result2 = policy.shouldAutoSendForCompany(companyId);
      const result3 = policy.shouldAutoSendForCompany(companyId);

      // Same company should always get same result
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should distribute companies roughly according to percentage', () => {
      const policy = createPolicyWithDate('2026-01-26', {
        enabled: true,
        mode: 'percentage',
        percentage: 0.2, // 20%
      });

      // Test with 100 companies
      let inGroup = 0;
      for (let i = 0; i < 100; i++) {
        if (policy.shouldAutoSendForCompany(`company-${i}`)) {
          inGroup++;
        }
      }

      // Should be roughly 20% (allow some variance due to hash distribution)
      expect(inGroup).toBeGreaterThan(5);  // At least 5%
      expect(inGroup).toBeLessThan(40);    // Less than 40%
    });

    it('should include all companies at 100%', () => {
      const policy = createPolicyWithDate('2026-01-26', {
        enabled: true,
        mode: 'percentage',
        percentage: 1.0,
      });

      for (let i = 0; i < 20; i++) {
        expect(policy.shouldAutoSendForCompany(`company-${i}`)).toBe(true);
      }
    });

    it('should exclude all companies at 0%', () => {
      const policy = createPolicyWithDate('2026-01-26', {
        enabled: true,
        mode: 'percentage',
        percentage: 0.0,
      });

      for (let i = 0; i < 20; i++) {
        expect(policy.shouldAutoSendForCompany(`company-${i}`)).toBe(false);
      }
    });
  });

  describe('disabled mode', () => {
    it('should return not ok when disabled', () => {
      const policy = createPolicyWithDate('2026-01-26', {
        enabled: false,
        mode: 'daily_cap',
        daily_cap_schedule: [
          { date: '2026-01-26', cap: 1 },
        ],
      });

      const result = policy.canAutoSendToday(0);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  describe('getters', () => {
    it('should return correct config values', () => {
      const policy = createPolicyWithDate('2026-01-26', {
        enabled: true,
        mode: 'percentage',
        percentage: 0.25,
        min_sent_before_increase: 100,
      });

      expect(policy.isEnabled()).toBe(true);
      expect(policy.getMode()).toBe('percentage');
      expect(policy.getPercentage()).toBe(0.25);
    });
  });
});
