/**
 * evaluateSegmented Test Suite
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ExperimentEvaluator,
  ExperimentsRegistry,
  SegmentedMetrics,
  VariantMetrics,
  createTestExperimentEvaluator,
} from '../src/domain/ExperimentEvaluator';

describe('evaluateSegmented', () => {
  const testDir = 'data/test-segmented';
  const testFile = 'test-experiments.json';
  const testPath = path.join(testDir, testFile);

  let evaluator: ExperimentEvaluator;

  const defaultRegistry: ExperimentsRegistry = {
    experiments: [
      {
        experimentId: 'segmented_test',
        name: 'Segmented Test',
        description: 'For testing segmented evaluation',
        startDate: '2026-01-01',
        endDate: null,
        primaryMetric: 'reply_rate',
        minSentPerVariant: 30,
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
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(testPath, JSON.stringify(defaultRegistry, null, 2));
    evaluator = createTestExperimentEvaluator(testPath);
  });

  afterAll(() => {
    if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
  });

  it('evaluates multiple segments', () => {
    const segmentedMetrics: SegmentedMetrics[] = [
      {
        segmentName: 'region',
        segmentValue: '南部',
        metricsA: { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 },
        metricsB: { variant: 'B', sent: 100, replies: 20, replyRate: 0.2 },
      },
      {
        segmentName: 'region',
        segmentValue: '北部',
        metricsA: { variant: 'A', sent: 50, replies: 20, replyRate: 0.4 },
        metricsB: { variant: 'B', sent: 50, replies: 15, replyRate: 0.3 },
      },
    ];

    const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

    expect(decisions).toHaveLength(2);
    expect(decisions[0].segmentName).toBe('region');
    expect(decisions[0].segmentValue).toBe('南部');
    expect(decisions[1].segmentValue).toBe('北部');
  });

  it('marks all decisions as exploratory', () => {
    const segmentedMetrics: SegmentedMetrics[] = [
      {
        segmentName: 'region',
        segmentValue: '南部',
        metricsA: { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 },
        metricsB: { variant: 'B', sent: 100, replies: 20, replyRate: 0.2 },
      },
    ];

    const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

    expect(decisions[0].isExploratory).toBe(true);
  });

  it('sets canPromote to false for all segmented decisions', () => {
    const segmentedMetrics: SegmentedMetrics[] = [
      {
        segmentName: 'region',
        segmentValue: '南部',
        metricsA: { variant: 'A', sent: 200, replies: 100, replyRate: 0.5 },
        metricsB: { variant: 'B', sent: 200, replies: 40, replyRate: 0.2 },
      },
    ];

    const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

    // Even though this would normally be promotable, segmented results should not be
    expect(decisions[0].canPromote).toBe(false);
  });

  it('returns insufficient_data for segments below threshold', () => {
    const segmentedMetrics: SegmentedMetrics[] = [
      {
        segmentName: 'region',
        segmentValue: '中部',
        metricsA: { variant: 'A', sent: 10, replies: 5, replyRate: 0.5 },
        metricsB: { variant: 'B', sent: 10, replies: 2, replyRate: 0.2 },
      },
    ];

    const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

    expect(decisions[0].winnerVariant).toBeNull();
    expect(decisions[0].reason).toContain('insufficient_data');
  });

  it('identifies winner in segments with sufficient data', () => {
    const segmentedMetrics: SegmentedMetrics[] = [
      {
        segmentName: 'customerState',
        segmentValue: 'existing',
        metricsA: { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 },
        metricsB: { variant: 'B', sent: 100, replies: 20, replyRate: 0.2 },
      },
    ];

    const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

    expect(decisions[0].winnerVariant).toBe('A');
    expect(decisions[0].reason).toBe('winner_A');
  });

  it('handles mixed sufficient/insufficient segments', () => {
    const segmentedMetrics: SegmentedMetrics[] = [
      {
        segmentName: 'region',
        segmentValue: '南部',
        metricsA: { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 },
        metricsB: { variant: 'B', sent: 100, replies: 20, replyRate: 0.2 },
      },
      {
        segmentName: 'region',
        segmentValue: '中部',
        metricsA: { variant: 'A', sent: 5, replies: 3, replyRate: 0.6 },
        metricsB: { variant: 'B', sent: 5, replies: 1, replyRate: 0.2 },
      },
      {
        segmentName: 'region',
        segmentValue: '北部',
        metricsA: { variant: 'A', sent: 80, replies: 30, replyRate: 0.375 },
        metricsB: { variant: 'B', sent: 80, replies: 32, replyRate: 0.4 },
      },
    ];

    const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

    expect(decisions).toHaveLength(3);

    // 南部 has clear winner
    const southDecision = decisions.find((d) => d.segmentValue === '南部');
    expect(southDecision?.winnerVariant).toBe('A');

    // 中部 has insufficient data
    const centralDecision = decisions.find((d) => d.segmentValue === '中部');
    expect(centralDecision?.winnerVariant).toBeNull();
    expect(centralDecision?.reason).toContain('insufficient_data');

    // 北部 may or may not have significant difference
    const northDecision = decisions.find((d) => d.segmentValue === '北部');
    expect(northDecision).toBeDefined();
  });

  it('throws error for unknown experiment', () => {
    const segmentedMetrics: SegmentedMetrics[] = [
      {
        segmentName: 'region',
        segmentValue: '南部',
        metricsA: { variant: 'A', sent: 100, replies: 50, replyRate: 0.5 },
        metricsB: { variant: 'B', sent: 100, replies: 20, replyRate: 0.2 },
      },
    ];

    expect(() =>
      evaluator.evaluateSegmented('unknown_experiment', segmentedMetrics)
    ).toThrow('not found');
  });

  it('handles empty segments array', () => {
    const decisions = evaluator.evaluateSegmented('segmented_test', []);
    expect(decisions).toHaveLength(0);
  });

  describe('edge cases', () => {
    it('handles zero sent in one segment', () => {
      const segmentedMetrics: SegmentedMetrics[] = [
        {
          segmentName: 'industryBucket',
          segmentValue: 'IT',
          metricsA: { variant: 'A', sent: 0, replies: 0, replyRate: null },
          metricsB: { variant: 'B', sent: 50, replies: 10, replyRate: 0.2 },
        },
      ];

      const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

      expect(decisions[0].winnerVariant).toBeNull();
      expect(decisions[0].reason).toContain('insufficient_data');
    });

    it('handles zero replies in both variants', () => {
      const segmentedMetrics: SegmentedMetrics[] = [
        {
          segmentName: 'customerState',
          segmentValue: 'new',
          metricsA: { variant: 'A', sent: 50, replies: 0, replyRate: 0 },
          metricsB: { variant: 'B', sent: 50, replies: 0, replyRate: 0 },
        },
      ];

      const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

      expect(decisions[0].winnerVariant).toBeNull();
    });
  });

  describe('multiple segment types', () => {
    it('evaluates different segment types together', () => {
      const segmentedMetrics: SegmentedMetrics[] = [
        {
          segmentName: 'region',
          segmentValue: '南部',
          metricsA: { variant: 'A', sent: 100, replies: 40, replyRate: 0.4 },
          metricsB: { variant: 'B', sent: 100, replies: 30, replyRate: 0.3 },
        },
        {
          segmentName: 'customerState',
          segmentValue: 'existing',
          metricsA: { variant: 'A', sent: 80, replies: 50, replyRate: 0.625 },
          metricsB: { variant: 'B', sent: 80, replies: 20, replyRate: 0.25 },
        },
        {
          segmentName: 'industryBucket',
          segmentValue: 'IT',
          metricsA: { variant: 'A', sent: 60, replies: 25, replyRate: 0.417 },
          metricsB: { variant: 'B', sent: 60, replies: 22, replyRate: 0.367 },
        },
      ];

      const decisions = evaluator.evaluateSegmented('segmented_test', segmentedMetrics);

      expect(decisions).toHaveLength(3);

      const bySegmentName = new Map(decisions.map((d) => [d.segmentName, d]));
      expect(bySegmentName.has('region')).toBe(true);
      expect(bySegmentName.has('customerState')).toBe(true);
      expect(bySegmentName.has('industryBucket')).toBe(true);
    });
  });
});
