/**
 * Ops Summary Builder
 *
 * Builds consolidated operation summaries for daily/weekly/health notifications.
 * All content is PII-free.
 *
 * 設計:
 * - 入力: health集計 + 各ステップ結果
 * - 出力: OpsSummary (title, severity, highlights, actions)
 * - severity判定は明確なルールで決める
 */

/**
 * Health status input
 */
export interface HealthInput {
  killSwitch: {
    runtimeEnabled: boolean;
    envEnabled: boolean;
    reason?: string | null;
  };
  sendQueue: {
    queued: number;
    inProgress: number;
    deadLetter: number;
    sent: number;
    failed?: number;
  };
  incidents: {
    openCount: number;
    openIds?: string[];
  };
  metrics: {
    windowDays: number;
    totalSent: number;
    totalReplies: number;
    replyRate: number | null;
    totalBlocked: number;
  };
  data: Record<string, {
    exists: boolean;
    lines: number;
    sizeBytes: number;
    sizeFormatted: string;
  }>;
}

/**
 * Step result from daily/weekly operations
 */
export interface StepResult {
  name: string;
  success?: boolean;
  skipped?: boolean;
  error?: string;
  // Step-specific data
  [key: string]: unknown;
}

/**
 * Operation type
 */
export type OpType = 'daily' | 'weekly' | 'health';

/**
 * Summary severity
 */
export type SummarySeverity = 'info' | 'warn' | 'error';

/**
 * Operation summary output
 */
export interface OpsSummary {
  title: string;
  opType: OpType;
  timestamp: string;
  severity: SummarySeverity;
  mode: 'dry-run' | 'execute';
  highlights: string[];
  actions: string[];
  links?: string[];
  health?: HealthInput;
  stepResults?: StepResult[];
}

/**
 * Build options
 */
export interface BuildOptions {
  opType: OpType;
  mode: 'dry-run' | 'execute';
  health: HealthInput;
  steps?: StepResult[];
}

/**
 * Severity thresholds
 */
interface SeverityConfig {
  // Error conditions
  killSwitchActive: boolean;
  autoStopExecuted: boolean;
  deadLetterThreshold: number;
  openIncidentsThreshold: number;
  // Warn conditions
  queuedHighThreshold: number;
  blockedRatioThreshold: number;
  replyRateLowThreshold: number;
  reaperFired: boolean;
  dataSizeWarnMB: number;
}

const DEFAULT_SEVERITY_CONFIG: SeverityConfig = {
  killSwitchActive: true,
  autoStopExecuted: true,
  deadLetterThreshold: 0,
  openIncidentsThreshold: 0,
  queuedHighThreshold: 50,
  blockedRatioThreshold: 0.3,
  replyRateLowThreshold: 0.02,
  reaperFired: true,
  dataSizeWarnMB: 50,
};

/**
 * OpsSummaryBuilder class
 */
export class OpsSummaryBuilder {
  private readonly severityConfig: SeverityConfig;

  constructor(config?: Partial<SeverityConfig>) {
    this.severityConfig = { ...DEFAULT_SEVERITY_CONFIG, ...config };
  }

  /**
   * Build operation summary
   */
  build(options: BuildOptions): OpsSummary {
    const { opType, mode, health, steps } = options;
    const timestamp = new Date().toISOString();

    // Determine severity
    const severity = this.determineSeverity(health, steps);

    // Build highlights
    const highlights = this.buildHighlights(health, steps);

    // Build actions
    const actions = this.buildActions(health, steps, severity);

    // Build links
    const links = this.buildLinks(opType, severity);

    // Build title
    const title = this.buildTitle(opType, severity, mode);

    return {
      title,
      opType,
      timestamp,
      severity,
      mode,
      highlights: highlights.slice(0, 6), // Max 6 highlights
      actions: actions.slice(0, 3), // Max 3 actions
      links,
      health,
      stepResults: steps,
    };
  }

  /**
   * Build title
   */
  private buildTitle(opType: OpType, severity: SummarySeverity, mode: string): string {
    const severityEmoji = {
      info: '[OK]',
      warn: '[WARN]',
      error: '[ERROR]',
    };
    const opTypeLabel = {
      daily: 'Daily',
      weekly: 'Weekly',
      health: 'Health',
    };
    const modeLabel = mode === 'dry-run' ? ' (dry-run)' : '';
    return `AI-Sales ${opTypeLabel[opType]} Summary ${severityEmoji[severity]}${modeLabel}`;
  }

  /**
   * Determine severity based on health and step results
   */
  private determineSeverity(health: HealthInput, steps?: StepResult[]): SummarySeverity {
    const config = this.severityConfig;

    // Error conditions
    if (config.killSwitchActive && (health.killSwitch.runtimeEnabled || health.killSwitch.envEnabled)) {
      return 'error';
    }

    // Check for auto-stop executed in steps
    if (config.autoStopExecuted && steps) {
      const autoStopStep = steps.find(s => s.name === 'auto_stop' || s.name === 'auto-stop');
      if (autoStopStep?.result && (autoStopStep.result as { stopped?: boolean })?.stopped) {
        return 'error';
      }
    }

    if (health.sendQueue.deadLetter > config.deadLetterThreshold) {
      return 'error';
    }

    if (health.incidents.openCount > config.openIncidentsThreshold) {
      return 'error';
    }

    // Warn conditions
    if (health.sendQueue.queued > config.queuedHighThreshold) {
      return 'warn';
    }

    // Check blocked ratio
    const totalAttempts = health.metrics.totalSent + health.metrics.totalBlocked;
    if (totalAttempts > 0) {
      const blockedRatio = health.metrics.totalBlocked / totalAttempts;
      if (blockedRatio > config.blockedRatioThreshold) {
        return 'warn';
      }
    }

    // Check reply rate
    if (health.metrics.replyRate !== null && health.metrics.replyRate < config.replyRateLowThreshold) {
      return 'warn';
    }

    // Check for reaper activity
    if (config.reaperFired && steps) {
      const reapStep = steps.find(s => s.name === 'reap');
      const reapResult = reapStep?.result as { requeued?: number; deadLettered?: number } | undefined;
      if (reapResult && (reapResult.requeued || 0) + (reapResult.deadLettered || 0) > 0) {
        return 'warn';
      }
    }

    // Check data size
    const dataSizeWarnBytes = config.dataSizeWarnMB * 1024 * 1024;
    for (const fileStatus of Object.values(health.data)) {
      if (fileStatus.sizeBytes > dataSizeWarnBytes) {
        return 'warn';
      }
    }

    // Check for step failures
    if (steps) {
      const failedSteps = steps.filter(s => s.success === false && !s.skipped);
      if (failedSteps.length > 0) {
        return 'warn';
      }
    }

    return 'info';
  }

  /**
   * Build highlights from health and step results
   */
  private buildHighlights(health: HealthInput, steps?: StepResult[]): string[] {
    const highlights: string[] = [];

    // Kill switch status
    if (health.killSwitch.runtimeEnabled || health.killSwitch.envEnabled) {
      const reason = health.killSwitch.reason ? `: ${health.killSwitch.reason}` : '';
      highlights.push(`Kill Switch: ACTIVE${reason}`);
    }

    // Send queue status
    highlights.push(
      `Queue: ${health.sendQueue.queued} queued, ${health.sendQueue.inProgress} in_progress, ${health.sendQueue.deadLetter} dead_letter`
    );

    // Metrics
    if (health.metrics.totalSent > 0 || health.metrics.totalReplies > 0) {
      const replyRateStr = health.metrics.replyRate !== null
        ? ` (${(health.metrics.replyRate * 100).toFixed(1)}%)`
        : '';
      highlights.push(
        `Metrics (${health.metrics.windowDays}d): ${health.metrics.totalSent} sent, ${health.metrics.totalReplies} replies${replyRateStr}`
      );
    }

    // Blocked count
    if (health.metrics.totalBlocked > 0) {
      highlights.push(`Blocked: ${health.metrics.totalBlocked}`);
    }

    // Incidents
    if (health.incidents.openCount > 0) {
      highlights.push(`Incidents: ${health.incidents.openCount} open`);
    }

    // Reap results from steps
    if (steps) {
      const reapStep = steps.find(s => s.name === 'reap');
      const reapResult = reapStep?.result as { requeued?: number; deadLettered?: number; staleJobsFound?: number } | undefined;
      if (reapResult && (reapResult.staleJobsFound || 0) > 0) {
        highlights.push(
          `Reaper: ${reapResult.staleJobsFound} stale found, ${reapResult.requeued || 0} requeued, ${reapResult.deadLettered || 0} dead_lettered`
        );
      }
    }

    // Step failures
    if (steps) {
      const failedSteps = steps.filter(s => s.success === false && !s.skipped);
      if (failedSteps.length > 0) {
        const failedNames = failedSteps.map(s => s.name).join(', ');
        highlights.push(`Failed steps: ${failedNames}`);
      }
    }

    // Data sizes (only mention large ones)
    const dataSizeWarnBytes = this.severityConfig.dataSizeWarnMB * 1024 * 1024;
    const largeFiles = Object.entries(health.data)
      .filter(([_, status]) => status.sizeBytes > dataSizeWarnBytes)
      .map(([name, status]) => `${name}: ${status.sizeFormatted}`);
    if (largeFiles.length > 0) {
      highlights.push(`Large data files: ${largeFiles.join(', ')}`);
    }

    return highlights;
  }

  /**
   * Build actions based on severity and issues
   */
  private buildActions(health: HealthInput, steps: StepResult[] | undefined, severity: SummarySeverity): string[] {
    const actions: string[] = [];

    if (severity === 'info') {
      actions.push('No action required');
      return actions;
    }

    // Kill switch active
    if (health.killSwitch.runtimeEnabled || health.killSwitch.envEnabled) {
      actions.push('Review kill switch status: run_ops stop-status');
    }

    // Dead letter queue
    if (health.sendQueue.deadLetter > 0) {
      actions.push('Review dead letter jobs: run_ops send-queue status');
    }

    // Open incidents
    if (health.incidents.openCount > 0) {
      actions.push('Review open incidents: run_ops incidents --status open');
    }

    // Low reply rate
    if (health.metrics.replyRate !== null && health.metrics.replyRate < this.severityConfig.replyRateLowThreshold) {
      actions.push('Check template effectiveness: run_ops safety');
    }

    // Reaper found stale jobs
    if (steps) {
      const reapStep = steps.find(s => s.name === 'reap');
      const reapResult = reapStep?.result as { staleJobsFound?: number } | undefined;
      if (reapResult && (reapResult.staleJobsFound || 0) > 0) {
        actions.push('Investigate stale jobs: check process health');
      }
    }

    // High queue count
    if (health.sendQueue.queued > this.severityConfig.queuedHighThreshold) {
      actions.push('Queue backlog detected: run_ops send-queue status');
    }

    // Failed steps
    if (steps) {
      const failedSteps = steps.filter(s => s.success === false && !s.skipped);
      if (failedSteps.length > 0) {
        actions.push('Review failed step logs');
      }
    }

    // Data size warning
    const dataSizeWarnBytes = this.severityConfig.dataSizeWarnMB * 1024 * 1024;
    const hasLargeFiles = Object.values(health.data).some(status => status.sizeBytes > dataSizeWarnBytes);
    if (hasLargeFiles) {
      actions.push('Consider data compaction: run_ops data compact --target all');
    }

    return actions;
  }

  /**
   * Build helpful links/commands
   */
  private buildLinks(opType: OpType, severity: SummarySeverity): string[] {
    const links: string[] = [];

    if (severity === 'error') {
      links.push('npx ts-node src/cli/run_ops.ts health --json');
      links.push('npx ts-node src/cli/run_ops.ts stop-status');
    } else if (severity === 'warn') {
      links.push('npx ts-node src/cli/run_ops.ts health');
    }

    return links;
  }

  /**
   * Format summary as plain text for notification
   */
  formatAsText(summary: OpsSummary): string {
    const lines: string[] = [];

    // Title with severity
    lines.push(summary.title);
    lines.push('─'.repeat(40));

    // Highlights
    if (summary.highlights.length > 0) {
      for (const highlight of summary.highlights) {
        lines.push(`• ${highlight}`);
      }
      lines.push('');
    }

    // Actions
    if (summary.actions.length > 0) {
      lines.push('Next actions:');
      for (const action of summary.actions) {
        lines.push(`→ ${action}`);
      }
    }

    // Links
    if (summary.links && summary.links.length > 0) {
      lines.push('');
      lines.push('Commands:');
      for (const link of summary.links) {
        lines.push(`  ${link}`);
      }
    }

    // Timestamp
    lines.push('');
    lines.push(`Time: ${summary.timestamp}`);

    return lines.join('\n');
  }
}

/**
 * Default builder instance
 */
let defaultBuilder: OpsSummaryBuilder | null = null;

/**
 * Get default OpsSummaryBuilder
 */
export function getOpsSummaryBuilder(): OpsSummaryBuilder {
  if (!defaultBuilder) {
    defaultBuilder = new OpsSummaryBuilder();
  }
  return defaultBuilder;
}

/**
 * Reset default builder (for testing)
 */
export function resetOpsSummaryBuilder(): void {
  defaultBuilder = null;
}

export default OpsSummaryBuilder;
