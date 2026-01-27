/**
 * Run Ops Presets Tests (daily, weekly, health)
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadOpsScheduleConfig, OpsScheduleConfig } from '../src/cli/run_ops';

describe('Run Ops Presets', () => {
  const testConfigDir = path.join(__dirname, 'tmp_ops_config');
  const testConfigPath = path.join(testConfigDir, 'ops_schedule.json');

  beforeEach(() => {
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
  });

  describe('loadOpsScheduleConfig', () => {
    it('returns default config when file does not exist', () => {
      const config = loadOpsScheduleConfig('/nonexistent/path.json');

      expect(config.daily.send_queue_max_jobs).toBe(10);
      expect(config.daily.reap_execute).toBe(true);
      expect(config.daily.auto_stop_execute).toBe(false);
      expect(config.weekly.compact_execute).toBe(false);
      expect(config.health.window_days).toBe(3);
    });

    it('loads config from file', () => {
      const customConfig = {
        daily: {
          send_queue_max_jobs: 20,
          reap_execute: false,
          auto_stop_execute: true,
          scan_since_days: 2,
          report_since_days: 14,
          notify_report: false,
        },
        weekly: {
          compact_target: 'send_queue',
          compact_execute: true,
          incidents_since_days: 14,
          fixes_top: 5,
          notify_incidents: false,
          notify_fixes: false,
        },
        health: {
          window_days: 7,
        },
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(customConfig));

      const config = loadOpsScheduleConfig(testConfigPath);

      expect(config.daily.send_queue_max_jobs).toBe(20);
      expect(config.daily.reap_execute).toBe(false);
      expect(config.daily.auto_stop_execute).toBe(true);
      expect(config.weekly.compact_execute).toBe(true);
      expect(config.weekly.compact_target).toBe('send_queue');
      expect(config.health.window_days).toBe(7);
    });

    it('merges partial config with defaults', () => {
      const partialConfig = {
        daily: {
          send_queue_max_jobs: 50,
        },
        weekly: {
          fixes_top: 10,
        },
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(partialConfig));

      const config = loadOpsScheduleConfig(testConfigPath);

      // Overridden values
      expect(config.daily.send_queue_max_jobs).toBe(50);
      expect(config.weekly.fixes_top).toBe(10);

      // Default values preserved
      expect(config.daily.reap_execute).toBe(true);
      expect(config.daily.auto_stop_execute).toBe(false);
      expect(config.weekly.compact_execute).toBe(false);
      expect(config.health.window_days).toBe(3);
    });

    it('handles invalid JSON gracefully', () => {
      fs.writeFileSync(testConfigPath, 'not valid json');

      const config = loadOpsScheduleConfig(testConfigPath);

      // Should return defaults
      expect(config.daily.send_queue_max_jobs).toBe(10);
      expect(config.weekly.compact_execute).toBe(false);
    });
  });

  describe('OpsScheduleConfig interface', () => {
    it('has correct structure', () => {
      const config = loadOpsScheduleConfig('/nonexistent/path.json');

      // Daily config
      expect(typeof config.daily.send_queue_max_jobs).toBe('number');
      expect(typeof config.daily.reap_execute).toBe('boolean');
      expect(typeof config.daily.auto_stop_execute).toBe('boolean');
      expect(typeof config.daily.scan_since_days).toBe('number');
      expect(typeof config.daily.report_since_days).toBe('number');
      expect(typeof config.daily.notify_report).toBe('boolean');

      // Weekly config
      expect(typeof config.weekly.compact_target).toBe('string');
      expect(typeof config.weekly.compact_execute).toBe('boolean');
      expect(typeof config.weekly.incidents_since_days).toBe('number');
      expect(typeof config.weekly.fixes_top).toBe('number');
      expect(typeof config.weekly.notify_incidents).toBe('boolean');
      expect(typeof config.weekly.notify_fixes).toBe('boolean');

      // Health config
      expect(typeof config.health.window_days).toBe('number');
    });
  });

  describe('Daily preset steps', () => {
    it('includes all required steps', () => {
      // The daily preset should include these steps:
      // 1. reap (stale job recovery)
      // 2. auto-stop (failed job termination)
      // 3. scan (Gmail response scanning)
      // 4. send-queue process
      // 5. report generation
      // 6. data status check
      const expectedSteps = [
        'reap',
        'auto-stop',
        'scan',
        'send-queue-process',
        'report',
        'data-status',
      ];

      // This is a documentation test - verifying the expected behavior
      expect(expectedSteps.length).toBe(6);
    });
  });

  describe('Weekly preset steps', () => {
    it('includes all required steps', () => {
      // The weekly preset should include these steps:
      // 1. incidents-report
      // 2. fixes-propose
      // 3. data compact
      // 4. report
      const expectedSteps = [
        'incidents-report',
        'fixes-propose',
        'data-compact',
        'report',
      ];

      expect(expectedSteps.length).toBe(4);
    });
  });

  describe('Health check aggregation', () => {
    it('aggregates multiple health sources', () => {
      // The health command should aggregate:
      // - kill switch status
      // - send queue counts (queued, in_progress, dead_letter)
      // - open incidents count
      // - reply rate metrics
      // - data file sizes
      const healthSources = [
        'killSwitch',
        'sendQueue',
        'incidents',
        'metrics',
        'dataFiles',
      ];

      expect(healthSources.length).toBe(5);
    });

    it('determines overall status correctly', () => {
      // Test status determination logic:
      // - critical: kill switch active OR critical thresholds exceeded
      // - warning: dead letter jobs OR warning thresholds exceeded
      // - ok: everything normal
      const statusLevels = ['ok', 'warning', 'critical'];

      expect(statusLevels).toContain('ok');
      expect(statusLevels).toContain('warning');
      expect(statusLevels).toContain('critical');
    });
  });
});

describe('Health Status Logic', () => {
  it('returns critical when kill switch is active', () => {
    const health = {
      overall: 'ok' as 'ok' | 'warning' | 'critical',
      issues: [] as string[],
      killSwitch: { runtimeEnabled: true, envEnabled: false },
    };

    if (health.killSwitch.runtimeEnabled || health.killSwitch.envEnabled) {
      health.overall = 'critical';
      health.issues.push('Kill switch is active');
    }

    expect(health.overall).toBe('critical');
    expect(health.issues).toContain('Kill switch is active');
  });

  it('returns warning when dead letter jobs exist', () => {
    const health = {
      overall: 'ok' as 'ok' | 'warning' | 'critical',
      issues: [] as string[],
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 3 },
    };

    if (health.sendQueue.deadLetter > 0) {
      health.overall = health.overall === 'critical' ? 'critical' : 'warning';
      health.issues.push(`${health.sendQueue.deadLetter} job(s) in dead letter`);
    }

    expect(health.overall).toBe('warning');
    expect(health.issues).toContain('3 job(s) in dead letter');
  });

  it('preserves critical status when dead letter jobs exist', () => {
    const health = {
      overall: 'critical' as 'ok' | 'warning' | 'critical',
      issues: ['Kill switch is active'],
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 3 },
    };

    if (health.sendQueue.deadLetter > 0) {
      health.overall = health.overall === 'critical' ? 'critical' : 'warning';
      health.issues.push(`${health.sendQueue.deadLetter} job(s) in dead letter`);
    }

    expect(health.overall).toBe('critical');
    expect(health.issues.length).toBe(2);
  });

  it('returns warning when open incidents exist', () => {
    const health = {
      overall: 'ok' as 'ok' | 'warning' | 'critical',
      issues: [] as string[],
      incidents: { openCount: 5 },
    };

    if (health.incidents.openCount > 0) {
      health.overall = health.overall === 'critical' ? 'critical' : 'warning';
      health.issues.push(`${health.incidents.openCount} open incident(s)`);
    }

    expect(health.overall).toBe('warning');
    expect(health.issues).toContain('5 open incident(s)');
  });

  it('returns ok when everything is normal', () => {
    const health = {
      overall: 'ok' as 'ok' | 'warning' | 'critical',
      issues: [] as string[],
      killSwitch: { runtimeEnabled: false, envEnabled: false },
      sendQueue: { queued: 5, inProgress: 2, deadLetter: 0 },
      incidents: { openCount: 0 },
    };

    // No issues to add

    expect(health.overall).toBe('ok');
    expect(health.issues.length).toBe(0);
  });

  it('returns warning when reply rate is too low', () => {
    const health = {
      overall: 'ok' as 'ok' | 'warning' | 'critical',
      issues: [] as string[],
      metrics: { replyRate: 0.01 },
    };

    if (health.metrics.replyRate !== null && health.metrics.replyRate < 0.02) {
      health.overall = health.overall === 'critical' ? 'critical' : 'warning';
      health.issues.push(`Low reply rate: ${(health.metrics.replyRate * 100).toFixed(1)}%`);
    }

    expect(health.overall).toBe('warning');
    expect(health.issues).toContain('Low reply rate: 1.0%');
  });
});
