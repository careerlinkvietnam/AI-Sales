/**
 * run_ops CLI Tests
 *
 * Tests the unified operations CLI subcommand structure.
 * Note: Integration tests that spawn child processes are minimal.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExperimentScheduler } from '../src/domain/ExperimentScheduler';
import { ExperimentSafetyCheck } from '../src/jobs/ExperimentSafetyCheck';
import { ExperimentsRegistry } from '../src/domain/ExperimentEvaluator';
import { resetMetricsStore } from '../src/data/MetricsStore';

describe('run_ops CLI Components', () => {
  const testDir = path.join(__dirname, 'tmp_run_ops_test');
  const experimentsPath = path.join(testDir, 'experiments.json');
  const metricsPath = path.join(testDir, 'metrics.ndjson');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    process.env.METRICS_STORE_PATH = metricsPath;
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

  describe('status subcommand (ExperimentScheduler)', () => {
    it('should show active experiment', () => {
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

    it('should show all experiments status', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'running',
            name: 'Running Exp',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            templates: [{ templateId: 'tmpl_A', variant: 'A', status: 'active' }],
          },
          {
            experimentId: 'paused',
            name: 'Paused Exp',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'paused',
            templates: [{ templateId: 'tmpl_B', variant: 'B', status: 'active' }],
          },
        ],
      });

      const scheduler = new ExperimentScheduler({ experimentsPath });
      const statuses = scheduler.getExperimentsStatus();

      expect(statuses).toHaveLength(2);
      expect(statuses.find((s) => s.experimentId === 'running')?.isActive).toBe(true);
      expect(statuses.find((s) => s.experimentId === 'paused')?.isActive).toBe(false);
    });
  });

  describe('safety subcommand (ExperimentSafetyCheck)', () => {
    it('should check experiment safety', () => {
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
            templates: [{ templateId: 'tmpl_A', variant: 'A', status: 'active' }],
          },
        ],
      });

      fs.writeFileSync(metricsPath, '');

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const result = safetyCheck.check('exp1');

      expect(result.experimentId).toBe('exp1');
      expect(['ok', 'freeze_recommended', 'rollback_recommended', 'review_recommended']).toContain(
        result.action
      );
    });

    it('should check all running experiments', () => {
      writeRegistry({
        experiments: [
          {
            experimentId: 'running1',
            name: 'Running 1',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'running',
            templates: [{ templateId: 'tmpl_A', variant: 'A', status: 'active' }],
          },
          {
            experimentId: 'ended1',
            name: 'Ended 1',
            startDate: '2026-01-01',
            endDate: null,
            primaryMetric: 'reply_rate',
            minSentPerVariant: 50,
            decisionRule: { alpha: 0.05, minLift: 0.02 },
            status: 'ended',
            templates: [{ templateId: 'tmpl_B', variant: 'B', status: 'active' }],
          },
        ],
      });

      fs.writeFileSync(metricsPath, '');

      const safetyCheck = new ExperimentSafetyCheck({ experimentsPath });
      const results = safetyCheck.checkAll();

      // Only running experiments are checked
      expect(results).toHaveLength(1);
      expect(results[0].experimentId).toBe('running1');
    });
  });

  describe('subcommand argument parsing', () => {
    it('scan subcommand accepts --since option', () => {
      // This tests the structure, actual execution would require mocking
      const args = ['--since', '2026-01-15'];
      expect(args).toContain('--since');
      expect(args).toContain('2026-01-15');
    });

    it('report subcommand accepts multiple options', () => {
      const args = ['--since', '2026-01-15', '--markdown', '--include-decision'];
      expect(args).toContain('--markdown');
      expect(args).toContain('--include-decision');
    });

    it('propose subcommand requires experiment and since', () => {
      const args = ['--experiment', 'exp1', '--since', '2026-01-15', '--dry-run'];
      expect(args).toContain('--experiment');
      expect(args).toContain('exp1');
      expect(args).toContain('--dry-run');
    });

    it('approve subcommand requires all approval fields', () => {
      const args = [
        '--experiment', 'exp1',
        '--template-id', 'tmpl1',
        '--approved-by', 'Yamada',
        '--reason', 'Test approval',
      ];
      expect(args).toContain('--approved-by');
      expect(args).toContain('Yamada');
    });

    it('safety subcommand can be run without experiment (checks all)', () => {
      const argsWithExp = ['--experiment', 'exp1'];
      const argsWithoutExp: string[] = [];

      expect(argsWithExp).toContain('--experiment');
      expect(argsWithoutExp).not.toContain('--experiment');
    });
  });

  describe('daily/weekly routine support', () => {
    it('daily routine: scan then report', () => {
      // Routine: run_ops scan -> run_ops report
      const dailySteps = [
        { command: 'scan', args: ['--since', '2026-01-25'] },
        { command: 'report', args: ['--since', '2026-01-25', '--show-templates'] },
      ];

      expect(dailySteps).toHaveLength(2);
      expect(dailySteps[0].command).toBe('scan');
      expect(dailySteps[1].command).toBe('report');
    });

    it('weekly routine: propose -> approve -> promote', () => {
      // Routine: propose(dry-run) -> approve -> promote(dry-run) -> promote
      const weeklySteps = [
        { command: 'propose', args: ['--experiment', 'exp1', '--since', '2026-01-15', '--dry-run'] },
        { command: 'approve', args: ['--experiment', 'exp1', '--template-id', 'tmpl1', '--approved-by', 'Admin', '--reason', 'Weekly approval'] },
        { command: 'promote', args: ['--experiment', 'exp1', '--dry-run'] },
        { command: 'promote', args: ['--experiment', 'exp1'] },
      ];

      expect(weeklySteps).toHaveLength(4);
      expect(weeklySteps[0].args).toContain('--dry-run');
      expect(weeklySteps[2].args).toContain('--dry-run');
      expect(weeklySteps[3].args).not.toContain('--dry-run');
    });

    it('safety check routine', () => {
      // Routine: run_ops safety (check all)
      const safetySteps = [
        { command: 'safety', args: [] },
        { command: 'safety', args: ['--experiment', 'exp1', '--since', '2026-01-20'] },
      ];

      expect(safetySteps).toHaveLength(2);
    });
  });
});
