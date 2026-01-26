/**
 * Auto-Stop Policy Module
 *
 * Evaluates metrics to determine if auto-send should be stopped.
 *
 * 設計原則:
 * - 返信率が低い場合は停止を推奨
 * - ブロック率が高い場合も停止を推奨
 * - 連続N日間条件を満たした場合に発動
 * - 最小送信数未満では判定しない（統計的に不十分）
 *
 * 設定ファイル: config/auto_stop.json
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Auto-stop policy configuration
 */
export interface AutoStopConfig {
  window_days: number;
  min_sent_total: number;
  reply_rate_min: number;
  blocked_rate_max: number;
  consecutive_days: number;
}

/**
 * Metrics summary for evaluation
 */
export interface AutoStopMetrics {
  /** Total auto-send attempts in window */
  totalAttempts: number;
  /** Total successful sends in window */
  totalSuccess: number;
  /** Total blocked sends in window */
  totalBlocked: number;
  /** Total replies detected in window */
  totalReplies: number;
  /** Daily metrics for consecutive day check */
  dailyMetrics: DailyMetrics[];
}

/**
 * Daily metrics for consecutive day check
 */
export interface DailyMetrics {
  date: string;
  attempts: number;
  success: number;
  blocked: number;
  replies: number;
}

/**
 * Evaluation result
 */
export interface AutoStopEvaluationResult {
  should_stop: boolean;
  reasons: string[];
  metrics: {
    totalSent: number;
    totalReplies: number;
    totalBlocked: number;
    replyRate: number | null;
    blockedRate: number | null;
    consecutiveBadDays: number;
  };
}

/**
 * Default config path
 */
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'auto_stop.json');

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AutoStopConfig = {
  window_days: 3,
  min_sent_total: 30,
  reply_rate_min: 0.015,
  blocked_rate_max: 0.30,
  consecutive_days: 2,
};

/**
 * Auto-Stop Policy class
 */
export class AutoStopPolicy {
  private config: AutoStopConfig;
  private readonly configPath: string;

  constructor(options?: { configPath?: string; config?: Partial<AutoStopConfig> }) {
    this.configPath = options?.configPath || DEFAULT_CONFIG_PATH;

    if (options?.config) {
      this.config = { ...DEFAULT_CONFIG, ...options.config };
    } else {
      this.config = this.loadConfig();
    }
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): AutoStopConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(content);
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (error) {
      console.error(
        `[AutoStopPolicy] Failed to load config from ${this.configPath}: ${
          error instanceof Error ? error.message : 'Unknown'
        }`
      );
    }
    return DEFAULT_CONFIG;
  }

  /**
   * Evaluate metrics and determine if auto-send should be stopped
   *
   * @param metrics - Aggregated metrics for the evaluation window
   * @returns Evaluation result with should_stop flag and reasons
   */
  evaluate(metrics: AutoStopMetrics): AutoStopEvaluationResult {
    const reasons: string[] = [];
    const totalSent = metrics.totalSuccess;

    // Calculate rates
    const replyRate = totalSent > 0 ? metrics.totalReplies / totalSent : null;
    const blockedRate =
      metrics.totalAttempts > 0 ? metrics.totalBlocked / metrics.totalAttempts : null;

    // Count consecutive bad days
    const consecutiveBadDays = this.countConsecutiveBadDays(metrics.dailyMetrics);

    // Check 1: Minimum sent threshold
    if (totalSent < this.config.min_sent_total) {
      return {
        should_stop: false,
        reasons: [
          `Insufficient data: ${totalSent} sent (need ${this.config.min_sent_total} for evaluation)`,
        ],
        metrics: {
          totalSent,
          totalReplies: metrics.totalReplies,
          totalBlocked: metrics.totalBlocked,
          replyRate,
          blockedRate,
          consecutiveBadDays,
        },
      };
    }

    // Check 2: Reply rate below minimum
    if (replyRate !== null && replyRate < this.config.reply_rate_min) {
      reasons.push(
        `Reply rate too low: ${(replyRate * 100).toFixed(2)}% (min: ${(this.config.reply_rate_min * 100).toFixed(1)}%)`
      );
    }

    // Check 3: Blocked rate above maximum
    if (blockedRate !== null && blockedRate > this.config.blocked_rate_max) {
      reasons.push(
        `Blocked rate too high: ${(blockedRate * 100).toFixed(1)}% (max: ${(this.config.blocked_rate_max * 100).toFixed(0)}%)`
      );
    }

    // Check 4: Consecutive bad days
    const shouldStopByConsecutive = consecutiveBadDays >= this.config.consecutive_days;
    if (shouldStopByConsecutive && reasons.length === 0) {
      reasons.push(
        `${consecutiveBadDays} consecutive days with poor metrics (threshold: ${this.config.consecutive_days})`
      );
    }

    // Determine if should stop
    // Stop if: (reply rate low OR blocked rate high) AND consecutive days met
    const hasMetricIssue = reasons.length > 0;
    const should_stop = hasMetricIssue && shouldStopByConsecutive;

    if (hasMetricIssue && !shouldStopByConsecutive) {
      reasons.push(
        `Waiting for ${this.config.consecutive_days} consecutive days (current: ${consecutiveBadDays})`
      );
    }

    return {
      should_stop,
      reasons,
      metrics: {
        totalSent,
        totalReplies: metrics.totalReplies,
        totalBlocked: metrics.totalBlocked,
        replyRate,
        blockedRate,
        consecutiveBadDays,
      },
    };
  }

  /**
   * Count consecutive days with poor metrics (from most recent)
   */
  private countConsecutiveBadDays(dailyMetrics: DailyMetrics[]): number {
    if (dailyMetrics.length === 0) return 0;

    // Sort by date descending (most recent first)
    const sorted = [...dailyMetrics].sort((a, b) => b.date.localeCompare(a.date));

    let count = 0;
    for (const day of sorted) {
      if (this.isDayBad(day)) {
        count++;
      } else {
        break; // Stop counting on first good day
      }
    }

    return count;
  }

  /**
   * Check if a day's metrics are "bad" (below thresholds)
   */
  private isDayBad(day: DailyMetrics): boolean {
    // Skip days with no sends
    if (day.success === 0) return false;

    const replyRate = day.replies / day.success;
    const blockedRate = day.attempts > 0 ? day.blocked / day.attempts : 0;

    // Day is bad if reply rate is below min OR blocked rate is above max
    return replyRate < this.config.reply_rate_min || blockedRate > this.config.blocked_rate_max;
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoStopConfig {
    return { ...this.config };
  }
}

/**
 * Singleton instance
 */
let defaultAutoStopPolicy: AutoStopPolicy | null = null;

/**
 * Get or create the default auto-stop policy
 */
export function getAutoStopPolicy(): AutoStopPolicy {
  if (!defaultAutoStopPolicy) {
    defaultAutoStopPolicy = new AutoStopPolicy();
  }
  return defaultAutoStopPolicy;
}

/**
 * Reset singleton (for testing)
 */
export function resetAutoStopPolicy(): void {
  defaultAutoStopPolicy = null;
}

/**
 * Create auto-stop policy for testing
 */
export function createTestAutoStopPolicy(config: Partial<AutoStopConfig>): AutoStopPolicy {
  return new AutoStopPolicy({ config });
}

export default AutoStopPolicy;
