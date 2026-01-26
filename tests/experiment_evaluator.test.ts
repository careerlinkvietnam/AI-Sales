/**
 * ExperimentEvaluator Test Suite
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ExperimentEvaluator,
  ExperimentsRegistry,
  VariantMetrics,
  createTestExperimentEvaluator,
} from '../src/domain/ExperimentEvaluator';

describe('ExperimentEvaluator', () => {
  const testDir = 'data/test-experiments';
  const testFile = 'test-experiments.json';
  const testPath = path.join(testDir, testFile);

  let evaluator: ExperimentEvaluator;

  const defaultRegistry: ExperimentsRegistry = {
    experiments: [
      {
        experimentId: 'test_experiment_1',
        name: 'Test Experiment',
        description: 'For testing',
        startDate: '2026-01-01',
        endDate: null,
        primaryMetric: 'reply_rate',
        minSentPerVariant: 50,
        decisionRule: {
          alpha: 0.05,
          minLift: 0.02,
        },
        templates: [
          { templateId: 'template_A', variant: 'A', status: 'active' },
          { templateId: 'template_B', variant: 'B', status: 'active' },
        ],
      },
    ],
  };

  beforeEach(() => {
    // Ensure test directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Write test registry
    fs.writeFileSync(testPath, JSON.stringify(defaultRegistry, null, 2));

    evaluator = createTestExperimentEvaluator(testPath);
  });

  afterAll(() => {
    // Clean up
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
    // Clean up any backup files
    const backupPattern = /test-experiments\.json\.bak-\d+/;
    const files = fs.readdirSync(testDir);
    for (const file of files) {
      if (backupPattern.test(file)) {
        fs.unlinkSync(path.join(testDir, file));
      }
    }
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
  });

  describe('loadRegistry', () => {
    it('loads experiments from file', () => {
      const registry = evaluator.loadRegistry();
      expect(registry.experiments).toHaveLength(1);
      expect(registry.experiments[0].experimentId).toBe('test_experiment_1');
    });

    it('throws error if file not found', () => {
      const badEvaluator = createTestExperimentEvaluator('/nonexistent/path.json');
      expect(() => badEvaluator.loadRegistry()).toThrow('not found');
    });
  });

  describe('getExperiment', () => {
    it('returns experiment by ID', () => {
      const experiment = evaluator.getExperiment('test_experiment_1');
      expect(experiment).not.toBeNull();
      expect(experiment?.name).toBe('Test Experiment');
    });

    it('returns null for unknown ID', () => {
      expect(evaluator.getExperiment('unknown')).toBeNull();
    });
  });

  describe('getActiveTemplates', () => {
    it('returns only active templates', () => {
      // Update registry to have mixed statuses
      const registry: ExperimentsRegistry = {
        experiments: [
          {
            ...defaultRegistry.experiments[0],
            templates: [
              { templateId: 'template_A', variant: 'A', status: 'active' },
              { templateId: 'template_B', variant: 'B', status: 'archived' },
            ],
          },
        ],
      };
      fs.writeFileSync(testPath, JSON.stringify(registry, null, 2));
      const newEvaluator = createTestExperimentEvaluator(testPath);

      const active = newEvaluator.getActiveTemplates('test_experiment_1');
      expect(active).toHaveLength(1);
      expect(active[0].variant).toBe('A');
    });
  });

  describe('evaluate', () => {
    describe('insufficient data', () => {
      it('returns insufficient_data_both when both variants below threshold', () => {
        const metricsA: VariantMetrics = { variant: 'A', sent: 10, replies: 5, replyRate: 0.5 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 10, replies: 3, replyRate: 0.3 };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBeNull();
        expect(decision.reason).toBe('insufficient_data_both');
        expect(decision.canPromote).toBe(false);
      });

      it('returns insufficient_data_A when only A below threshold', () => {
        const metricsA: VariantMetrics = { variant: 'A', sent: 10, replies: 5, replyRate: 0.5 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 100, replies: 30, replyRate: 0.3 };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBeNull();
        expect(decision.reason).toBe('insufficient_data_A');
      });

      it('returns insufficient_data_B when only B below threshold', () => {
        const metricsA: VariantMetrics = { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 10, replies: 3, replyRate: 0.3 };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBeNull();
        expect(decision.reason).toBe('insufficient_data_B');
      });
    });

    describe('no significant difference', () => {
      it('returns no_significant_difference when p-value >= alpha', () => {
        // Similar rates, enough data
        const metricsA: VariantMetrics = { variant: 'A', sent: 100, replies: 30, replyRate: 0.3 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 100, replies: 31, replyRate: 0.31 };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBeNull();
        expect(decision.reason).toBe('no_significant_difference');
        expect(decision.canPromote).toBe(false);
      });
    });

    describe('lift below threshold', () => {
      it('returns lift_below_threshold when difference is too small', () => {
        // Use a registry with high minLift
        const registry: ExperimentsRegistry = {
          experiments: [
            {
              ...defaultRegistry.experiments[0],
              minSentPerVariant: 10,
              decisionRule: { alpha: 0.5, minLift: 0.5 }, // Very high minLift
            },
          ],
        };
        fs.writeFileSync(testPath, JSON.stringify(registry, null, 2));
        const strictEvaluator = createTestExperimentEvaluator(testPath);

        const metricsA: VariantMetrics = { variant: 'A', sent: 100, replies: 30, replyRate: 0.3 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 100, replies: 35, replyRate: 0.35 };

        const decision = strictEvaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBeNull();
        expect(decision.reason).toBe('lift_below_threshold');
      });
    });

    describe('winner determination', () => {
      it('declares A as winner when A has significantly higher rate', () => {
        // Large sample, clear difference
        const metricsA: VariantMetrics = { variant: 'A', sent: 200, replies: 100, replyRate: 0.5 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 200, replies: 40, replyRate: 0.2 };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBe('A');
        expect(decision.reason).toBe('winner_A');
        expect(decision.canPromote).toBe(true);
        expect(decision.stats.pValue).toBeLessThan(0.05);
      });

      it('declares B as winner when B has significantly higher rate', () => {
        // Large sample, clear difference
        const metricsA: VariantMetrics = { variant: 'A', sent: 200, replies: 40, replyRate: 0.2 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 200, replies: 100, replyRate: 0.5 };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBe('B');
        expect(decision.reason).toBe('winner_B');
        expect(decision.canPromote).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('handles zero sent safely', () => {
        const metricsA: VariantMetrics = { variant: 'A', sent: 0, replies: 0, replyRate: null };
        const metricsB: VariantMetrics = { variant: 'B', sent: 0, replies: 0, replyRate: null };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBeNull();
        expect(decision.reason).toBe('insufficient_data_both');
      });

      it('handles zero replies safely', () => {
        const metricsA: VariantMetrics = { variant: 'A', sent: 100, replies: 0, replyRate: 0 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 100, replies: 0, replyRate: 0 };

        const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

        expect(decision.winnerVariant).toBeNull();
        // Either no_significant_difference or lift_below_threshold
        expect(decision.canPromote).toBe(false);
      });

      it('throws for unknown experiment', () => {
        const metricsA: VariantMetrics = { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 };
        const metricsB: VariantMetrics = { variant: 'B', sent: 100, replies: 30, replyRate: 0.3 };

        expect(() => evaluator.evaluate('unknown', metricsA, metricsB)).toThrow('not found');
      });
    });
  });

  describe('promoteWinner', () => {
    it('updates template statuses correctly', () => {
      const updatedRegistry = evaluator.promoteWinner('test_experiment_1', 'A');

      const experiment = updatedRegistry.experiments.find(
        (e) => e.experimentId === 'test_experiment_1'
      );
      expect(experiment).toBeDefined();

      const templateA = experiment?.templates.find((t) => t.variant === 'A');
      const templateB = experiment?.templates.find((t) => t.variant === 'B');

      expect(templateA?.status).toBe('active');
      expect(templateB?.status).toBe('archived');
    });

    it('sets end date', () => {
      const updatedRegistry = evaluator.promoteWinner('test_experiment_1', 'B');

      const experiment = updatedRegistry.experiments.find(
        (e) => e.experimentId === 'test_experiment_1'
      );
      expect(experiment?.endDate).not.toBeNull();
    });
  });

  describe('saveRegistry', () => {
    it('creates backup when path provided', () => {
      const backupPath = path.join(testDir, 'backup-test.json');

      const registry = evaluator.loadRegistry();
      evaluator.saveRegistry(registry, backupPath);

      expect(fs.existsSync(backupPath)).toBe(true);

      // Clean up
      fs.unlinkSync(backupPath);
    });

    it('saves updated registry', () => {
      const registry = evaluator.loadRegistry();
      registry.experiments[0].name = 'Updated Name';
      evaluator.saveRegistry(registry);

      const newEvaluator = createTestExperimentEvaluator(testPath);
      const reloaded = newEvaluator.loadRegistry();

      expect(reloaded.experiments[0].name).toBe('Updated Name');
    });
  });

  describe('statistical calculations', () => {
    it('calculates p-value correctly for clear difference', () => {
      // 50% vs 20% with 200 samples each should be highly significant
      const metricsA: VariantMetrics = { variant: 'A', sent: 200, replies: 100, replyRate: 0.5 };
      const metricsB: VariantMetrics = { variant: 'B', sent: 200, replies: 40, replyRate: 0.2 };

      const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

      expect(decision.stats.pValue).toBeLessThan(0.001);
    });

    it('calculates lift correctly', () => {
      const metricsA: VariantMetrics = { variant: 'A', sent: 100, replies: 20, replyRate: 0.2 };
      const metricsB: VariantMetrics = { variant: 'B', sent: 100, replies: 30, replyRate: 0.3 };

      const decision = evaluator.evaluate('test_experiment_1', metricsA, metricsB);

      // Lift = (0.3 - 0.2) / 0.2 = 0.5 = 50%
      expect(decision.stats.liftPercent).toBeCloseTo(0.5, 2);
    });
  });
});
