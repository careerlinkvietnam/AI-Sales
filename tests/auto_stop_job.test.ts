/**
 * AutoStopJob Tests
 *
 * Tests for the auto-stop job that evaluates metrics and triggers kill switch.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runAutoStopJob, aggregateMetrics } from '../src/jobs/AutoStopJob';
import { resetAutoStopPolicy } from '../src/domain/AutoStopPolicy';
import { resetRuntimeKillSwitch, getRuntimeKillSwitch } from '../src/domain/RuntimeKillSwitch';
import { resetMetricsStore, getMetricsStore } from '../src/data/MetricsStore';
import { MetricsEvent } from '../src/data/MetricsStore';

describe('AutoStopJob', () => {
  const dataDir = 'data';
  const metricsPath = path.join(dataDir, 'metrics.ndjson');
  const killSwitchPath = path.join(dataDir, 'kill_switch.json');

  let originalMetricsContent: string | null = null;

  beforeEach(() => {
    // Reset singletons
    resetAutoStopPolicy();
    resetRuntimeKillSwitch();
    resetMetricsStore();

    // Backup existing metrics file if it exists
    if (fs.existsSync(metricsPath)) {
      originalMetricsContent = fs.readFileSync(metricsPath, 'utf-8');
    }

    // Clear kill switch file if it exists
    if (fs.existsSync(killSwitchPath)) {
      fs.unlinkSync(killSwitchPath);
    }

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Reset singletons
    resetAutoStopPolicy();
    resetRuntimeKillSwitch();
    resetMetricsStore();

    // Restore original metrics file
    if (originalMetricsContent !== null) {
      fs.writeFileSync(metricsPath, originalMetricsContent);
    }

    // Clear kill switch file if it exists
    if (fs.existsSync(killSwitchPath)) {
      fs.unlinkSync(killSwitchPath);
    }
  });

  function writeMetricsEvents(events: object[]): void {
    const content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(metricsPath, content);
  }

  describe('aggregateMetrics', () => {
    it('should correctly aggregate events by type', () => {
      const now = new Date();
      const today = now.toISOString().split('T')[0];

      const events: Partial<MetricsEvent>[] = [
        {
          timestamp: `${today}T10:00:00Z`,
          eventType: 'AUTO_SEND_ATTEMPT',
          trackingId: 'test-1',
          companyId: 'company-1',
          templateId: 'template-1',
          abVariant: 'A',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: `${today}T10:00:00Z`,
          eventType: 'AUTO_SEND_SUCCESS',
          trackingId: 'test-1',
          companyId: 'company-1',
          templateId: 'template-1',
          abVariant: 'A',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: `${today}T11:00:00Z`,
          eventType: 'AUTO_SEND_ATTEMPT',
          trackingId: 'test-2',
          companyId: 'company-2',
          templateId: 'template-1',
          abVariant: 'A',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: `${today}T11:00:00Z`,
          eventType: 'AUTO_SEND_BLOCKED',
          trackingId: 'test-2',
          companyId: 'company-2',
          templateId: 'template-1',
          abVariant: 'A',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: `${today}T15:00:00Z`,
          eventType: 'REPLY_DETECTED',
          trackingId: 'test-1',
          companyId: 'company-1',
          templateId: 'template-1',
          abVariant: 'A',
          gmailThreadId: 'thread-1',
          replyLatencyHours: 5,
          meta: {},
        },
      ];

      const result = aggregateMetrics(events as MetricsEvent[], 3, now);

      expect(result.totalAttempts).toBe(2);
      expect(result.totalSuccess).toBe(1);
      expect(result.totalBlocked).toBe(1);
      expect(result.totalReplies).toBe(1);
    });
  });

  describe('dry run mode', () => {
    it('should not activate kill switch in dry run', () => {
      // Create metrics that would trigger stop
      const today = new Date().toISOString().split('T')[0];
      const events = [];
      for (let i = 0; i < 50; i++) {
        events.push({
          timestamp: `${today}T12:00:00Z`,
          trackingId: `test-${i}`,
          companyId: `company-${i}`,
          templateId: 'template-1',
          abVariant: 'A',
          eventType: 'AUTO_SEND_SUCCESS',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        });
        events.push({
          timestamp: `${today}T12:00:00Z`,
          trackingId: `test-${i}`,
          companyId: `company-${i}`,
          templateId: 'template-1',
          abVariant: 'A',
          eventType: 'AUTO_SEND_ATTEMPT',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        });
      }
      // No replies - 0% reply rate
      writeMetricsEvents(events);

      const result = runAutoStopJob({ dryRun: true });

      expect(result.executed).toBe(true);
      expect(result.stopped).toBe(false); // Dry run - no action

      // Kill switch should not be enabled
      const killSwitch = getRuntimeKillSwitch();
      expect(killSwitch.isEnabled()).toBe(false);
    });
  });

  describe('already stopped', () => {
    it('should do nothing if already stopped', () => {
      // Enable kill switch first
      const killSwitch = getRuntimeKillSwitch();
      killSwitch.setEnabled('Previous stop', 'test');

      const result = runAutoStopJob({ dryRun: false });

      expect(result.executed).toBe(true);
      expect(result.already_stopped).toBe(true);
      expect(result.stopped).toBe(false);
    });
  });

  describe('insufficient data', () => {
    it('should not stop with insufficient sends', () => {
      // Create metrics with only a few sends (below threshold)
      const today = new Date().toISOString().split('T')[0];
      const events = [];
      for (let i = 0; i < 5; i++) {
        events.push({
          timestamp: `${today}T12:00:00Z`,
          trackingId: `test-${i}`,
          companyId: `company-${i}`,
          templateId: 'template-1',
          abVariant: 'A',
          eventType: 'AUTO_SEND_SUCCESS',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        });
        events.push({
          timestamp: `${today}T12:00:00Z`,
          trackingId: `test-${i}`,
          companyId: `company-${i}`,
          templateId: 'template-1',
          abVariant: 'A',
          eventType: 'AUTO_SEND_ATTEMPT',
          gmailThreadId: null,
          replyLatencyHours: null,
          meta: {},
        });
      }
      writeMetricsEvents(events);

      const result = runAutoStopJob({ dryRun: false });

      expect(result.executed).toBe(true);
      expect(result.should_stop).toBe(false);
      expect(result.stopped).toBe(false);
      expect(result.reasons[0]).toContain('Insufficient data');
    });
  });
});
