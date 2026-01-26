/**
 * Experiment Evaluator Module
 *
 * Statistical evaluation of A/B test results using z-test for proportion comparison.
 *
 * 目的:
 * - A/Bテストの勝者を統計的に判定
 * - 有意差検定（二項比率の差のz検定）
 * - 昇格判断のためのデシジョン生成
 *
 * 制約:
 * - 分母は sent_detected、分子は reply_detected
 * - PII は使用しない（メトリクスのみ）
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Template status in experiment
 *
 * - active: Currently in use for A/B testing
 * - archived: Previously used, no longer active
 * - inactive: Not in use
 * - proposed: Auto-generated improvement proposal (not active in A/B assignment)
 */
export type TemplateStatus = 'active' | 'archived' | 'inactive' | 'proposed';

/**
 * Template definition in experiment
 */
export interface ExperimentTemplate {
  templateId: string;
  variant: 'A' | 'B';
  status: TemplateStatus;
}

/**
 * Decision rule for experiment
 */
export interface DecisionRule {
  /** Significance level (default: 0.05) */
  alpha: number;
  /** Minimum lift required to declare winner (default: 0.02 = 2%) */
  minLift: number;
}

/**
 * Experiment lifecycle status
 */
export type ExperimentStatus = 'running' | 'paused' | 'ended';

/**
 * Rollback rule for safety checks
 */
export interface RollbackRule {
  /** Maximum days without any reply before recommending rollback */
  maxDaysNoReply: number;
  /** Minimum total sent before evaluating rollback */
  minSentTotal: number;
  /** Minimum reply rate threshold (below this triggers rollback recommendation) */
  minReplyRate: number;
}

/**
 * Default rollback rule
 */
export const DEFAULT_ROLLBACK_RULE: RollbackRule = {
  maxDaysNoReply: 7,
  minSentTotal: 100,
  minReplyRate: 0.02,
};

/**
 * Experiment configuration
 */
export interface ExperimentConfig {
  experimentId: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string | null;
  primaryMetric: string;
  minSentPerVariant: number;
  decisionRule: DecisionRule;
  templates: ExperimentTemplate[];
  /** Experiment lifecycle status (default: running) */
  status?: ExperimentStatus;
  /** Scheduled start time in ISO format (optional, immediate if not set) */
  startAt?: string;
  /** Scheduled end time in ISO format (optional) */
  endAt?: string;
  /** Freeze experiment when sample size is too low (default: true) */
  freezeOnLowN?: boolean;
  /** Rollback rule for safety checks */
  rollbackRule?: RollbackRule;
}

/**
 * Experiments registry file structure
 */
export interface ExperimentsRegistry {
  experiments: ExperimentConfig[];
}

/**
 * Variant metrics for evaluation
 */
export interface VariantMetrics {
  variant: 'A' | 'B';
  sent: number;
  replies: number;
  replyRate: number | null;
}

/**
 * Statistical results
 */
export interface StatisticalResults {
  pValue: number | null;
  zScore: number | null;
  lift: number | null;
  liftPercent: number | null;
  sentA: number;
  sentB: number;
  replyA: number;
  replyB: number;
  rateA: number | null;
  rateB: number | null;
}

/**
 * Decision reason types
 */
export type DecisionReason =
  | 'insufficient_data_A'
  | 'insufficient_data_B'
  | 'insufficient_data_both'
  | 'no_significant_difference'
  | 'lift_below_threshold'
  | 'winner_A'
  | 'winner_B';

/**
 * Evaluation decision
 */
export interface EvaluationDecision {
  experimentId: string;
  winnerVariant: 'A' | 'B' | null;
  reason: DecisionReason;
  reasonText: string;
  stats: StatisticalResults;
  canPromote: boolean;
}

/**
 * Segmented metrics for evaluation
 */
export interface SegmentedMetrics {
  segmentName: string;
  segmentValue: string;
  metricsA: VariantMetrics;
  metricsB: VariantMetrics;
}

/**
 * Segmented evaluation decision
 */
export interface SegmentedEvaluationDecision extends EvaluationDecision {
  segmentName: string;
  segmentValue: string;
  isExploratory: boolean;
}

/**
 * Experiment Evaluator class
 */
export class ExperimentEvaluator {
  private readonly experimentsPath: string;
  private registry: ExperimentsRegistry | null = null;

  constructor(options?: { experimentsPath?: string }) {
    this.experimentsPath =
      options?.experimentsPath ||
      path.join(process.cwd(), 'config', 'experiments.json');
  }

  /**
   * Load experiments registry
   */
  loadRegistry(): ExperimentsRegistry {
    if (this.registry) {
      return this.registry;
    }

    if (!fs.existsSync(this.experimentsPath)) {
      throw new Error(`Experiments file not found: ${this.experimentsPath}`);
    }

    const content = fs.readFileSync(this.experimentsPath, 'utf-8');
    this.registry = JSON.parse(content) as ExperimentsRegistry;
    return this.registry;
  }

  /**
   * Get experiment by ID
   */
  getExperiment(experimentId: string): ExperimentConfig | null {
    const registry = this.loadRegistry();
    return (
      registry.experiments.find((e) => e.experimentId === experimentId) || null
    );
  }

  /**
   * Get active templates for an experiment
   */
  getActiveTemplates(experimentId: string): ExperimentTemplate[] {
    const experiment = this.getExperiment(experimentId);
    if (!experiment) {
      return [];
    }
    return experiment.templates.filter((t) => t.status === 'active');
  }

  /**
   * Get all active template IDs across all experiments
   */
  getAllActiveTemplateIds(): string[] {
    const registry = this.loadRegistry();
    const ids: string[] = [];

    for (const experiment of registry.experiments) {
      for (const template of experiment.templates) {
        if (template.status === 'active') {
          ids.push(template.templateId);
        }
      }
    }

    return ids;
  }

  /**
   * Calculate z-score for two proportions
   *
   * H0: p1 = p2 (no difference)
   * H1: p1 != p2 (two-tailed test)
   *
   * z = (p1 - p2) / sqrt(p_pooled * (1 - p_pooled) * (1/n1 + 1/n2))
   */
  private calculateZScore(
    successes1: number,
    total1: number,
    successes2: number,
    total2: number
  ): number | null {
    // Avoid division by zero
    if (total1 === 0 || total2 === 0) {
      return null;
    }

    const p1 = successes1 / total1;
    const p2 = successes2 / total2;

    // Pooled proportion
    const pPooled = (successes1 + successes2) / (total1 + total2);

    // Handle edge case: all successes or no successes
    if (pPooled === 0 || pPooled === 1) {
      return 0;
    }

    // Standard error
    const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / total1 + 1 / total2));

    if (se === 0) {
      return 0;
    }

    return (p1 - p2) / se;
  }

  /**
   * Calculate p-value from z-score (two-tailed)
   *
   * Uses standard normal distribution approximation
   */
  private calculatePValue(zScore: number | null): number | null {
    if (zScore === null) {
      return null;
    }

    // Standard normal CDF approximation (Abramowitz and Stegun)
    const absZ = Math.abs(zScore);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * absZ);
    const t2 = t * t;
    const t3 = t2 * t;
    const t4 = t3 * t;
    const t5 = t4 * t;

    const cdf =
      1.0 -
      ((((a5 * t5 + a4 * t4 + a3 * t3 + a2 * t2 + a1 * t) *
        Math.exp((-absZ * absZ) / 2)) /
        Math.sqrt(2 * Math.PI)) as number);

    // Two-tailed p-value
    return 2 * (1 - cdf);
  }

  /**
   * Evaluate experiment with given metrics
   *
   * @param experimentId - Experiment identifier
   * @param metricsA - Variant A metrics
   * @param metricsB - Variant B metrics
   * @returns Evaluation decision
   */
  evaluate(
    experimentId: string,
    metricsA: VariantMetrics,
    metricsB: VariantMetrics
  ): EvaluationDecision {
    const experiment = this.getExperiment(experimentId);

    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    const { minSentPerVariant, decisionRule } = experiment;
    const { alpha, minLift } = decisionRule;

    // Calculate rates safely
    const rateA = metricsA.sent > 0 ? metricsA.replies / metricsA.sent : null;
    const rateB = metricsB.sent > 0 ? metricsB.replies / metricsB.sent : null;

    // Calculate lift (B vs A)
    let lift: number | null = null;
    let liftPercent: number | null = null;
    if (rateA !== null && rateB !== null && rateA > 0) {
      lift = rateB - rateA;
      liftPercent = (rateB - rateA) / rateA;
    }

    // Calculate z-score and p-value
    const zScore = this.calculateZScore(
      metricsA.replies,
      metricsA.sent,
      metricsB.replies,
      metricsB.sent
    );
    const pValue = this.calculatePValue(zScore);

    // Build statistical results
    const stats: StatisticalResults = {
      pValue,
      zScore,
      lift,
      liftPercent,
      sentA: metricsA.sent,
      sentB: metricsB.sent,
      replyA: metricsA.replies,
      replyB: metricsB.replies,
      rateA,
      rateB,
    };

    // Decision logic
    // 1. Check minimum sample size
    const hasEnoughA = metricsA.sent >= minSentPerVariant;
    const hasEnoughB = metricsB.sent >= minSentPerVariant;

    if (!hasEnoughA && !hasEnoughB) {
      return {
        experimentId,
        winnerVariant: null,
        reason: 'insufficient_data_both',
        reasonText: `Both variants have insufficient data (need ${minSentPerVariant} sent each, got A=${metricsA.sent}, B=${metricsB.sent})`,
        stats,
        canPromote: false,
      };
    }

    if (!hasEnoughA) {
      return {
        experimentId,
        winnerVariant: null,
        reason: 'insufficient_data_A',
        reasonText: `Variant A has insufficient data (need ${minSentPerVariant} sent, got ${metricsA.sent})`,
        stats,
        canPromote: false,
      };
    }

    if (!hasEnoughB) {
      return {
        experimentId,
        winnerVariant: null,
        reason: 'insufficient_data_B',
        reasonText: `Variant B has insufficient data (need ${minSentPerVariant} sent, got ${metricsB.sent})`,
        stats,
        canPromote: false,
      };
    }

    // 2. Check statistical significance
    if (pValue === null || pValue >= alpha) {
      return {
        experimentId,
        winnerVariant: null,
        reason: 'no_significant_difference',
        reasonText: `No statistically significant difference (p=${pValue?.toFixed(4) ?? 'N/A'}, alpha=${alpha})`,
        stats,
        canPromote: false,
      };
    }

    // 3. Determine winner based on rates
    if (rateA === null || rateB === null) {
      return {
        experimentId,
        winnerVariant: null,
        reason: 'no_significant_difference',
        reasonText: 'Cannot determine rates',
        stats,
        canPromote: false,
      };
    }

    // 4. Check minimum lift
    const absoluteLift = Math.abs(rateB - rateA);
    if (absoluteLift < minLift) {
      return {
        experimentId,
        winnerVariant: null,
        reason: 'lift_below_threshold',
        reasonText: `Lift below threshold (lift=${(absoluteLift * 100).toFixed(1)}%, minLift=${minLift * 100}%)`,
        stats,
        canPromote: false,
      };
    }

    // 5. Declare winner
    if (rateA > rateB) {
      return {
        experimentId,
        winnerVariant: 'A',
        reason: 'winner_A',
        reasonText: `Variant A wins with ${(rateA * 100).toFixed(1)}% vs ${(rateB * 100).toFixed(1)}% (p=${pValue.toFixed(4)})`,
        stats,
        canPromote: true,
      };
    } else {
      return {
        experimentId,
        winnerVariant: 'B',
        reason: 'winner_B',
        reasonText: `Variant B wins with ${(rateB * 100).toFixed(1)}% vs ${(rateA * 100).toFixed(1)}% (p=${pValue.toFixed(4)})`,
        stats,
        canPromote: true,
      };
    }
  }

  /**
   * Save updated registry
   */
  saveRegistry(registry: ExperimentsRegistry, backupPath?: string): void {
    // Create backup if path provided
    if (backupPath) {
      if (fs.existsSync(this.experimentsPath)) {
        const content = fs.readFileSync(this.experimentsPath, 'utf-8');
        fs.writeFileSync(backupPath, content, 'utf-8');
      }
    }

    // Save updated registry
    fs.writeFileSync(
      this.experimentsPath,
      JSON.stringify(registry, null, 2),
      'utf-8'
    );

    // Clear cache
    this.registry = null;
  }

  /**
   * Evaluate experiment for multiple segments
   *
   * Note: Segmented evaluation is EXPLORATORY.
   * No multiple comparison correction is applied.
   * Results should be used for hypothesis generation, not final decisions.
   *
   * @param experimentId - Experiment identifier
   * @param segmentedMetrics - Array of segment metrics
   * @param overrideDecisionRule - Optional override for decision rule
   * @returns Array of segmented decisions
   */
  evaluateSegmented(
    experimentId: string,
    segmentedMetrics: SegmentedMetrics[],
    overrideDecisionRule?: Partial<DecisionRule>
  ): SegmentedEvaluationDecision[] {
    const experiment = this.getExperiment(experimentId);

    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    const decisions: SegmentedEvaluationDecision[] = [];

    for (const segment of segmentedMetrics) {
      // Use override if provided, otherwise use experiment defaults
      const minSent = overrideDecisionRule?.minLift !== undefined
        ? experiment.minSentPerVariant
        : experiment.minSentPerVariant;
      const alpha = overrideDecisionRule?.alpha ?? experiment.decisionRule.alpha;
      const minLift = overrideDecisionRule?.minLift ?? experiment.decisionRule.minLift;

      // Create temporary experiment config for evaluation
      const tempConfig: ExperimentConfig = {
        ...experiment,
        decisionRule: { alpha, minLift },
      };

      // Store original registry and temporarily set config
      const originalRegistry = this.registry;
      this.registry = {
        experiments: [tempConfig],
      };

      try {
        const baseDecision = this.evaluate(
          experimentId,
          segment.metricsA,
          segment.metricsB
        );

        decisions.push({
          ...baseDecision,
          segmentName: segment.segmentName,
          segmentValue: segment.segmentValue,
          isExploratory: true, // Always mark as exploratory
          // Override canPromote to false for segmented analysis
          canPromote: false,
        });
      } finally {
        // Restore original registry
        this.registry = originalRegistry;
      }
    }

    return decisions;
  }

  /**
   * Promote winner in experiment
   *
   * @param experimentId - Experiment to update
   * @param winnerVariant - Winning variant
   * @returns Updated registry
   */
  promoteWinner(
    experimentId: string,
    winnerVariant: 'A' | 'B'
  ): ExperimentsRegistry {
    const registry = this.loadRegistry();
    const experiment = registry.experiments.find(
      (e) => e.experimentId === experimentId
    );

    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    // Update template statuses
    for (const template of experiment.templates) {
      if (template.variant === winnerVariant) {
        template.status = 'active';
      } else {
        template.status = 'archived';
      }
    }

    // Update end date
    experiment.endDate = new Date().toISOString().split('T')[0];

    return registry;
  }
}

/**
 * Singleton instance
 */
let defaultEvaluator: ExperimentEvaluator | null = null;

/**
 * Get or create the default experiment evaluator
 */
export function getExperimentEvaluator(): ExperimentEvaluator {
  if (!defaultEvaluator) {
    defaultEvaluator = new ExperimentEvaluator();
  }
  return defaultEvaluator;
}

/**
 * Create experiment evaluator for testing
 */
export function createTestExperimentEvaluator(
  experimentsPath: string
): ExperimentEvaluator {
  return new ExperimentEvaluator({ experimentsPath });
}

export default ExperimentEvaluator;
