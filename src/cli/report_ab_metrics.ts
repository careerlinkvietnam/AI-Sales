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
 *
 * 注意:
 * - 返信率の分母は SENT_DETECTED（draftは分母にしない）
 * - PIIはログに出さない
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { getMetricsStore, MetricsEvent } from '../data/MetricsStore';

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
  .option('--json', 'Output results as JSON only');

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
 * Logger that respects --json flag
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
    metrics.replyRate = metrics.sentDetected > 0
      ? Math.round((metrics.replies / metrics.sentDetected) * 1000) / 10 // percentage with 1 decimal
      : null;

    // Median reply latency
    metrics.medianReplyLatencyHours = median(metrics.replyLatencies);
    if (metrics.medianReplyLatencyHours !== null) {
      metrics.medianReplyLatencyHours = Math.round(metrics.medianReplyLatencyHours * 10) / 10;
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
  const overallReplyRate = totalSent > 0
    ? Math.round((totalReplies / totalSent) * 1000) / 10
    : null;

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
  log(`  Reply rate:          ${report.overall.overallReplyRate !== null ? `${report.overall.overallReplyRate}%` : 'N/A'}`);
  log(`  Median reply time:   ${report.overall.medianReplyLatencyHours !== null ? `${report.overall.medianReplyLatencyHours}h` : 'N/A'}`);
  log('');

  // By Template
  if (report.byTemplate.length > 0) {
    log('By Template/Variant:');
    log('-'.repeat(70));
    log('Template ID                  | Variant | Drafts | Sent | Replies | Rate');
    log('-'.repeat(70));

    for (const tm of report.byTemplate) {
      const templatePad = tm.templateId.substring(0, 28).padEnd(28);
      const variantPad = (tm.abVariant || '-').padEnd(7);
      const draftsPad = String(tm.drafts).padStart(6);
      const sentPad = String(tm.sentDetected).padStart(4);
      const repliesPad = String(tm.replies).padStart(7);
      const ratePad = tm.replyRate !== null ? `${tm.replyRate}%` : 'N/A';

      log(`${templatePad} | ${variantPad} | ${draftsPad} | ${sentPad} | ${repliesPad} | ${ratePad}`);
    }
    log('-'.repeat(70));
  } else {
    log('No data found for the specified period.');
  }
  log('');
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  if (!options.json) {
    console.log('');
  }

  // Load events
  const metricsStore = getMetricsStore();
  const events = options.since
    ? metricsStore.readEventsSince(options.since)
    : metricsStore.readAllEvents();

  // Generate report
  const report = generateReport(events);

  if (options.json) {
    // Remove internal arrays from JSON output
    const jsonReport = {
      ...report,
      byTemplate: report.byTemplate.map(t => {
        const { replyLatencies, ...rest } = t;
        return rest;
      }),
    };
    console.log(JSON.stringify(jsonReport, null, 2));
  } else {
    displayReport(report);
  }

  process.exit(0);
}

// Run
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
