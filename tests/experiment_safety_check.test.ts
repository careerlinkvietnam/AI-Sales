/**
 * ExperimentSafetyCheck Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ExperimentSafetyCheck,
  createExperimentSafetyCheck,
} from '../src/jobs/ExperimentSafetyCheck';
import { ExperimentsRegistry } from '../src/domain/ExperimentEvaluator';
import { MetricsEvent, resetMetricsStore } from '../src/data/MetricsStore';

describe('ExperimentSafetyCheck', () => {
  const testDir = path.join(__dirname, 'tmp_safety_test');
  const experimentsPath = path.join(testDir, 'experiments.json');
  const metricsPath = path.join(testDir, 'metrics.ndjson');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Set environment variable for metrics store
    process.env.METRICS_STORE_PATH = metricsPath;
    // Reset the singleton to use the new path
    resetMetricsStore();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    delete process.env.METRICS_STORE_PATH;
    resetMetricsStore();
  });

  function writeRegistry(registry: ExperimentsRegistry): void {
    fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));
  }

  function writeMetrics(events: MetricsEvent[]): void {
    const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(metricsPath, content);
  }

  describe('check - rollback_recommended', () => {
    it('should recommend rollback when reply rate is below threshold', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Test Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            rollbackRule: {
              maxDaysNoReply: 7,
              minSentTotal: 100,
              minReplyRate: 0.05, // 5%
            },
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      // Create metrics: 150 sent, 3 replies = 2% reply rate (below 5%)
      const events: MetricsEvent[] = [];
      for (let i = 0; i < 150; i++) {
        events.push({
          timestamp: '2026-01-20T10:00:00.000Z',
          eventType: 'SENT_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: null,
          meta: {},
        });
      }
      for (let i = 0; i < 3; i++) {
        events.push({
          timestamp: '2026-01-21T10:00:00.000Z',
          eventType: 'REPLY_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: 24,
          meta: {},
        });
      }
      writeMetrics(events);

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const result = safetyCheck.check('exp1');

      expect(result.action).toBe('rollback_recommended');
      expect(result.reasons.some((r) => r.includes('低返信率'))).toBe(true);
    });

    it('should recommend rollback when no replies for too long', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 14); // 14 days ago

      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Test Experiment',
            startDate: startDate.toISOString().split('T')[0],
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            rollbackRule: {
              maxDaysNoReply: 7,
              minSentTotal: 100,
              minReplyRate: 0.02,
            },
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      // Create metrics: 100 sent, 0 replies
      const events: MetricsEvent[] = [];
      for (let i = 0; i < 100; i++) {
        events.push({
          timestamp: startDate.toISOString(),
          eventType: 'SENT_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: null,
          meta: {},
        });
      }
      writeMetrics(events);

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const result = safetyCheck.check('exp1');

      expect(result.action).toBe('rollback_recommended');
      expect(result.reasons.some((r) => r.includes('長期間返信なし'))).toBe(true);
    });
  });

  describe('check - freeze_recommended', () => {
    it('should recommend freeze when sample size is too low after days', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 10); // 10 days ago

      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Test Experiment',
            startDate: startDate.toISOString().split('T')[0],
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            freezeOnLowN: true,
            rollbackRule: {
              maxDaysNoReply: 7,
              minSentTotal: 100,
              minReplyRate: 0.02,
            },
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      // Create metrics: only 30 sent (below 100 threshold) after 10 days
      const events: MetricsEvent[] = [];
      for (let i = 0; i < 30; i++) {
        events.push({
          timestamp: startDate.toISOString(),
          eventType: 'SENT_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: null,
          meta: {},
        });
      }
      // Add some replies to avoid rollback recommendation
      for (let i = 0; i < 3; i++) {
        events.push({
          timestamp: new Date().toISOString(),
          eventType: 'REPLY_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: 24,
          meta: {},
        });
      }
      writeMetrics(events);

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const result = safetyCheck.check('exp1');

      expect(result.action).toBe('freeze_recommended');
      expect(result.reasons.some((r) => r.includes('低サンプル'))).toBe(true);
    });

    it('should not recommend freeze when freezeOnLowN is false', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 10);

      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Test Experiment',
            startDate: startDate.toISOString().split('T')[0],
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            freezeOnLowN: false,
            rollbackRule: {
              maxDaysNoReply: 7,
              minSentTotal: 100,
              minReplyRate: 0.02,
            },
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      // Low sample but freezeOnLowN is false
      const events: MetricsEvent[] = [];
      for (let i = 0; i < 30; i++) {
        events.push({
          timestamp: startDate.toISOString(),
          eventType: 'SENT_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: null,
          meta: {},
        });
      }
      // Add recent reply to avoid rollback
      events.push({
        timestamp: new Date().toISOString(),
        eventType: 'REPLY_DETECTED',
        trackingId: 'track0',
        companyId: 'company0',
        templateId: 'tmpl_A',
        abVariant: 'A',
        gmailThreadId: 'thread0',
        replyLatencyHours: 24,
        meta: {},
      });
      writeMetrics(events);

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const result = safetyCheck.check('exp1');

      expect(result.action).toBe('ok');
    });
  });

  describe('check - ok', () => {
    it('should return ok when experiment is healthy', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Test Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            rollbackRule: {
              maxDaysNoReply: 7,
              minSentTotal: 100,
              minReplyRate: 0.02,
            },
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      // Create healthy metrics: 150 sent, 15 replies = 10% reply rate
      const events: MetricsEvent[] = [];
      for (let i = 0; i < 150; i++) {
        events.push({
          timestamp: '2026-01-20T10:00:00.000Z',
          eventType: 'SENT_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: null,
          meta: {},
        });
      }
      for (let i = 0; i < 15; i++) {
        events.push({
          timestamp: new Date().toISOString(), // Recent reply
          eventType: 'REPLY_DETECTED',
          trackingId: `track${i}`,
          companyId: `company${i}`,
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: `thread${i}`,
          replyLatencyHours: 24,
          meta: {},
        });
      }
      writeMetrics(events);

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const result = safetyCheck.check('exp1');

      expect(result.action).toBe('ok');
      expect(result.reasons).toContain('No issues detected');
    });
  });

  describe('check - metrics calculation', () => {
    it('should calculate metrics correctly', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Test',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const events: MetricsEvent[] = [
        {
          timestamp: '2026-01-20T10:00:00.000Z',
          eventType: 'SENT_DETECTED',
          trackingId: 'track1',
          companyId: 'company1',
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: 'thread1',
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: '2026-01-20T11:00:00.000Z',
          eventType: 'SENT_DETECTED',
          trackingId: 'track2',
          companyId: 'company2',
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: 'thread2',
          replyLatencyHours: null,
          meta: {},
        },
        {
          timestamp: '2026-01-21T10:00:00.000Z',
          eventType: 'REPLY_DETECTED',
          trackingId: 'track1',
          companyId: 'company1',
          templateId: 'tmpl_A',
          abVariant: 'A',
          gmailThreadId: 'thread1',
          replyLatencyHours: 24,
          meta: {},
        },
      ];
      writeMetrics(events);

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const result = safetyCheck.check('exp1');

      expect(result.metrics.totalSent).toBe(2);
      expect(result.metrics.totalReplies).toBe(1);
      expect(result.metrics.replyRate).toBe(0.5);
    });
  });

  describe('checkAll', () => {
    it('should check all running experiments', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'running_exp',
            name: 'Running',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
          {
            experimentId: 'paused_exp',
            name: 'Paused',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'paused',
            templates: [
              { templateId: 'tmpl_B', variant: 'B', status: 'active' },
            ],
          },
        ],
      });

      writeMetrics([]);

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const results = safetyCheck.checkAll();

      // Only running experiment should be checked
      expect(results).toHaveLength(1);
      expect(results[0].experimentId).toBe('running_exp');
    });
  });

  describe('factory function', () => {
    it('createExperimentSafetyCheck creates new instance', () => {
      writeRegistry({ experiments: [] });
      const check = createExperimentSafetyCheck({ experimentsPath });
      expect(check).toBeInstanceOf(ExperimentSafetyCheck);
    });
  });
});
