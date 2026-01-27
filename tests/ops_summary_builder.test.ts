/**
 * OpsSummaryBuilder Tests
 */

import {
  OpsSummaryBuilder,
  HealthInput,
  StepResult,
  OpsSummary,
  getOpsSummaryBuilder,
  resetOpsSummaryBuilder,
} from '../src/domain/OpsSummaryBuilder';

describe('OpsSummaryBuilder', () => {
  let builder: OpsSummaryBuilder;

  beforeEach(() => {
    resetOpsSummaryBuilder();
    builder = new OpsSummaryBuilder();
  });

  describe('severity determination', () => {
    const baseHealth: HealthInput = {
      killSwitch: { runtimeEnabled: false, envEnabled: false },
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 0, sent: 100 },
      incidents: { openCount: 0 },
      metrics: {
        windowDays: 3,
        totalSent: 100,
        totalReplies: 10,
        replyRate: 0.10,
        totalBlocked: 5,
      },
      data: {
        send_queue: { exists: true, lines: 100, sizeBytes: 10240, sizeFormatted: '10 KB' },
      },
    };

    it('returns error when kill switch is active (runtime)', () => {
      const health: HealthInput = {
        ...baseHealth,
        killSwitch: { runtimeEnabled: true, envEnabled: false },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('error');
      expect(summary.highlights.some(h => h.includes('Kill Switch') && h.includes('ACTIVE'))).toBe(true);
    });

    it('returns error when kill switch is active (env)', () => {
      const health: HealthInput = {
        ...baseHealth,
        killSwitch: { runtimeEnabled: false, envEnabled: true },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('error');
    });

    it('returns error when auto-stop was executed', () => {
      const steps: StepResult[] = [
        { name: 'auto_stop', result: { stopped: true, reason: 'Low reply rate' } },
      ];

      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth, steps });

      expect(summary.severity).toBe('error');
    });

    it('returns error when dead_letter > 0', () => {
      const health: HealthInput = {
        ...baseHealth,
        sendQueue: { ...baseHealth.sendQueue, deadLetter: 3 },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('error');
    });

    it('returns error when open incidents > 0', () => {
      const health: HealthInput = {
        ...baseHealth,
        incidents: { openCount: 2, openIds: ['inc-1', 'inc-2'] },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('error');
    });

    it('returns warn when queued count is high', () => {
      const health: HealthInput = {
        ...baseHealth,
        sendQueue: { ...baseHealth.sendQueue, queued: 100 },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('warn');
    });

    it('returns warn when blocked ratio is high', () => {
      const health: HealthInput = {
        ...baseHealth,
        metrics: {
          ...baseHealth.metrics,
          totalSent: 50,
          totalBlocked: 50, // 50% blocked
        },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('warn');
    });

    it('returns warn when reply rate is low', () => {
      const health: HealthInput = {
        ...baseHealth,
        metrics: {
          ...baseHealth.metrics,
          replyRate: 0.01, // 1%
        },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('warn');
    });

    it('returns warn when reaper fired', () => {
      const steps: StepResult[] = [
        { name: 'reap', result: { staleJobsFound: 3, requeued: 2, deadLettered: 1 } },
      ];

      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth, steps });

      expect(summary.severity).toBe('warn');
    });

    it('returns warn when data files are large', () => {
      const health: HealthInput = {
        ...baseHealth,
        data: {
          send_queue: { exists: true, lines: 100000, sizeBytes: 60 * 1024 * 1024, sizeFormatted: '60 MB' },
        },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.severity).toBe('warn');
    });

    it('returns warn when steps fail', () => {
      const steps: StepResult[] = [
        { name: 'scan', success: false, error: 'Gmail API error' },
      ];

      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth, steps });

      expect(summary.severity).toBe('warn');
    });

    it('returns info when everything is normal', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });

      expect(summary.severity).toBe('info');
    });
  });

  describe('highlights', () => {
    const baseHealth: HealthInput = {
      killSwitch: { runtimeEnabled: false, envEnabled: false },
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 0, sent: 100 },
      incidents: { openCount: 0 },
      metrics: {
        windowDays: 3,
        totalSent: 100,
        totalReplies: 10,
        replyRate: 0.10,
        totalBlocked: 5,
      },
      data: {
        send_queue: { exists: true, lines: 100, sizeBytes: 10240, sizeFormatted: '10 KB' },
      },
    };

    it('limits highlights to 6 items', () => {
      const health: HealthInput = {
        ...baseHealth,
        killSwitch: { runtimeEnabled: true, envEnabled: true, reason: 'Test reason' },
        sendQueue: { queued: 100, inProgress: 10, deadLetter: 5, sent: 200 },
        incidents: { openCount: 3, openIds: ['inc-1', 'inc-2', 'inc-3'] },
        data: {
          send_queue: { exists: true, lines: 100000, sizeBytes: 60 * 1024 * 1024, sizeFormatted: '60 MB' },
          metrics: { exists: true, lines: 50000, sizeBytes: 55 * 1024 * 1024, sizeFormatted: '55 MB' },
        },
      };
      const steps: StepResult[] = [
        { name: 'scan', success: false, error: 'Gmail API error' },
        { name: 'reap', result: { staleJobsFound: 3, requeued: 2, deadLettered: 1 } },
      ];

      const summary = builder.build({ opType: 'daily', mode: 'execute', health, steps });

      expect(summary.highlights.length).toBeLessThanOrEqual(6);
    });

    it('includes queue status', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });

      expect(summary.highlights.some(h => h.includes('Queue') && h.includes('5 queued') && h.includes('2 in_progress'))).toBe(true);
    });

    it('includes metrics when available', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });

      expect(summary.highlights.some(h => h.includes('Metrics') && h.includes('100 sent') && h.includes('10 replies'))).toBe(true);
    });

    it('includes blocked count when > 0', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });

      expect(summary.highlights.some(h => h.includes('Blocked') && h.includes('5'))).toBe(true);
    });

    it('includes incidents when > 0', () => {
      const health: HealthInput = {
        ...baseHealth,
        incidents: { openCount: 2, openIds: ['inc-1', 'inc-2'] },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.highlights.some(h => h.includes('Incidents') && h.includes('2 open'))).toBe(true);
    });

    it('includes reaper results from steps', () => {
      const steps: StepResult[] = [
        { name: 'reap', result: { staleJobsFound: 3, requeued: 2, deadLettered: 1 } },
      ];

      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth, steps });

      expect(summary.highlights.some(h => h.includes('Reaper') && h.includes('3 stale found'))).toBe(true);
    });

    it('includes failed steps', () => {
      const steps: StepResult[] = [
        { name: 'scan', success: false, error: 'Gmail API error' },
      ];

      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth, steps });

      expect(summary.highlights.some(h => h.includes('Failed steps') && h.includes('scan'))).toBe(true);
    });
  });

  describe('actions', () => {
    const baseHealth: HealthInput = {
      killSwitch: { runtimeEnabled: false, envEnabled: false },
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 0, sent: 100 },
      incidents: { openCount: 0 },
      metrics: {
        windowDays: 3,
        totalSent: 100,
        totalReplies: 10,
        replyRate: 0.10,
        totalBlocked: 5,
      },
      data: {
        send_queue: { exists: true, lines: 100, sizeBytes: 10240, sizeFormatted: '10 KB' },
      },
    };

    it('limits actions to 3 items', () => {
      const health: HealthInput = {
        ...baseHealth,
        killSwitch: { runtimeEnabled: true, envEnabled: false },
        sendQueue: { ...baseHealth.sendQueue, deadLetter: 3, queued: 100 },
        incidents: { openCount: 2 },
        data: {
          send_queue: { exists: true, lines: 100000, sizeBytes: 60 * 1024 * 1024, sizeFormatted: '60 MB' },
        },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.actions.length).toBeLessThanOrEqual(3);
    });

    it('returns "No action required" for info severity', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });

      expect(summary.actions).toContain('No action required');
    });

    it('suggests reviewing kill switch when active', () => {
      const health: HealthInput = {
        ...baseHealth,
        killSwitch: { runtimeEnabled: true, envEnabled: false },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.actions.some(a => a.includes('stop-status'))).toBe(true);
    });

    it('suggests reviewing dead letter jobs', () => {
      const health: HealthInput = {
        ...baseHealth,
        sendQueue: { ...baseHealth.sendQueue, deadLetter: 3 },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.actions.some(a => a.includes('send-queue'))).toBe(true);
    });

    it('suggests reviewing incidents', () => {
      const health: HealthInput = {
        ...baseHealth,
        incidents: { openCount: 2 },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.actions.some(a => a.includes('incidents'))).toBe(true);
    });

    it('suggests data compaction for large files', () => {
      const health: HealthInput = {
        ...baseHealth,
        data: {
          send_queue: { exists: true, lines: 100000, sizeBytes: 60 * 1024 * 1024, sizeFormatted: '60 MB' },
        },
      };

      const summary = builder.build({ opType: 'daily', mode: 'execute', health });

      expect(summary.actions.some(a => a.includes('compact'))).toBe(true);
    });
  });

  describe('title', () => {
    const baseHealth: HealthInput = {
      killSwitch: { runtimeEnabled: false, envEnabled: false },
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 0, sent: 100 },
      incidents: { openCount: 0 },
      metrics: { windowDays: 3, totalSent: 100, totalReplies: 10, replyRate: 0.10, totalBlocked: 5 },
      data: { send_queue: { exists: true, lines: 100, sizeBytes: 10240, sizeFormatted: '10 KB' } },
    };

    it('includes operation type', () => {
      const dailySummary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });
      const weeklySummary = builder.build({ opType: 'weekly', mode: 'execute', health: baseHealth });
      const healthSummary = builder.build({ opType: 'health', mode: 'execute', health: baseHealth });

      expect(dailySummary.title).toContain('Daily');
      expect(weeklySummary.title).toContain('Weekly');
      expect(healthSummary.title).toContain('Health');
    });

    it('includes severity indicator', () => {
      const infoSummary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });

      const errorHealth: HealthInput = { ...baseHealth, killSwitch: { runtimeEnabled: true, envEnabled: false } };
      const errorSummary = builder.build({ opType: 'daily', mode: 'execute', health: errorHealth });

      expect(infoSummary.title).toContain('[OK]');
      expect(errorSummary.title).toContain('[ERROR]');
    });

    it('includes dry-run indicator', () => {
      const dryRunSummary = builder.build({ opType: 'daily', mode: 'dry-run', health: baseHealth });
      const executeSummary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });

      expect(dryRunSummary.title).toContain('dry-run');
      expect(executeSummary.title).not.toContain('dry-run');
    });
  });

  describe('formatAsText', () => {
    const baseHealth: HealthInput = {
      killSwitch: { runtimeEnabled: false, envEnabled: false },
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 0, sent: 100 },
      incidents: { openCount: 0 },
      metrics: { windowDays: 3, totalSent: 100, totalReplies: 10, replyRate: 0.10, totalBlocked: 5 },
      data: { send_queue: { exists: true, lines: 100, sizeBytes: 10240, sizeFormatted: '10 KB' } },
    };

    it('includes title', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });
      const text = builder.formatAsText(summary);

      expect(text).toContain('AI-Sales Daily Summary');
    });

    it('includes highlights', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });
      const text = builder.formatAsText(summary);

      expect(text).toContain('Queue:');
    });

    it('includes actions', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });
      const text = builder.formatAsText(summary);

      expect(text).toContain('Next actions:');
    });

    it('includes timestamp', () => {
      const summary = builder.build({ opType: 'daily', mode: 'execute', health: baseHealth });
      const text = builder.formatAsText(summary);

      expect(text).toContain('Time:');
    });
  });

  describe('getOpsSummaryBuilder', () => {
    it('returns singleton instance', () => {
      const builder1 = getOpsSummaryBuilder();
      const builder2 = getOpsSummaryBuilder();

      expect(builder1).toBe(builder2);
    });

    it('resets singleton', () => {
      const builder1 = getOpsSummaryBuilder();
      resetOpsSummaryBuilder();
      const builder2 = getOpsSummaryBuilder();

      expect(builder1).not.toBe(builder2);
    });
  });
});
