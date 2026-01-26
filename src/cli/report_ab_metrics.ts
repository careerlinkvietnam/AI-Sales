#!/usr/bin/env ts-node
/**
 * A/B Metrics Report CLI
 *
 * Aggregates metrics by template_id and ab_variant.
 *
 * Usage:
 *   npx ts-node src/cli/report_ab_metrics.ts
 *   npx ts-node src/cli/report_ab_metrics.ts --since "2026-01-01"
 *   npx ts-node src/cli/report_ab_metrics.ts --json
 *   npx ts-node src/cli/report_ab_metrics.ts --markdown --include-decision
 *
 * 注意:
 * - 返信率の分母は SENT_DETECTED（draftは分母にしない）
 * - PIIはログに出さない
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';
import {
  ExperimentEvaluator,
  EvaluationDecision,
  VariantMetrics,
} from '../domain/ExperimentEvaluator';

// Load environment variables
config();

// CLI Configuration
const program = new Command();

program
  .name('report_ab_metrics')
  .description('Generate A/B test metrics report')
  .version('0.1.0');

program
  .option('--since <date>', 'Only include events since this date (ISO format)')
  .option('--json', 'Output results as JSON only')
  .option('--markdown', 'Output as Markdown table')
  .option('--include-decision', 'Include statistical decision for experiments');

program.parse();

const options = program.opts();

/**
 * Aggregated metrics for a template/variant combination
 */
interface TemplateMetrics {
  templateId: string;
  abVariant: 'A' | 'B' | null;
  drafts: number;
  sentDetected: number;
  replies: number;
  replyRate: number | null;
  medianReplyLatencyHours: number | null;
  replyLatencies: number[];
}

/**
 * Full report structure
 */
interface MetricsReport {
  period: {
    since: string | null;
    until: string;
  };
  overall: {
    totalDrafts: number;
    totalSent: number;
    totalReplies: number;
    overallReplyRate: number | null;
    medianReplyLatencyHours: number | null;
  };
  byTemplate: TemplateMetrics[];
  decisions?: EvaluationDecision[];
}

/**
 * Calculate median of an array of numbers
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Logger that respects --json and --markdown flags
 */
function log(message: string): void {
  if (!options.json) {
    console.log(message);
  }
}

/**
 * Generate metrics report
 */
function generateReport(events: MetricsEvent[]): MetricsReport {
  // Group by template_id + ab_variant
  const groupMap = new Map<string, TemplateMetrics>();

  for (const event of events) {
    const key = `${event.templateId}:${event.abVariant || 'none'}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        templateId: event.templateId,
        abVariant: event.abVariant,
        drafts: 0,
        sentDetected: 0,
        replies: 0,
        replyRate: null,
        medianReplyLatencyHours: null,
        replyLatencies: [],
      });
    }

    const metrics = groupMap.get(key)!;

    switch (event.eventType) {
      case 'DRAFT_CREATED':
        metrics.drafts++;
        break;
      case 'SENT_DETECTED':
        metrics.sentDetected++;
        break;
      case 'REPLY_DETECTED':
        metrics.replies++;
        if (event.replyLatencyHours !== null) {
          metrics.replyLatencies.push(event.replyLatencyHours);
        }
        break;
    }
  }

  // Calculate derived metrics for each group
  const byTemplate: TemplateMetrics[] = [];
  let totalDrafts = 0;
  let totalSent = 0;
  let totalReplies = 0;
  const allLatencies: number[] = [];

  for (const metrics of groupMap.values()) {
    // Reply rate = replies / sent_detected (avoid divide by zero)
    metrics.replyRate =
      metrics.sentDetected > 0
        ? Math.round((metrics.replies / metrics.sentDetected) * 1000) / 10 // percentage with 1 decimal
        : null;

    // Median reply latency
    metrics.medianReplyLatencyHours = median(metrics.replyLatencies);
    if (metrics.medianReplyLatencyHours !== null) {
      metrics.medianReplyLatencyHours =
        Math.round(metrics.medianReplyLatencyHours * 10) / 10;
    }

    // Accumulate totals
    totalDrafts += metrics.drafts;
    totalSent += metrics.sentDetected;
    totalReplies += metrics.replies;
    allLatencies.push(...metrics.replyLatencies);

    // Remove internal array from output
    const { replyLatencies, ...output } = metrics;
    byTemplate.push({ ...output, replyLatencies: [] });
  }

  // Sort by template ID then variant
  byTemplate.sort((a, b) => {
    const templateCompare = a.templateId.localeCompare(b.templateId);
    if (templateCompare !== 0) return templateCompare;
    return (a.abVariant || '').localeCompare(b.abVariant || '');
  });

  // Overall metrics
  const overallReplyRate =
    totalSent > 0 ? Math.round((totalReplies / totalSent) * 1000) / 10 : null;

  let overallMedianLatency = median(allLatencies);
  if (overallMedianLatency !== null) {
    overallMedianLatency = Math.round(overallMedianLatency * 10) / 10;
  }

  return {
    period: {
      since: options.since || null,
      until: new Date().toISOString(),
    },
    overall: {
      totalDrafts,
      totalSent,
      totalReplies,
      overallReplyRate,
      medianReplyLatencyHours: overallMedianLatency,
    },
    byTemplate,
  };
}

/**
 * Add experiment decisions to report
 */
function addDecisions(
  report: MetricsReport,
  events: MetricsEvent[]
): EvaluationDecision[] {
  const evaluator = new ExperimentEvaluator();
  const decisions: EvaluationDecision[] = [];

  try {
    const registry = evaluator.loadRegistry();

    for (const experiment of registry.experiments) {
      // Get template IDs
      const templateA = experiment.templates.find((t) => t.variant === 'A');
      const templateB = experiment.templates.find((t) => t.variant === 'B');

      if (!templateA || !templateB) continue;

      // Count events for this experiment
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

      const metricsA: VariantMetrics = {
        variant: 'A',
        sent: sentA,
        replies: replyA,
        replyRate: sentA > 0 ? replyA / sentA : null,
      };

      const metricsB: VariantMetrics = {
        variant: 'B',
        sent: sentB,
        replies: replyB,
        replyRate: sentB > 0 ? replyB / sentB : null,
      };

      const decision = evaluator.evaluate(
        experiment.experimentId,
        metricsA,
        metricsB
      );
      decisions.push(decision);
    }
  } catch {
    // Silently skip if experiments.json doesn't exist
  }

  return decisions;
}

/**
 * Display report in human-readable format
 */
function displayReport(report: MetricsReport): void {
  log('='.repeat(70));
  log('A/B Metrics Report');
  log('='.repeat(70));
  log('');

  // Period
  log('Period:');
  log(`  From: ${report.period.since || '(all time)'}`);
  log(`  To:   ${report.period.until}`);
  log('');

  // Overall
  log('Overall Metrics:');
  log('-'.repeat(40));
  log(`  Drafts created:      ${report.overall.totalDrafts}`);
  log(`  Sent (detected):     ${report.overall.totalSent}`);
  log(`  Replies (detected):  ${report.overall.totalReplies}`);
  log(
    `  Reply rate:          ${report.overall.overallReplyRate !== null ? `${report.overall.overallReplyRate}%` : 'N/A'}`
  );
  log(
    `  Median reply time:   ${report.overall.medianReplyLatencyHours !== null ? `${report.overall.medianReplyLatencyHours}h` : 'N/A'}`
  );
  log('');

  // By Template
  if (report.byTemplate.length > 0) {
    log('By Template/Variant:');
    log('-'.repeat(70));
    log(
      'Template ID                  | Variant | Drafts | Sent | Replies | Rate'
    );
    log('-'.repeat(70));

    for (const tm of report.byTemplate) {
      const templatePad = tm.templateId.substring(0, 28).padEnd(28);
      const variantPad = (tm.abVariant || '-').padEnd(7);
      const draftsPad = String(tm.drafts).padStart(6);
      const sentPad = String(tm.sentDetected).padStart(4);
      const repliesPad = String(tm.replies).padStart(7);
      const ratePad = tm.replyRate !== null ? `${tm.replyRate}%` : 'N/A';

      log(
        `${templatePad} | ${variantPad} | ${draftsPad} | ${sentPad} | ${repliesPad} | ${ratePad}`
      );
    }
    log('-'.repeat(70));
  } else {
    log('No data found for the specified period.');
  }
  log('');

  // Decisions
  if (report.decisions && report.decisions.length > 0) {
    log('Experiment Decisions:');
    log('-'.repeat(70));
    for (const decision of report.decisions) {
      log(`  ${decision.experimentId}:`);
      log(`    Winner: ${decision.winnerVariant || 'None'}`);
      log(`    Reason: ${decision.reasonText}`);
      log(
        `    P-value: ${decision.stats.pValue !== null ? decision.stats.pValue.toFixed(4) : 'N/A'}`
      );
      log(`    Can Promote: ${decision.canPromote ? 'Yes' : 'No'}`);
      log('');
    }
  }
}

/**
 * Display report in Markdown format
 */
function displayMarkdown(report: MetricsReport): void {
  console.log('# A/B Metrics Report');
  console.log('');
  console.log('## Period');
  console.log('');
  console.log(`- **From**: ${report.period.since || '(all time)'}`);
  console.log(`- **To**: ${report.period.until}`);
  console.log('');

  // Overall
  console.log('## Overall Metrics');
  console.log('');
  console.log('| Metric | Value |');
  console.log('|--------|-------|');
  console.log(`| Drafts created | ${report.overall.totalDrafts} |`);
  console.log(`| Sent (detected) | ${report.overall.totalSent} |`);
  console.log(`| Replies (detected) | ${report.overall.totalReplies} |`);
  console.log(
    `| Reply rate | ${report.overall.overallReplyRate !== null ? `${report.overall.overallReplyRate}%` : 'N/A'} |`
  );
  console.log(
    `| Median reply time | ${report.overall.medianReplyLatencyHours !== null ? `${report.overall.medianReplyLatencyHours}h` : 'N/A'} |`
  );
  console.log('');

  // By Template
  if (report.byTemplate.length > 0) {
    console.log('## By Template/Variant');
    console.log('');
    console.log(
      '| Template ID | Variant | Drafts | Sent | Replies | Rate | Median Latency |'
    );
    console.log('|-------------|---------|--------|------|---------|------|----------------|');

    for (const tm of report.byTemplate) {
      const rate = tm.replyRate !== null ? `${tm.replyRate}%` : 'N/A';
      const latency =
        tm.medianReplyLatencyHours !== null
          ? `${tm.medianReplyLatencyHours}h`
          : 'N/A';
      console.log(
        `| ${tm.templateId} | ${tm.abVariant || '-'} | ${tm.drafts} | ${tm.sentDetected} | ${tm.replies} | ${rate} | ${latency} |`
      );
    }
    console.log('');
  }

  // Decisions
  if (report.decisions && report.decisions.length > 0) {
    console.log('## Experiment Decisions');
    console.log('');

    for (const decision of report.decisions) {
      console.log(`### ${decision.experimentId}`);
      console.log('');
      console.log('| Metric | Variant A | Variant B |');
      console.log('|--------|-----------|-----------|');
      console.log(
        `| Sent | ${decision.stats.sentA} | ${decision.stats.sentB} |`
      );
      console.log(
        `| Replies | ${decision.stats.replyA} | ${decision.stats.replyB} |`
      );
      console.log(
        `| Reply Rate | ${decision.stats.rateA !== null ? (decision.stats.rateA * 100).toFixed(1) + '%' : 'N/A'} | ${decision.stats.rateB !== null ? (decision.stats.rateB * 100).toFixed(1) + '%' : 'N/A'} |`
      );
      console.log('');
      console.log('**Statistical Analysis:**');
      console.log('');
      console.log(
        `- Z-score: ${decision.stats.zScore !== null ? decision.stats.zScore.toFixed(3) : 'N/A'}`
      );
      console.log(
        `- P-value: ${decision.stats.pValue !== null ? decision.stats.pValue.toFixed(4) : 'N/A'}`
      );
      console.log(
        `- Lift: ${decision.stats.liftPercent !== null ? (decision.stats.liftPercent * 100).toFixed(1) + '%' : 'N/A'}`
      );
      console.log('');
      console.log('**Decision:**');
      console.log('');
      console.log(`- **Winner**: ${decision.winnerVariant || 'None'}`);
      console.log(`- **Reason**: ${decision.reasonText}`);
      console.log(`- **Can Promote**: ${decision.canPromote ? 'Yes' : 'No'}`);
      console.log('');
    }
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  if (!options.json && !options.markdown) {
    console.log('');
  }

  // Load events
  const metricsStore = getMetricsStore();
  const events = options.since
    ? metricsStore.readEventsSince(options.since)
    : metricsStore.readAllEvents();

  // Generate report
  const report = generateReport(events);

  // Add decisions if requested
  if (options.includeDecision) {
    report.decisions = addDecisions(report, events);
  }

  if (options.json) {
    // Remove internal arrays from JSON output
    const jsonReport = {
      ...report,
      byTemplate: report.byTemplate.map((t) => {
        const { replyLatencies, ...rest } = t;
        return rest;
      }),
    };
    console.log(JSON.stringify(jsonReport, null, 2));
  } else if (options.markdown) {
    displayMarkdown(report);
  } else {
    displayReport(report);
  }

  process.exit(0);
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
