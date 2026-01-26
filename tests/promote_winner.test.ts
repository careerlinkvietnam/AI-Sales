/**
 * Promote Winner CLI Test Suite
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ExperimentEvaluator,
  ExperimentsRegistry,
  createTestExperimentEvaluator,
} from '../src/domain/ExperimentEvaluator';
import { MetricsStore } from '../src/data/MetricsStore';

describe('Promote Winner', () => {
  const testDir = 'data/test-promote';
  const testExperimentsFile = 'experiments.json';
  const testMetricsFile = 'metrics.ndjson';
  const testExperimentsPath = path.join(testDir, testExperimentsFile);
  const testMetricsPath = path.join(testDir, testMetricsFile);

  let metricsStore: MetricsStore;

  const defaultRegistry: ExperimentsRegistry = {
    experiments: [
      {
        experimentId: 'promote_test_exp',
        name: 'Promotion Test Experiment',
        description: 'For testing promotion',
        startDate: '2026-01-01',
        endDate: null,
        primaryMetric: 'reply_rate',
        minSentPerVariant: 10, // Low threshold for testing
        decisionRule: {
          alpha: 0.05,
          minLift: 0.02,
        },
        templates: [
          { templateId: 'promo_template_A', variant: 'A', status: 'active' },
          { templateId: 'promo_template_B', variant: 'B', status: 'active' },
        ],
      },
    ],
  };

  beforeEach(() => {
    // Ensure test directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Clean up test files
    if (fs.existsSync(testExperimentsPath)) fs.unlinkSync(testExperimentsPath);
    if (fs.existsSync(testMetricsPath)) fs.unlinkSync(testMetricsPath);

    // Write test registry
    fs.writeFileSync(testExperimentsPath, JSON.stringify(defaultRegistry, null, 2));

    // Create metrics store
    metricsStore = new MetricsStore({
      dataDir: testDir,
      metricsFile: testMetricsFile,
      enabled: true,
    });
  });

  afterAll(() => {
    // Clean up all test files
    if (fs.existsSync(testExperimentsPath)) fs.unlinkSync(testExperimentsPath);
    if (fs.existsSync(testMetricsPath)) fs.unlinkSync(testMetricsPath);

    // Clean up backup files
    const files = fs.readdirSync(testDir);
    for (const file of files) {
      if (file.startsWith('experiments.json.bak-')) {
        fs.unlinkSync(path.join(testDir, file));
      }
    }

    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
  });

  describe('integration with MetricsStore', () => {
    it('aggregates metrics correctly for evaluation', () => {
      // Record metrics for variant A (high reply rate)
      for (let i = 0; i < 50; i++) {
        metricsStore.recordSentDetected({
          trackingId: `a-sent-${i}`,
          companyId: `company-${i}`,
          templateId: 'promo_template_A',
          abVariant: 'A',
          gmailThreadId: `thread-a-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 25; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `a-sent-${i}`,
          companyId: `company-${i}`,
          templateId: 'promo_template_A',
          abVariant: 'A',
          gmailThreadId: `thread-a-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      // Record metrics for variant B (low reply rate)
      for (let i = 0; i < 50; i++) {
        metricsStore.recordSentDetected({
          trackingId: `b-sent-${i}`,
          companyId: `company-b-${i}`,
          templateId: 'promo_template_B',
          abVariant: 'B',
          gmailThreadId: `thread-b-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 10; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `b-sent-${i}`,
          companyId: `company-b-${i}`,
          templateId: 'promo_template_B',
          abVariant: 'B',
          gmailThreadId: `thread-b-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      // Aggregate metrics
      const events = metricsStore.readAllEvents();

      let sentA = 0, sentB = 0, replyA = 0, replyB = 0;
      for (const event of events) {
        if (event.templateId === 'promo_template_A') {
          if (event.eventType === 'SENT_DETECTED') sentA++;
          if (event.eventType === 'REPLY_DETECTED') replyA++;
        } else if (event.templateId === 'promo_template_B') {
          if (event.eventType === 'SENT_DETECTED') sentB++;
          if (event.eventType === 'REPLY_DETECTED') replyB++;
        }
      }

      expect(sentA).toBe(50);
      expect(replyA).toBe(25);
      expect(sentB).toBe(50);
      expect(replyB).toBe(10);
    });
  });

  describe('promotion workflow', () => {
    it('promotes winner when there is a clear winner', () => {
      // Record metrics with clear winner (A)
      for (let i = 0; i < 100; i++) {
        metricsStore.recordSentDetected({
          trackingId: `a-${i}`,
          companyId: `company-${i}`,
          templateId: 'promo_template_A',
          abVariant: 'A',
          gmailThreadId: `thread-a-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 50; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `a-${i}`,
          companyId: `company-${i}`,
          templateId: 'promo_template_A',
          abVariant: 'A',
          gmailThreadId: `thread-a-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      for (let i = 0; i < 100; i++) {
        metricsStore.recordSentDetected({
          trackingId: `b-${i}`,
          companyId: `company-b-${i}`,
          templateId: 'promo_template_B',
          abVariant: 'B',
          gmailThreadId: `thread-b-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 20; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `b-${i}`,
          companyId: `company-b-${i}`,
          templateId: 'promo_template_B',
          abVariant: 'B',
          gmailThreadId: `thread-b-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      // Evaluate
      const evaluator = createTestExperimentEvaluator(testExperimentsPath);
      const decision = evaluator.evaluate(
        'promote_test_exp',
        { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 },
        { variant: 'B', sent: 100, replies: 20, replyRate: 0.2 }
      );

      expect(decision.canPromote).toBe(true);
      expect(decision.winnerVariant).toBe('A');

      // Promote
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').split('.')[0];
      const backupPath = path.join(testDir, `experiments.json.bak-${timestamp}`);

      const updatedRegistry = evaluator.promoteWinner('promote_test_exp', 'A');
      evaluator.saveRegistry(updatedRegistry, backupPath);

      // Verify backup was created
      expect(fs.existsSync(backupPath)).toBe(true);

      // Verify registry was updated
      const newEvaluator = createTestExperimentEvaluator(testExperimentsPath);
      const experiment = newEvaluator.getExperiment('promote_test_exp');

      expect(experiment?.templates.find(t => t.variant === 'A')?.status).toBe('active');
      expect(experiment?.templates.find(t => t.variant === 'B')?.status).toBe('archived');
      expect(experiment?.endDate).not.toBeNull();
    });

    it('does not promote when no clear winner', () => {
      // Record metrics with similar rates
      for (let i = 0; i < 100; i++) {
        metricsStore.recordSentDetected({
          trackingId: `a-${i}`,
          companyId: `company-${i}`,
          templateId: 'promo_template_A',
          abVariant: 'A',
          gmailThreadId: `thread-a-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 30; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `a-${i}`,
          companyId: `company-${i}`,
          templateId: 'promo_template_A',
          abVariant: 'A',
          gmailThreadId: `thread-a-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      for (let i = 0; i < 100; i++) {
        metricsStore.recordSentDetected({
          trackingId: `b-${i}`,
          companyId: `company-b-${i}`,
          templateId: 'promo_template_B',
          abVariant: 'B',
          gmailThreadId: `thread-b-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }
      for (let i = 0; i < 31; i++) {
        metricsStore.recordReplyDetected({
          trackingId: `b-${i}`,
          companyId: `company-b-${i}`,
          templateId: 'promo_template_B',
          abVariant: 'B',
          gmailThreadId: `thread-b-${i}`,
          replyDate: '2026-01-16T10:00:00Z',
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      // Evaluate
      const evaluator = createTestExperimentEvaluator(testExperimentsPath);
      const decision = evaluator.evaluate(
        'promote_test_exp',
        { variant: 'A', sent: 100, replies: 30, replyRate: 0.3 },
        { variant: 'B', sent: 100, replies: 31, replyRate: 0.31 }
      );

      expect(decision.canPromote).toBe(false);
      expect(decision.winnerVariant).toBeNull();

      // Verify registry unchanged
      const experiment = evaluator.getExperiment('promote_test_exp');
      expect(experiment?.templates.find(t => t.variant === 'A')?.status).toBe('active');
      expect(experiment?.templates.find(t => t.variant === 'B')?.status).toBe('active');
      expect(experiment?.endDate).toBeNull();
    });

    it('does not promote when insufficient data', () => {
      // Record only a few metrics
      for (let i = 0; i < 5; i++) {
        metricsStore.recordSentDetected({
          trackingId: `a-${i}`,
          companyId: `company-${i}`,
          templateId: 'promo_template_A',
          abVariant: 'A',
          gmailThreadId: `thread-a-${i}`,
          sentDate: '2026-01-15T10:00:00Z',
        });
      }

      const evaluator = createTestExperimentEvaluator(testExperimentsPath);
      const decision = evaluator.evaluate(
        'promote_test_exp',
        { variant: 'A', sent: 5, replies: 3, replyRate: 0.6 },
        { variant: 'B', sent: 5, replies: 1, replyRate: 0.2 }
      );

      expect(decision.canPromote).toBe(false);
      expect(decision.reason).toContain('insufficient_data');
    });
  });

  describe('backup creation', () => {
    it('creates backup with timestamp', () => {
      const evaluator = createTestExperimentEvaluator(testExperimentsPath);
      const timestamp = '20260126120000';
      const backupPath = path.join(testDir, `experiments.json.bak-${timestamp}`);

      const registry = evaluator.loadRegistry();
      evaluator.saveRegistry(registry, backupPath);

      expect(fs.existsSync(backupPath)).toBe(true);

      // Verify backup content matches original
      const backupContent = fs.readFileSync(backupPath, 'utf-8');
      const originalContent = JSON.stringify(defaultRegistry, null, 2);
      expect(backupContent).toBe(originalContent);
    });

    it('preserves original on promotion failure', () => {
      const evaluator = createTestExperimentEvaluator(testExperimentsPath);

      // Try to promote non-existent experiment
      expect(() => evaluator.promoteWinner('nonexistent', 'A')).toThrow();

      // Original should be unchanged
      const experiment = evaluator.getExperiment('promote_test_exp');
      expect(experiment?.templates.find(t => t.variant === 'A')?.status).toBe('active');
      expect(experiment?.templates.find(t => t.variant === 'B')?.status).toBe('active');
    });
  });
});
