#!/usr/bin/env ts-node
/**
 * Promote Winner CLI
 *
 * Evaluates A/B test results and promotes the winning template.
 *
 * Usage:
 *   npx ts-node src/cli/promote_winner.ts --experiment "ab_subject_cta_v1"
 *   npx ts-node src/cli/promote_winner.ts --experiment "ab_subject_cta_v1" --dry-run
 *   npx ts-node src/cli/promote_winner.ts --experiment "ab_subject_cta_v1" --json
 *
 * 注意:
 * - PIIは使用しない（メトリクスのみ）
 * - 変更前にバックアップを作成
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import {
  ExperimentEvaluator,
  EvaluationDecision,
  VariantMetrics,
} from '../domain/ExperimentEvaluator';
import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('promote_winner')
  .description('Evaluate A/B test and promote winning template')
  .version('0.1.0');

program
  .requiredOption('--experiment <id>', 'Experiment ID to evaluate')
  .option('--since <date>', 'Only include events since this date')
  .option('--dry-run', 'Evaluate without making changes')
  .option('--json', 'Output results as JSON only');

program.parse();

const options = program.opts();

/**
 * Logger that respects --json flag
 */
function log(message: string): void {
  if (!options.json) {
    console.log(message);
  }
}

/**
 * Aggregate metrics by variant for an experiment
 */
function aggregateMetrics(
  events: MetricsEvent[],
  experimentId: string,
  evaluator: ExperimentEvaluator
): { metricsA: VariantMetrics; metricsB: VariantMetrics } {
  const experiment = evaluator.getExperiment(experimentId);
  if (!experiment) {
    throw new Error(`Experiment not found: ${experimentId}`);
  }

  // Get template IDs for this experiment
  const templateA = experiment.templates.find((t) => t.variant === 'A');
  const templateB = experiment.templates.find((t) => t.variant === 'B');

  if (!templateA || !templateB) {
    throw new Error(`Experiment ${experimentId} missing A or B template`);
  }

  // Count events
  let sentA = 0,
    sentB = 0,
    replyA = 0,
    replyB = 0;

  for (const event of events) {
    if (event.templateId === templateA.templateId) {
      if (event.eventType === 'SENT_DETECTED') sentA++;
      if (event.eventType === 'REPLY_DETECTED') replyA++;
    } else if (event.templateId === templateB.templateId) {
      if (event.eventType === 'SENT_DETECTED') sentB++;
      if (event.eventType === 'REPLY_DETECTED') replyB++;
    }
  }

  return {
    metricsA: {
      variant: 'A',
      sent: sentA,
      replies: replyA,
      replyRate: sentA > 0 ? replyA / sentA : null,
    },
    metricsB: {
      variant: 'B',
      sent: sentB,
      replies: replyB,
      replyRate: sentB > 0 ? replyB / sentB : null,
    },
  };
}

/**
 * Format decision for display
 */
function formatDecision(decision: EvaluationDecision): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Experiment: ' + decision.experimentId);
  lines.push('-'.repeat(50));
  lines.push('');

  // Stats table
  lines.push('Metrics:');
  lines.push(
    `  Variant A: ${decision.stats.sentA} sent, ${decision.stats.replyA} replies (${decision.stats.rateA !== null ? (decision.stats.rateA * 100).toFixed(1) + '%' : 'N/A'})`
  );
  lines.push(
    `  Variant B: ${decision.stats.sentB} sent, ${decision.stats.replyB} replies (${decision.stats.rateB !== null ? (decision.stats.rateB * 100).toFixed(1) + '%' : 'N/A'})`
  );
  lines.push('');

  // Statistical results
  lines.push('Statistical Analysis:');
  lines.push(
    `  Z-score: ${decision.stats.zScore !== null ? decision.stats.zScore.toFixed(3) : 'N/A'}`
  );
  lines.push(
    `  P-value: ${decision.stats.pValue !== null ? decision.stats.pValue.toFixed(4) : 'N/A'}`
  );
  lines.push(
    `  Lift: ${decision.stats.liftPercent !== null ? (decision.stats.liftPercent * 100).toFixed(1) + '%' : 'N/A'}`
  );
  lines.push('');

  // Decision
  lines.push('Decision:');
  lines.push(`  Winner: ${decision.winnerVariant || 'None'}`);
  lines.push(`  Reason: ${decision.reasonText}`);
  lines.push(`  Can Promote: ${decision.canPromote ? 'Yes' : 'No'}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Result structure for JSON output
 */
interface PromoteResult {
  experimentId: string;
  decision: EvaluationDecision;
  promoted: boolean;
  backupPath: string | null;
  error: string | null;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  const experimentId = options.experiment as string;

  if (!options.json) {
    console.log('='.repeat(60));
    console.log('AI Sales - A/B Test Winner Promotion');
    console.log('='.repeat(60));
  }

  // Load metrics
  const metricsStore = getMetricsStore();
  const events = options.since
    ? metricsStore.readEventsSince(options.since)
    : metricsStore.readAllEvents();

  log(`Loaded ${events.length} metric events`);
  if (options.since) {
    log(`  Since: ${options.since}`);
  }

  // Create evaluator
  const evaluator = new ExperimentEvaluator();

  // Verify experiment exists
  const experiment = evaluator.getExperiment(experimentId);
  if (!experiment) {
    const errorMsg = `Experiment not found: ${experimentId}`;
    if (options.json) {
      console.log(
        JSON.stringify({
          experimentId,
          decision: null,
          promoted: false,
          backupPath: null,
          error: errorMsg,
        })
      );
    } else {
      console.error('Error: ' + errorMsg);
    }
    process.exit(1);
  }

  // Aggregate metrics
  const { metricsA, metricsB } = aggregateMetrics(
    events,
    experimentId,
    evaluator
  );

  // Evaluate
  const decision = evaluator.evaluate(experimentId, metricsA, metricsB);

  // Prepare result
  const result: PromoteResult = {
    experimentId,
    decision,
    promoted: false,
    backupPath: null,
    error: null,
  };

  // Display decision
  if (!options.json) {
    console.log(formatDecision(decision));
  }

  // Promote if eligible and not dry-run
  if (decision.canPromote && decision.winnerVariant) {
    if (options.dryRun) {
      log('[DRY RUN] Would promote winner and update experiments.json');
    } else {
      // Create backup path
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '')
        .split('.')[0];
      const backupPath = path.join(
        process.cwd(),
        'config',
        `experiments.json.bak-${timestamp}`
      );

      // Promote winner
      const updatedRegistry = evaluator.promoteWinner(
        experimentId,
        decision.winnerVariant
      );
      evaluator.saveRegistry(updatedRegistry, backupPath);

      result.promoted = true;
      result.backupPath = backupPath;

      log(`Winner promoted!`);
      log(`  Backup created: ${backupPath}`);
      log(`  experiments.json updated`);
    }
  } else if (!decision.canPromote) {
    log('No promotion: ' + decision.reasonText);
  }

  // Output JSON if requested
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  process.exit(0);
}

// Run
main().catch((error) => {
  if (options.json) {
    console.log(
      JSON.stringify({
        experimentId: options.experiment,
        decision: null,
        promoted: false,
        backupPath: null,
        error: error.message,
      })
    );
  } else {
    console.error('Fatal error:', error.message);
  }
  process.exit(1);
});
