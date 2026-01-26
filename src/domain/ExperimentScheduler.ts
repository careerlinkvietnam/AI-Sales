/**
 * Experiment Scheduler Module
 *
 * Determines which experiment is currently active based on time and status.
 *
 * 目的:
 * - 実験のスケジューリングとライフサイクル管理
 * - 時刻ベースの実験開始/終了
 * - A/B割当対象の決定
 *
 * 制約:
 * - status="running" の実験のみ対象
 * - start_at <= now かつ (end_at未設定 or now < end_at) のものが有効
 * - 複数ある場合は start_at が新しいものを優先
 */

import {
  ExperimentConfig,
  ExperimentTemplate,
  ExperimentsRegistry,
  ExperimentEvaluator,
} from './ExperimentEvaluator';

/**
 * Active experiment result
 */
export interface ActiveExperimentResult {
  /** Whether an active experiment was found */
  found: boolean;
  /** Active experiment ID (null if none) */
  experimentId: string | null;
  /** Active experiment config (null if none) */
  experiment: ExperimentConfig | null;
  /** Active templates for A/B (empty if none) */
  activeTemplates: ExperimentTemplate[];
  /** Reason if no experiment is active */
  reason?: string;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /** Path to experiments.json */
  experimentsPath?: string;
  /** Current time (for testing) */
  now?: Date;
}

/**
 * Experiment Scheduler class
 */
export class ExperimentScheduler {
  private readonly evaluator: ExperimentEvaluator;
  private readonly now: Date;

  constructor(config?: SchedulerConfig) {
    this.evaluator = new ExperimentEvaluator({
      experimentsPath: config?.experimentsPath,
    });
    this.now = config?.now || new Date();
  }

  /**
   * Get the currently active experiment
   *
   * Priority rules (when multiple experiments qualify):
   * 1. status="running" only
   * 2. start_at <= now (or no start_at)
   * 3. end_at > now (or no end_at)
   * 4. If multiple qualify, pick the one with the most recent start_at
   *
   * @returns Active experiment result
   */
  getActiveExperiment(): ActiveExperimentResult {
    let registry: ExperimentsRegistry;

    try {
      registry = this.evaluator.loadRegistry();
    } catch (error) {
      return {
        found: false,
        experimentId: null,
        experiment: null,
        activeTemplates: [],
        reason: 'Failed to load experiments registry',
      };
    }

    const candidates: ExperimentConfig[] = [];

    for (const exp of registry.experiments) {
      if (this.isExperimentActive(exp)) {
        candidates.push(exp);
      }
    }

    if (candidates.length === 0) {
      return {
        found: false,
        experimentId: null,
        experiment: null,
        activeTemplates: [],
        reason: 'No active experiments found (all paused, ended, or outside schedule)',
      };
    }

    // Sort by start_at descending (newest first)
    candidates.sort((a, b) => {
      const startA = a.startAt || a.startDate;
      const startB = b.startAt || b.startDate;
      return startB.localeCompare(startA);
    });

    const selected = candidates[0];
    const activeTemplates = selected.templates.filter((t) => t.status === 'active');

    if (activeTemplates.length === 0) {
      return {
        found: false,
        experimentId: selected.experimentId,
        experiment: selected,
        activeTemplates: [],
        reason: `Experiment ${selected.experimentId} has no active templates`,
      };
    }

    return {
      found: true,
      experimentId: selected.experimentId,
      experiment: selected,
      activeTemplates,
    };
  }

  /**
   * Check if an experiment is currently active
   */
  private isExperimentActive(exp: ExperimentConfig): boolean {
    // Check status (default to "running" if not set for backward compatibility)
    const status = exp.status || 'running';
    if (status !== 'running') {
      return false;
    }

    const nowStr = this.now.toISOString();

    // Check start_at (if set, must be <= now)
    if (exp.startAt) {
      if (exp.startAt > nowStr) {
        return false;
      }
    }

    // Check end_at (if set, must be > now)
    if (exp.endAt) {
      if (exp.endAt <= nowStr) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get all experiments with their status
   */
  getExperimentsStatus(): Array<{
    experimentId: string;
    name: string;
    status: string;
    isActive: boolean;
    startAt: string | null;
    endAt: string | null;
    activeTemplateCount: number;
  }> {
    let registry: ExperimentsRegistry;

    try {
      registry = this.evaluator.loadRegistry();
    } catch {
      return [];
    }

    return registry.experiments.map((exp) => ({
      experimentId: exp.experimentId,
      name: exp.name,
      status: exp.status || 'running',
      isActive: this.isExperimentActive(exp),
      startAt: exp.startAt || null,
      endAt: exp.endAt || null,
      activeTemplateCount: exp.templates.filter((t) => t.status === 'active').length,
    }));
  }

  /**
   * Check if any experiment is active
   */
  hasActiveExperiment(): boolean {
    return this.getActiveExperiment().found;
  }
}

/**
 * Create scheduler with default config
 */
export function createExperimentScheduler(
  config?: SchedulerConfig
): ExperimentScheduler {
  return new ExperimentScheduler(config);
}

/**
 * Singleton instance
 */
let defaultScheduler: ExperimentScheduler | null = null;

/**
 * Get or create the default scheduler
 */
export function getExperimentScheduler(): ExperimentScheduler {
  if (!defaultScheduler) {
    defaultScheduler = new ExperimentScheduler();
  }
  return defaultScheduler;
}

/**
 * Reset singleton (for testing)
 */
export function resetExperimentScheduler(): void {
  defaultScheduler = null;
}

export default ExperimentScheduler;
