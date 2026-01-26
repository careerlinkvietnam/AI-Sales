/**
 * Experiment Safety Check Module
 *
 * Checks experiment health and recommends freeze/rollback actions.
 *
 * 目的:
 * - 実験の健全性チェック
 * - 凍結/ロールバックの推奨（実際の変更はしない）
 *
 * 制約:
 * - 推奨を出すだけ、実際のstatusは変更しない
 * - PIIは使用しない
 */

import {
  ExperimentConfig,
  ExperimentsRegistry,
  ExperimentEvaluator,
  RollbackRule,
  DEFAULT_ROLLBACK_RULE,
} from '../domain/ExperimentEvaluator';
import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';

/**
 * Safety check action types
 */
export type SafetyAction =
  | 'ok'
  | 'freeze_recommended'
  | 'rollback_recommended'
  | 'review_recommended';

/**
 * Safety check result for a single experiment
 */
export interface SafetyCheckResult {
  experimentId: string;
  action: SafetyAction;
  reasons: string[];
  metrics: {
    totalSent: number;
    totalReplies: number;
    replyRate: number | null;
    daysSinceLastReply: number | null;
    daysSinceStart: number;
  };
}

/**
 * Safety check configuration
 */
export interface SafetyCheckConfig {
  /** Path to experiments.json */
  experimentsPath?: string;
  /** Current time (for testing) */
  now?: Date;
  /** Override rollback rule */
  rollbackRule?: Partial<RollbackRule>;
}

/**
 * Experiment Safety Check class
 */
export class ExperimentSafetyCheck {
  private readonly evaluator: ExperimentEvaluator;
  private readonly now: Date;
  private readonly defaultRollbackRule: RollbackRule;

  constructor(config?: SafetyCheckConfig) {
    this.evaluator = new ExperimentEvaluator({
      experimentsPath: config?.experimentsPath,
    });
    this.now = config?.now || new Date();
    this.defaultRollbackRule = {
      ...DEFAULT_ROLLBACK_RULE,
      ...config?.rollbackRule,
    };
  }

  /**
   * Check safety of a specific experiment
   *
   * @param experimentId - Experiment to check
   * @param since - Only consider events since this date
   * @returns Safety check result
   */
  check(experimentId: string, since?: string): SafetyCheckResult {
    const experiment = this.evaluator.getExperiment(experimentId);

    if (!experiment) {
      return {
        experimentId,
        action: 'review_recommended',
        reasons: ['Experiment not found'],
        metrics: {
          totalSent: 0,
          totalReplies: 0,
          replyRate: null,
          daysSinceLastReply: null,
          daysSinceStart: 0,
        },
      };
    }

    // Get metrics
    const metricsStore = getMetricsStore();
    const events = since
      ? metricsStore.readEventsSince(since)
      : metricsStore.readAllEvents();

    // Filter to this experiment's templates
    const templateIds = new Set(experiment.templates.map((t) => t.templateId));
    const experimentEvents = events.filter((e) => templateIds.has(e.templateId));

    // Calculate metrics
    const metrics = this.calculateMetrics(experiment, experimentEvents);

    // Get rollback rule (experiment-specific or default)
    const rollbackRule = experiment.rollbackRule || this.defaultRollbackRule;

    // Determine action
    const { action, reasons } = this.determineAction(
      experiment,
      metrics,
      rollbackRule
    );

    return {
      experimentId,
      action,
      reasons,
      metrics,
    };
  }

  /**
   * Check all running experiments
   */
  checkAll(since?: string): SafetyCheckResult[] {
    let registry: ExperimentsRegistry;

    try {
      registry = this.evaluator.loadRegistry();
    } catch {
      return [];
    }

    const results: SafetyCheckResult[] = [];

    for (const exp of registry.experiments) {
      // Only check running experiments
      const status = exp.status || 'running';
      if (status === 'running') {
        results.push(this.check(exp.experimentId, since));
      }
    }

    return results;
  }

  /**
   * Calculate metrics for an experiment
   */
  private calculateMetrics(
    experiment: ExperimentConfig,
    events: MetricsEvent[]
  ): SafetyCheckResult['metrics'] {
    let totalSent = 0;
    let totalReplies = 0;
    let lastReplyTimestamp: string | null = null;

    for (const event of events) {
      if (event.eventType === 'SENT_DETECTED') {
        totalSent++;
      } else if (event.eventType === 'REPLY_DETECTED') {
        totalReplies++;
        if (!lastReplyTimestamp || event.timestamp > lastReplyTimestamp) {
          lastReplyTimestamp = event.timestamp;
        }
      }
    }

    const replyRate = totalSent > 0 ? totalReplies / totalSent : null;

    // Calculate days since last reply
    let daysSinceLastReply: number | null = null;
    if (lastReplyTimestamp) {
      const lastReplyDate = new Date(lastReplyTimestamp);
      const diffMs = this.now.getTime() - lastReplyDate.getTime();
      daysSinceLastReply = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    } else if (totalSent > 0) {
      // No replies at all, use experiment start date
      const startDate = new Date(experiment.startAt || experiment.startDate);
      const diffMs = this.now.getTime() - startDate.getTime();
      daysSinceLastReply = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    // Calculate days since experiment start
    const startDate = new Date(experiment.startAt || experiment.startDate);
    const daysSinceStart = Math.floor(
      (this.now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      totalSent,
      totalReplies,
      replyRate,
      daysSinceLastReply,
      daysSinceStart,
    };
  }

  /**
   * Determine safety action based on metrics
   */
  private determineAction(
    experiment: ExperimentConfig,
    metrics: SafetyCheckResult['metrics'],
    rollbackRule: RollbackRule
  ): { action: SafetyAction; reasons: string[] } {
    const reasons: string[] = [];
    let action: SafetyAction = 'ok';

    // Check 1: Low sample size (freeze recommended)
    const freezeOnLowN = experiment.freezeOnLowN !== false; // default true
    if (freezeOnLowN) {
      const minSentTotal = rollbackRule.minSentTotal;
      if (metrics.totalSent < minSentTotal && metrics.daysSinceStart >= 7) {
        reasons.push(
          `低サンプル: ${metrics.totalSent}送信 (最小: ${minSentTotal}) after ${metrics.daysSinceStart} days`
        );
        action = 'freeze_recommended';
      }
    }

    // Check 2: No replies for too long (rollback recommended)
    if (
      metrics.daysSinceLastReply !== null &&
      metrics.daysSinceLastReply >= rollbackRule.maxDaysNoReply &&
      metrics.totalSent >= rollbackRule.minSentTotal
    ) {
      reasons.push(
        `長期間返信なし: ${metrics.daysSinceLastReply}日間 (閾値: ${rollbackRule.maxDaysNoReply}日)`
      );
      action = 'rollback_recommended';
    }

    // Check 3: Reply rate too low (rollback recommended)
    if (
      metrics.replyRate !== null &&
      metrics.replyRate < rollbackRule.minReplyRate &&
      metrics.totalSent >= rollbackRule.minSentTotal
    ) {
      reasons.push(
        `低返信率: ${(metrics.replyRate * 100).toFixed(1)}% (閾値: ${(rollbackRule.minReplyRate * 100).toFixed(1)}%)`
      );
      action = 'rollback_recommended';
    }

    // If no issues found
    if (reasons.length === 0) {
      reasons.push('No issues detected');
    }

    return { action, reasons };
  }
}

/**
 * Create safety check with default config
 */
export function createExperimentSafetyCheck(
  config?: SafetyCheckConfig
): ExperimentSafetyCheck {
  return new ExperimentSafetyCheck(config);
}

export default ExperimentSafetyCheck;
