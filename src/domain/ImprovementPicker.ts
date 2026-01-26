/**
 * Improvement Picker Module
 *
 * Selects template/segment combinations that need improvement based on metrics.
 *
 * 目的:
 * - 改善が必要なセグメント/テンプレートの組み合わせを選定
 * - メトリクスに基づく自動選定
 *
 * 制約:
 * - PIIは使用しない（メトリクスのみ）
 * - 自動昇格はしない
 */

/**
 * Segment metrics for improvement analysis
 */
export interface SegmentMetricsForPicker {
  segmentName: string;
  segmentValue: string;
  templateId: string;
  variant: 'A' | 'B' | null;
  sent: number;
  replies: number;
  replyRate: number | null;
  medianLatencyHours: number | null;
}

/**
 * Improvement candidate
 */
export interface ImprovementCandidate {
  segmentKey: string;
  segmentName: string;
  segmentValue: string;
  templateId: string;
  variant: 'A' | 'B' | null;
  sent: number;
  replyRate: number | null;
  gapVsBest: number | null;
  latencyGapVsBest: number | null;
  reason: string;
}

/**
 * Picker configuration
 */
export interface PickerConfig {
  /** Minimum sent count for consideration */
  minSent: number;
  /** Minimum gap vs best to flag for improvement (e.g., 0.03 = 3%) */
  minGap: number;
  /** Maximum candidates to return */
  maxCandidates: number;
  /** Consider latency as factor */
  considerLatency: boolean;
  /** Latency gap threshold (hours) */
  latencyGapThreshold: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PickerConfig = {
  minSent: 50,
  minGap: 0.03,
  maxCandidates: 5,
  considerLatency: true,
  latencyGapThreshold: 6,
};

/**
 * Improvement Picker class
 */
export class ImprovementPicker {
  private readonly config: PickerConfig;

  constructor(config?: Partial<PickerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Pick improvement candidates from metrics
   *
   * @param metrics - Array of segment metrics
   * @returns Array of improvement candidates, sorted by priority
   */
  pick(metrics: SegmentMetricsForPicker[]): ImprovementCandidate[] {
    const candidates: ImprovementCandidate[] = [];

    // Group by segment
    const segmentGroups = this.groupBySegment(metrics);

    for (const [segmentKey, segmentMetrics] of segmentGroups) {
      // Filter to sufficient sample size
      const sufficient = segmentMetrics.filter((m) => m.sent >= this.config.minSent);

      if (sufficient.length < 2) {
        // Need at least 2 variants to compare
        continue;
      }

      // Find best reply rate in this segment
      const bestRate = this.findBestReplyRate(sufficient);
      const bestLatency = this.findBestLatency(sufficient);

      // Find candidates that are underperforming
      for (const metric of sufficient) {
        const candidate = this.evaluateCandidate(
          metric,
          bestRate,
          bestLatency,
          segmentKey
        );
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    // Sort by gap (descending) and limit
    return candidates
      .sort((a, b) => {
        // Primary: gap vs best (larger gap = higher priority)
        const gapA = a.gapVsBest ?? 0;
        const gapB = b.gapVsBest ?? 0;
        return gapB - gapA;
      })
      .slice(0, this.config.maxCandidates);
  }

  /**
   * Group metrics by segment
   */
  private groupBySegment(
    metrics: SegmentMetricsForPicker[]
  ): Map<string, SegmentMetricsForPicker[]> {
    const groups = new Map<string, SegmentMetricsForPicker[]>();

    for (const metric of metrics) {
      const key = `${metric.segmentName}:${metric.segmentValue}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(metric);
    }

    return groups;
  }

  /**
   * Find best reply rate in a segment
   */
  private findBestReplyRate(
    metrics: SegmentMetricsForPicker[]
  ): number | null {
    let best: number | null = null;

    for (const m of metrics) {
      if (m.replyRate !== null) {
        if (best === null || m.replyRate > best) {
          best = m.replyRate;
        }
      }
    }

    return best;
  }

  /**
   * Find best (lowest) latency in a segment
   */
  private findBestLatency(
    metrics: SegmentMetricsForPicker[]
  ): number | null {
    let best: number | null = null;

    for (const m of metrics) {
      if (m.medianLatencyHours !== null) {
        if (best === null || m.medianLatencyHours < best) {
          best = m.medianLatencyHours;
        }
      }
    }

    return best;
  }

  /**
   * Evaluate if a metric qualifies as improvement candidate
   */
  private evaluateCandidate(
    metric: SegmentMetricsForPicker,
    bestRate: number | null,
    bestLatency: number | null,
    segmentKey: string
  ): ImprovementCandidate | null {
    const reasons: string[] = [];
    let gapVsBest: number | null = null;
    let latencyGapVsBest: number | null = null;

    // Check reply rate gap
    if (bestRate !== null && metric.replyRate !== null) {
      gapVsBest = bestRate - metric.replyRate;
      if (gapVsBest >= this.config.minGap) {
        reasons.push(
          `Reply rate ${(metric.replyRate * 100).toFixed(1)}% is ${(gapVsBest * 100).toFixed(1)}pp below best`
        );
      }
    }

    // Check latency gap
    if (
      this.config.considerLatency &&
      bestLatency !== null &&
      metric.medianLatencyHours !== null
    ) {
      latencyGapVsBest = metric.medianLatencyHours - bestLatency;
      if (latencyGapVsBest >= this.config.latencyGapThreshold) {
        reasons.push(
          `Latency ${metric.medianLatencyHours.toFixed(1)}h is ${latencyGapVsBest.toFixed(1)}h slower than best`
        );
      }
    }

    // Need at least one reason to be a candidate
    if (reasons.length === 0) {
      return null;
    }

    return {
      segmentKey,
      segmentName: metric.segmentName,
      segmentValue: metric.segmentValue,
      templateId: metric.templateId,
      variant: metric.variant,
      sent: metric.sent,
      replyRate: metric.replyRate,
      gapVsBest,
      latencyGapVsBest,
      reason: reasons.join('; '),
    };
  }

  /**
   * Get configuration
   */
  getConfig(): PickerConfig {
    return { ...this.config };
  }
}

/**
 * Create improvement picker with default config
 */
export function createImprovementPicker(
  config?: Partial<PickerConfig>
): ImprovementPicker {
  return new ImprovementPicker(config);
}

export default ImprovementPicker;
