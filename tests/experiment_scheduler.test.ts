/**
 * ExperimentScheduler Tests
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ExperimentScheduler,
  createExperimentScheduler,
} from '../src/domain/ExperimentScheduler';
import { ExperimentsRegistry } from '../src/domain/ExperimentEvaluator';

describe('ExperimentScheduler', () => {
  const testDir = path.join(__dirname, 'tmp_scheduler_test');
  const experimentsPath = path.join(testDir, 'experiments.json');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  function writeRegistry(registry: ExperimentsRegistry): void {
    fs.writeFileSync(experimentsPath, JSON.stringify(registry, null, 2));
  }

  describe('getActiveExperiment', () => {
    it('should return running experiment as active', () => {
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
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
              { templateId: 'tmpl_B', variant: 'B', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(true);
      expect(result.experimentId).toBe('exp1');
      expect(result.activeTemplates).toHaveLength(2);
    });

    it('should not return paused experiment', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Paused Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'paused',
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(false);
      expect(result.reason).toContain('No active experiments');
    });

    it('should not return ended experiment', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Ended Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'ended',
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(false);
    });

    it('should not return experiment before start_at', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Future Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            startAt: futureDate.toISOString(),
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(false);
    });

    it('should not return experiment after end_at', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 7);

      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Expired Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            endAt: pastDate.toISOString(),
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(false);
    });

    it('should return experiment within start_at and end_at window', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);

      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Active Window Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            startAt: pastDate.toISOString(),
            endAt: futureDate.toISOString(),
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(true);
      expect(result.experimentId).toBe('exp1');
    });

    it('should prioritize newer start_at when multiple experiments qualify', () => {
      const oldStart = '2026-01-01T00:00:00.000Z';
      const newStart = '2026-01-15T00:00:00.000Z';

      writeRegistry({
        experiments: [
          {
            experimentId: 'old_exp',
            name: 'Old Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            startAt: oldStart,
            templates: [
              { templateId: 'old_A', variant: 'A', status: 'active' },
            ],
          },
          {
            experimentId: 'new_exp',
            name: 'New Experiment',
            startDate: '2026-01-15',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            startAt: newStart,
            templates: [
              { templateId: 'new_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({
        experimentsPath,
        now: new Date('2026-01-20T00:00:00.000Z'),
      });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(true);
      expect(result.experimentId).toBe('new_exp');
    });

    it('should default status to running for backward compatibility', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'No Status Experiment',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            // No status field
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(true);
    });

    it('should return not found when experiment has no active templates', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'No Active Templates',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'archived' },
              { templateId: 'tmpl_B', variant: 'B', status: 'proposed' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const result = scheduler.getActiveExperiment();

      expect(result.found).toBe(false);
      expect(result.reason).toContain('no active templates');
    });
  });

  describe('getExperimentsStatus', () => {
    it('should return status for all experiments', () => {
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

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const statuses = scheduler.getExperimentsStatus();

      expect(statuses).toHaveLength(2);
      expect(statuses.find((s) => s.experimentId === 'running_exp')?.isActive).toBe(true);
      expect(statuses.find((s) => s.experimentId === 'paused_exp')?.isActive).toBe(false);
    });
  });

  describe('hasActiveExperiment', () => {
    it('should return true when active experiment exists', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Active',
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

      const scheduler = new ExperimentScheduler({ experimentsPath });
      expect(scheduler.hasActiveExperiment()).toBe(true);
    });

    it('should return false when no active experiment', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'exp1',
            name: 'Paused',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'paused',
            templates: [
              { templateId: 'tmpl_A', variant: 'A', status: 'active' },
            ],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      expect(scheduler.hasActiveExperiment()).toBe(false);
    });
  });

  describe('factory function', () => {
    it('createExperimentScheduler creates new instance', () => {
      writeRegistry({
        experiments: [],
      });

      const scheduler = createExperimentScheduler({ experimentsPath });
      expect(scheduler).toBeInstanceOf(ExperimentScheduler);
    });
  });
});
